import rawCards from "../../data/cards.json";
import rawCategories from "../../data/categories.json";
import type { Card, Category } from "./model.ts";
import { parseCards, parseCategories } from "./parse.ts";

export { DeckError, parseCards, parseCategories } from "./parse.ts";

export interface Deck {
  cards: Card[];
  categories: Category[];
  /** Fingerprint of the card data; network players must have the same deck to play together. */
  version: string;
}

function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function loadDeck(): Deck {
  const categories = parseCategories(rawCategories);
  const cards = parseCards(rawCards, categories);
  return { cards, categories, version: fingerprint(JSON.stringify([rawCategories, rawCards])) };
}
