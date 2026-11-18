/** Pure game rules (no DOM/canvas), so the same engine can run on the host of a network game. */
import { bestValue, cardValue, type Card, type Category } from "./model.ts";

export type Rng = () => number;

export interface Player {
  id: number;
  name: string;
  isBot: boolean;
  /** stack[0] is the top card; won cards go to the end (bottom). */
  stack: Card[];
}

export interface Play {
  playerId: number;
  card: Card;
  value: number;
}

export interface RoundResult {
  roundNumber: number;
  category: Category;
  callerId: number;
  plays: Play[];
  bestIds: number[];
  winnerId: number | null;
  wonCards: Card[];
  redistributed: boolean;
  eliminatedIds: number[];
  gameOver: boolean;
}

export function isTie(result: RoundResult): boolean {
  return result.bestIds.length > 1;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export class GameOverError extends Error {
  override name = "GameOverError";
}

export interface PlayerSetup {
  name: string;
  isBot?: boolean;
}

export interface GameOptions {
  rng?: Rng;
  maxRounds?: number | null;
}

export class Game {
  readonly players: Player[];
  readonly categories: Category[];
  readonly maxRounds: number | null;
  pot: Card[] = [];
  roundNumber = 0;
  callerId: number;
  /** Players who play a card in the next round (everyone with cards, or only the tied players). */
  participants: number[];
  readonly eliminated = new Set<number>();
  /** Players who left the game (subset of eliminated). */
  readonly left = new Set<number>();
  private tieActive = false;
  private readonly rng: Rng;

  constructor(players: PlayerSetup[], cards: Card[], categories: Category[], options: GameOptions = {}) {
    if (players.length < 2) throw new Error("PyQuartet needs at least 2 players");
    if (cards.length < players.length) throw new Error("Not enough cards to give every player one");
    this.rng = options.rng ?? Math.random;
    this.categories = [...categories];
    this.maxRounds = options.maxRounds ?? null;
    this.players = players.map((p, id) => ({ id, name: p.name, isBot: p.isBot ?? false, stack: [] }));
    this.deal([...cards]);
    this.callerId = this.players[Math.floor(this.rng() * this.players.length)]!.id;
    this.participants = this.activeIds();
  }

  private deal(cards: Card[]): void {
    shuffle(cards, this.rng);
    const perPlayer = Math.floor(cards.length / this.players.length);
    this.players.forEach((player, i) => player.stack.push(...cards.slice(i * perPlayer, (i + 1) * perPlayer)));
    // Leftovers keep the deal even; they go to the pot and are won with the first round.
    this.pot.push(...cards.slice(perPlayer * this.players.length));
  }

  player(id: number): Player {
    return this.players[id]!;
  }

  category(label: string): Category {
    const category = this.categories.find((c) => c.label === label);
    if (!category) throw new Error(`Unknown category "${label}"`);
    return category;
  }

  topCard(playerId: number): Card | undefined {
    return this.player(playerId).stack[0];
  }

  activeIds(): number[] {
    return this.players.filter((p) => p.stack.length > 0).map((p) => p.id);
  }

  /** A tie is being resolved: only the tied players draw, and the same caller picks again. */
  get isTiePending(): boolean {
    return this.tieActive;
  }

  get isOver(): boolean {
    if (this.tieActive) return false;
    if (this.activeIds().length <= 1) return true;
    return this.maxRounds !== null && this.roundNumber >= this.maxRounds;
  }

  /**
   * A player leaves mid-game (e.g. lost connection): their cards go to the pot and they are out.
   * A tie that can no longer be played out is decided, and the last remaining player takes everything.
   */
  removePlayer(id: number): void {
    if (this.left.has(id)) return;
    const player = this.player(id);
    this.left.add(id);
    this.eliminated.add(id);
    this.pot.push(...player.stack.splice(0));

    const givePot = (winnerId: number) => {
      this.player(winnerId).stack.push(...this.pot.splice(0));
    };
    if (this.tieActive) {
      const contenders = this.participants.filter((p) => p !== id && this.player(p).stack.length > 0);
      if (contenders.length >= 2) {
        this.participants = contenders;
      } else {
        this.tieActive = false;
        if (contenders.length === 1) givePot(contenders[0]!);
        this.participants = this.activeIds();
      }
    } else {
      this.participants = this.activeIds();
    }

    const active = this.activeIds();
    if (active.length === 1) givePot(active[0]!);
    if (this.callerId === id || this.player(this.callerId).stack.length === 0) {
      this.callerId = this.participants[0] ?? active[0] ?? this.callerId;
    }
  }

  winners(): number[] {
    const most = Math.max(...this.players.map((p) => p.stack.length));
    return this.players.filter((p) => p.stack.length === most).map((p) => p.id);
  }

  playRound(categoryLabel: string): RoundResult {
    if (this.isOver) throw new GameOverError("The game is already over");
    const category = this.category(categoryLabel);
    const callerId = this.callerId;
    const plays: Play[] = this.participants.map((playerId) => {
      const card = this.player(playerId).stack.shift()!;
      return { playerId, card, value: cardValue(card, category) };
    });

    this.roundNumber += 1;
    const best = bestValue(category, plays.map((p) => p.value));
    const bestIds = plays.filter((p) => p.value === best).map((p) => p.playerId);
    this.pot.push(...plays.map((p) => p.card));

    let winnerId: number | null = null;
    let wonCards: Card[] = [];
    let redistributed = false;

    const contenders = bestIds.filter((id) => this.player(id).stack.length > 0);
    if (bestIds.length === 1 || contenders.length === 1) {
      // A tie where only one tied player can still play is won by that player.
      winnerId = bestIds.length === 1 ? bestIds[0]! : contenders[0]!;
      wonCards = [...this.pot];
      this.player(winnerId).stack.push(...this.pot);
      this.pot = [];
      this.callerId = winnerId;
      this.participants = this.activeIds();
      this.tieActive = false;
    } else if (contenders.length > 0) {
      this.participants = contenders;
      this.tieActive = true;
      if (this.player(this.callerId).stack.length === 0) this.callerId = contenders[0]!;
    } else {
      this.tieActive = false;
      // Every tied player ran out of cards: hand the pot back to them so nobody "loses" by a tie.
      redistributed = true;
      const cards = shuffle([...this.pot], this.rng);
      this.pot = [];
      cards.forEach((card, i) => this.player(bestIds[i % bestIds.length]!).stack.push(card));
      this.participants = this.activeIds();
      if (this.player(this.callerId).stack.length === 0) this.callerId = bestIds[0]!;
    }

    const eliminatedIds = this.players
      .filter((p) => p.stack.length === 0 && !this.eliminated.has(p.id))
      .map((p) => p.id);
    eliminatedIds.forEach((id) => this.eliminated.add(id));

    return {
      roundNumber: this.roundNumber,
      category,
      callerId,
      plays,
      bestIds,
      winnerId,
      wonCards,
      redistributed,
      eliminatedIds,
      gameOver: this.isOver,
    };
  }
}
