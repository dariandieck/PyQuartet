import { readFile, writeFile } from "node:fs/promises";
import type { Category } from "../../src/game/model.ts";
import { parseCards, parseCategories } from "../../src/game/parse.ts";

/** A card as stored in data/cards.json. `pypi` and `repo` are only used by `npm run stats` and the editor. */
export interface RawCard {
  library: string;
  url?: string | null;
  pypi?: string | null;
  repo?: string | null;
  img_url?: string | null;
  img_scale?: number;
  color?: string | null;
  stats: Record<string, number>;
}

const CARDS_FILE = new URL("../../data/cards.json", import.meta.url);
const CATEGORIES_FILE = new URL("../../data/categories.json", import.meta.url);

const KEY_ORDER = ["library", "url", "pypi", "repo", "img_url", "img_scale", "color", "stats"] as const;

/**
 * Fixed key order and no empty optional fields, so diffs of data/cards.json stay small and readable. With
 * `categories`, stats follow their order and values of removed categories are dropped.
 */
export function normalizeCard(card: RawCard, categories?: Category[]): RawCard {
  if (categories) {
    const stats = Object.fromEntries(categories.flatMap((c) => (c.label in card.stats ? [[c.label, card.stats[c.label]!]] : [])));
    card = { ...card, stats };
  }
  const entries = KEY_ORDER.map((key) => [key, card[key]] as const).filter(
    ([key, value]) => key === "stats" || (value !== null && value !== undefined && value !== ""),
  );
  return Object.fromEntries(entries) as unknown as RawCard;
}

export async function readCategories(): Promise<Category[]> {
  return parseCategories(JSON.parse(await readFile(CATEGORIES_FILE, "utf8")));
}

export async function readCards(): Promise<RawCard[]> {
  return (JSON.parse(await readFile(CARDS_FILE, "utf8")) as { cards: RawCard[] }).cards;
}

/** Validates with the game's own parser (throws `DeckError`) before anything is written. */
export async function writeCards(cards: RawCard[], categories: Category[]): Promise<void> {
  const normalized = cards.map((card) => normalizeCard(card, categories));
  parseCards({ cards: normalized }, categories);
  await writeFile(CARDS_FILE, `${JSON.stringify({ cards: normalized }, null, 2)}\n`);
}
