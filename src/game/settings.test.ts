import { describe, expect, it } from "vitest";
import type { Card } from "./model.ts";
import { cleanSettings, maxRoundsOf, MIN_CARDS, pickCards, ROUND_LIMIT } from "./settings.ts";

const card = (library: string): Card => ({ library, url: null, imgUrl: null, imgScale: 1, color: null, stats: {} });

describe("game settings", () => {
  it("clamps stored or received settings to the deck", () => {
    expect(cleanSettings(null, 50)).toEqual({ mode: "classic", cardCount: 50 });
    expect(cleanSettings({ mode: "rounds", cardCount: 99 }, 50)).toEqual({ mode: "rounds", cardCount: 50 });
    expect(cleanSettings({ mode: "nonsense", cardCount: 2 }, 50)).toEqual({ mode: "classic", cardCount: MIN_CARDS });
    expect(cleanSettings({ cardCount: 12.6 }, 50).cardCount).toBe(13);
    expect(cleanSettings({ cardCount: 3 }, 5).cardCount).toBe(5);
  });

  it("only the rounds mode has a round limit", () => {
    expect(maxRoundsOf({ mode: "rounds", cardCount: 10 })).toBe(ROUND_LIMIT);
    expect(maxRoundsOf({ mode: "classic", cardCount: 10 })).toBeNull();
  });

  it("picks distinct cards without changing the deck", () => {
    const deck = ["a", "b", "c", "d", "e", "f"].map(card);
    const picked = pickCards(deck, 4);
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
    expect(picked.every((c) => deck.includes(c))).toBe(true);
    expect(deck.map((c) => c.library)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(pickCards(deck, 99)).toHaveLength(6);
  });
});
