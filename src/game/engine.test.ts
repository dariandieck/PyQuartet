import { describe, expect, it } from "vitest";
import { Bot } from "./bot.ts";
import { DeckError, parseCards, parseCategories } from "./deck.ts";
import { Game, isTie } from "./engine.ts";
import type { Card, Category } from "./model.ts";

const stars: Category = { label: "Stars", unit: "k", polarity: "positive", fetchUrl: null };
const size: Category = { label: "Size", unit: "MB", polarity: "negative", fetchUrl: null };
const categories = [stars, size];

const card = (library: string, starsValue: number, sizeValue: number): Card => ({
  library,
  url: null,
  imgUrl: null,
  imgScale: 1,
  color: null,
  stats: { Stars: starsValue, Size: sizeValue },
});

/** rng that always returns 0: shuffle keeps a fixed permutation and player 0 starts. */
const zeroRng = () => 0;

function setStacks(game: Game, stacks: Card[][]): void {
  game.players.forEach((p, i) => (p.stack = [...stacks[i]!]));
  game.pot = [];
  game.participants = game.activeIds();
}

describe("Game", () => {
  it("deals evenly and puts leftovers into the pot", () => {
    const cards = ["a", "b", "c", "d", "e"].map((l, i) => card(l, i, i));
    const game = new Game([{ name: "A" }, { name: "B" }], cards, categories, { rng: zeroRng });
    expect(game.players.map((p) => p.stack.length)).toEqual([2, 2]);
    expect(game.pot).toHaveLength(1);
    expect(game.isTiePending).toBe(false);
  });

  it("gives all played cards to the winner, who calls next", () => {
    const game = new Game([{ name: "A" }, { name: "B" }], [card("x", 1, 1), card("y", 2, 2)], categories, { rng: zeroRng });
    setStacks(game, [[card("hi", 10, 50), card("a2", 1, 1)], [card("lo", 5, 10), card("b2", 1, 1)]]);
    game.callerId = 1;

    const result = game.playRound("Stars");
    expect(result.winnerId).toBe(0);
    expect(game.callerId).toBe(0);
    expect(game.player(0).stack.map((c) => c.library)).toEqual(["a2", "hi", "lo"]);

    // Lower wins for negative polarity.
    setStacks(game, [[card("big", 1, 500)], [card("small", 1, 5)]]);
    expect(game.playRound("Size").winnerId).toBe(1);
  });

  it("moves tied cards to the pot and lets only the tied players draw again", () => {
    const players = [{ name: "A" }, { name: "B" }, { name: "C" }];
    const game = new Game(players, [card("x", 1, 1), card("y", 1, 1), card("z", 1, 1)], categories, { rng: zeroRng });
    setStacks(game, [
      [card("a1", 9, 1), card("a2", 3, 1)],
      [card("b1", 9, 1), card("b2", 7, 1)],
      [card("c1", 1, 1), card("c2", 1, 1)],
    ]);
    game.callerId = 2;

    const tie = game.playRound("Stars");
    expect(isTie(tie)).toBe(true);
    expect(tie.winnerId).toBeNull();
    expect(game.pot).toHaveLength(3);
    expect(game.participants).toEqual([0, 1]);
    expect(game.callerId).toBe(2); // same caller picks again

    const breaker = game.playRound("Stars");
    expect(breaker.winnerId).toBe(1);
    expect(breaker.wonCards).toHaveLength(5);
    expect(game.pot).toHaveLength(0);
    expect(game.participants).toEqual([1, 2]);
    expect(breaker.eliminatedIds).toEqual([0]);
  });

  it("hands the pot back when no tied player has cards left", () => {
    const game = new Game([{ name: "A" }, { name: "B" }], [card("x", 1, 1), card("y", 1, 1)], categories, { rng: zeroRng });
    setStacks(game, [[card("a", 5, 1)], [card("b", 5, 1)]]);
    const result = game.playRound("Stars");
    expect(result.redistributed).toBe(true);
    expect(game.players.map((p) => p.stack.length)).toEqual([1, 1]);
    expect(game.isOver).toBe(false);
  });

  it("ends when one player owns all cards, or after maxRounds once no tie is pending", () => {
    const game = new Game([{ name: "A" }, { name: "B" }], [card("x", 1, 1), card("y", 1, 1)], categories, { rng: zeroRng });
    setStacks(game, [[card("a", 9, 1)], [card("b", 1, 1)]]);
    expect(game.playRound("Stars").gameOver).toBe(true);
    expect(game.winners()).toEqual([0]);

    const short = new Game([{ name: "A" }, { name: "B" }], [card("x", 1, 1), card("y", 1, 1)], categories, {
      rng: zeroRng,
      maxRounds: 1,
    });
    setStacks(short, [[card("a", 9, 1), card("a2", 1, 1)], [card("b", 1, 1), card("b2", 1, 1)]]);
    expect(short.playRound("Stars").gameOver).toBe(true);
    expect(short.winners()).toEqual([0]);
  });
});

describe("Bot", () => {
  it("picks the category where its card ranks best in the deck", () => {
    const deck = [card("a", 100, 900), card("b", 50, 10), card("c", 10, 500)];
    const bot = new Bot(deck, categories, zeroRng);
    expect(bot.chooseCategory(deck[1]!).label).toBe("Size");
    expect(bot.chooseCategory(deck[0]!).label).toBe("Stars");
  });
});

describe("deck parsing", () => {
  const rawCategories = { categories: [{ label: "Stars", unit: "k", polarity: "positive", fetch_url: null }] };

  it("parses categories and cards", () => {
    const parsed = parseCategories(rawCategories);
    expect(parsed[0]).toEqual({ label: "Stars", unit: "k", polarity: "positive", fetchUrl: null });
    const cards = parseCards({ cards: [{ library: "numpy", img_url: null, stats: { Stars: 3 } }] }, parsed);
    expect(cards[0]!.stats.Stars).toBe(3);
  });

  it("rejects stats that do not match the categories", () => {
    const parsed = parseCategories(rawCategories);
    expect(() => parseCards({ cards: [{ library: "x", stats: { Other: 1 } }] }, parsed)).toThrow(DeckError);
    expect(() => parseCards({ cards: [{ library: "x", stats: { Stars: "1" } }] }, parsed)).toThrow(DeckError);
  });

  it("reads optional url, img_scale and color with defaults and validation", () => {
    const parsed = parseCategories(rawCategories);
    const [plain] = parseCards({ cards: [{ library: "x", stats: { Stars: 1 } }] }, parsed);
    expect(plain).toMatchObject({ url: null, imgScale: 1, color: null });
    const [full] = parseCards(
      { cards: [{ library: "x", url: "https://x.org", img_scale: 0.8, color: "#150458", stats: { Stars: 1 } }] },
      parsed,
    );
    expect(full).toMatchObject({ url: "https://x.org", imgScale: 0.8, color: "#150458" });
    expect(() => parseCards({ cards: [{ library: "x", img_scale: 0, stats: { Stars: 1 } }] }, parsed)).toThrow(DeckError);
    expect(() => parseCards({ cards: [{ library: "x", color: "blue", stats: { Stars: 1 } }] }, parsed)).toThrow(DeckError);
  });
});
