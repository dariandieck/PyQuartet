import type { Rng } from "./engine.ts";
import { beats, cardValue, type Card, type Category } from "./model.ts";

/**
 * Picks the category where its own top card ranks best within the whole deck.
 * The bot only looks at its own card plus the deck's value ranges, i.e. what an experienced player knows.
 */
export class Bot {
  private readonly values: Map<string, number[]>;

  constructor(
    deck: Card[],
    private readonly categories: Category[],
    private readonly rng: Rng = Math.random,
  ) {
    this.values = new Map(categories.map((c) => [c.label, deck.map((card) => cardValue(card, c))]));
  }

  private strength(card: Card, category: Category): number {
    const values = this.values.get(category.label)!;
    const value = cardValue(card, category);
    const beaten = values.filter((v) => beats(category, value, v)).length;
    return beaten / Math.max(values.length - 1, 1);
  }

  chooseCategory(card: Card): Category {
    let best: { score: number; jitter: number; category: Category } | null = null;
    for (const category of this.categories) {
      const candidate = { score: this.strength(card, category), jitter: this.rng(), category };
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.jitter > best.jitter)) {
        best = candidate;
      }
    }
    return best!.category;
  }
}
