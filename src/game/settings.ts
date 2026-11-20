import { shuffle, type Rng } from "./engine.ts";
import type { Card } from "./model.ts";

export const ROUND_LIMIT = 10;
/** Two cards each for a full room of four players. */
export const MIN_CARDS = 8;

/** classic: until one player has all cards; rounds: most cards after ROUND_LIMIT rounds wins. */
export type GameMode = "classic" | "rounds";

export interface GameSettings {
  mode: GameMode;
  cardCount: number;
}

export function defaultSettings(deckSize: number): GameSettings {
  return { mode: "classic", cardCount: deckSize };
}

export function minCards(deckSize: number): number {
  return Math.min(MIN_CARDS, deckSize);
}

/** Brings settings from storage or the network into range for this deck. */
export function cleanSettings(raw: unknown, deckSize: number): GameSettings {
  const fallback = defaultSettings(deckSize);
  if (typeof raw !== "object" || raw === null) return fallback;
  const { mode, cardCount } = raw as Record<string, unknown>;
  const count = typeof cardCount === "number" && Number.isFinite(cardCount) ? Math.round(cardCount) : deckSize;
  return {
    mode: mode === "rounds" ? "rounds" : "classic",
    cardCount: Math.min(Math.max(count, minCards(deckSize)), deckSize),
  };
}

export function maxRoundsOf(settings: GameSettings): number | null {
  return settings.mode === "rounds" ? ROUND_LIMIT : null;
}

/** A random subset of the deck for one game. */
export function pickCards(cards: readonly Card[], count: number, rng: Rng = Math.random): Card[] {
  return shuffle([...cards], rng).slice(0, Math.min(Math.max(count, 1), cards.length));
}

export function describeMode(mode: GameMode): string {
  return mode === "rounds"
    ? `${ROUND_LIMIT} rounds: most cards after round ${ROUND_LIMIT} wins`
    : "Classic: play until one player has all cards";
}
