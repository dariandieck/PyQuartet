import { Bot } from "../game/bot.ts";
import type { Deck } from "../game/deck.ts";
import { Game, type RoundResult } from "../game/engine.ts";
import { maxRoundsOf, pickCards, type GameSettings } from "../game/settings.ts";
import type { HostLink } from "../net/peer.ts";
import type { ClientMessage, GameEvent, PublicState, ResultInfo, SeatInfo } from "../net/protocol.ts";
import { EventChannel, type Session } from "./session.ts";

/** Roughly the draw animation plus a short "thinking" pause, so bot calls don't arrive instantly. */
const BOT_THINK_MS = 1800;

export interface HostSeat {
  name: string;
  isBot: boolean;
  /** Remote players have a link; the host itself (seat 0) and bots don't. */
  link?: HostLink;
}

type Phase = "idle" | "waitCall" | "confirming" | "result" | "over";

/** Runs the authoritative game: engine, bots and turn order. Seat 0 is always the local player. */
export class HostSession implements Session {
  readonly isHost = true;
  private readonly local = new EventChannel();
  private readonly game: Game;
  private readonly bots = new Map<number, Bot>();
  private phase: Phase = "idle";
  private pendingLabel: string | null = null;
  /** Players who still have to click Call before the called category is played. */
  private waitingFor = new Set<number>();
  private botTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    deck: Deck,
    private readonly seats: HostSeat[],
    settings: GameSettings,
    private readonly onLeave: () => void = () => {},
  ) {
    const cards = pickCards(deck.cards, settings.cardCount);
    this.game = new Game(seats, cards, deck.categories, { maxRounds: maxRoundsOf(settings) });
    seats.forEach((seat, id) => {
      if (seat.isBot) this.bots.set(id, new Bot(deck.cards, deck.categories));
      if (seat.link) {
        seat.link.onMessage = (message) => this.onClientMessage(id, message);
        seat.link.onClose = () => this.onPlayerLeft(id);
      }
    });
  }

  get isOnline(): boolean {
    return this.seats.some((seat) => seat.link);
  }

  listen(handler: (event: GameEvent) => void): void {
    this.local.listen(handler);
  }

  start(): void {
    const seatInfo: SeatInfo[] = this.seats.map((s, id) => ({ id, name: s.name, isBot: s.isBot }));
    const state = this.state();
    this.toHumans((youId) => ({
      kind: "start",
      seats: seatInfo,
      youId,
      maxRounds: this.game.maxRounds,
      callerId: this.game.callerId,
      state,
    }));
    this.beginRound();
  }

  // ---- intents -----------------------------------------------------------------------------

  call(label: string): void {
    this.handleCall(0, label);
  }

  confirmCall(): void {
    this.handleConfirm(0);
  }

  continueRound(): void {
    if (this.phase !== "result") return;
    this.broadcast({ kind: "collect", state: this.state() });
    if (this.game.isOver) this.finish();
    else this.beginRound();
  }

  leave(): void {
    this.phase = "over";
    clearTimeout(this.botTimer);
    for (const seat of this.seats) {
      if (!seat.link) continue;
      seat.link.onClose = () => {};
      seat.link.close();
    }
    this.onLeave();
  }

  // ---- flow --------------------------------------------------------------------------------

  private beginRound(): void {
    if (this.game.isOver) {
      this.finish();
      return;
    }
    this.phase = "waitCall";
    this.pendingLabel = null;
    const { participants, callerId } = this.game;
    const tie = this.game.isTiePending;
    const state = this.state();
    this.toHumans((id) => ({
      kind: "roundStart",
      tie,
      participants: [...participants],
      callerId,
      card: participants.includes(id) ? (this.game.topCard(id)?.library ?? null) : null,
      state,
    }));
    if (this.bots.has(callerId)) this.botTimer = setTimeout(() => this.botCall(), BOT_THINK_MS);
  }

  private botCall(): void {
    if (this.phase !== "waitCall") return;
    const callerId = this.game.callerId;
    const card = this.game.topCard(callerId);
    if (!card) return;
    this.announceCall(callerId, this.bots.get(callerId)!.chooseCategory(card).label);
  }

  private handleCall(playerId: number, label: string): void {
    if (this.phase !== "waitCall" || playerId !== this.game.callerId) return;
    if (!this.game.categories.some((c) => c.label === label)) return;
    this.announceCall(playerId, label);
  }

  /**
   * Like reading the value off your own card: every human with a card in play who didn't call clicks Call too,
   * and the cards are revealed once all of them did (user rule; bots never confirm).
   */
  private announceCall(callerId: number, label: string): void {
    this.pendingLabel = label;
    this.phase = "confirming";
    this.waitingFor = new Set(
      this.game.participants.filter((id) => id !== callerId && !this.seats[id]!.isBot && !this.game.left.has(id)),
    );
    this.broadcast({ kind: "called", callerId, label, waitingFor: [...this.waitingFor] });
    if (this.waitingFor.size === 0) this.play(label);
  }

  private handleConfirm(playerId: number): void {
    if (this.phase !== "confirming" || !this.waitingFor.delete(playerId)) return;
    this.broadcast({ kind: "confirmed", playerId, waitingFor: [...this.waitingFor] });
    if (this.waitingFor.size === 0 && this.pendingLabel) this.play(this.pendingLabel);
  }

  private play(label: string): void {
    const result = this.game.playRound(label);
    this.phase = "result";
    this.broadcast({ kind: "reveal", result: toResultInfo(result), state: this.state() });
  }

  private finish(): void {
    this.phase = "over";
    this.broadcast({ kind: "gameOver", winners: this.game.winners(), state: this.state() });
  }

  private onClientMessage(playerId: number, message: ClientMessage): void {
    if (message.t === "call") this.handleCall(playerId, message.label);
    else if (message.t === "confirm") this.handleConfirm(playerId);
  }

  private onPlayerLeft(playerId: number): void {
    if (this.game.left.has(playerId)) return;
    // Before the reveal nothing has been played yet, so the round is simply drawn again without the leaver.
    const restart = this.phase === "waitCall" || this.phase === "confirming";
    const wasOver = this.phase === "over";
    clearTimeout(this.botTimer);
    this.game.removePlayer(playerId);
    this.broadcast({ kind: "playerLeft", playerId, restart: restart && !wasOver, state: this.state() });
    if (wasOver) return;
    if (this.game.isOver) this.finish();
    else if (restart) this.beginRound();
  }

  // ---- delivery ----------------------------------------------------------------------------

  private state(): PublicState {
    return {
      counts: this.game.players.map((p) => p.stack.length),
      potCount: this.game.pot.length,
      left: [...this.game.left],
      roundNumber: this.game.roundNumber,
    };
  }

  /** Sends a per-player event to every human still in the game (the local player via the event channel). */
  private toHumans(make: (playerId: number) => GameEvent): void {
    this.seats.forEach((seat, id) => {
      if (seat.isBot || this.game.left.has(id)) return;
      const event = make(id);
      if (id === 0) this.local.emit(event);
      else seat.link?.send({ t: "event", event });
    });
  }

  private broadcast(event: GameEvent): void {
    this.toHumans(() => event);
  }
}

function toResultInfo(result: RoundResult): ResultInfo {
  return {
    label: result.category.label,
    callerId: result.callerId,
    plays: result.plays.map((p) => ({ playerId: p.playerId, library: p.card.library, value: p.value })),
    bestIds: result.bestIds,
    winnerId: result.winnerId,
    redistributed: result.redistributed,
    eliminatedIds: result.eliminatedIds,
    gameOver: result.gameOver,
  };
}
