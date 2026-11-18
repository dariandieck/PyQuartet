import { Bot } from "../game/bot.ts";
import type { Deck } from "../game/deck.ts";
import { Game, type RoundResult } from "../game/engine.ts";
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

type Phase = "idle" | "waitCall" | "botPending" | "result" | "over";

/** Runs the authoritative game: engine, bots and turn order. Seat 0 is always the local player. */
export class HostSession implements Session {
  readonly isHost = true;
  private readonly local = new EventChannel();
  private readonly game: Game;
  private readonly bots = new Map<number, Bot>();
  private phase: Phase = "idle";
  private pendingLabel: string | null = null;
  private botTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    deck: Deck,
    private readonly seats: HostSeat[],
    maxRounds: number | null,
    private readonly onLeave: () => void = () => {},
  ) {
    this.game = new Game(seats, deck.cards, deck.categories, { maxRounds });
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

  confirmBotCall(): void {
    if (this.phase === "botPending" && this.pendingLabel) this.play(this.pendingLabel);
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
    this.pendingLabel = this.bots.get(callerId)!.chooseCategory(card).label;
    this.phase = "botPending";
    this.broadcast({ kind: "called", callerId, label: this.pendingLabel, needsConfirm: true });
  }

  private handleCall(playerId: number, label: string): void {
    if (this.phase !== "waitCall" || playerId !== this.game.callerId) return;
    if (!this.game.categories.some((c) => c.label === label)) return;
    this.broadcast({ kind: "called", callerId: playerId, label, needsConfirm: false });
    this.play(label);
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
  }

  private onPlayerLeft(playerId: number): void {
    if (this.game.left.has(playerId)) return;
    // Before the reveal nothing has been played yet, so the round is simply drawn again without the leaver.
    const restart = this.phase === "waitCall" || this.phase === "botPending";
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
