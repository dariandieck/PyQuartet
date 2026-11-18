import rawCards from "../../data/cards.json";
import rawCategories from "../../data/categories.json";
import type { Card, Category, Polarity } from "./model.ts";

export class DeckError extends Error {
  override name = "DeckError";
}

const POLARITIES: readonly Polarity[] = ["positive", "negative"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(raw: unknown, key: string, file: string): unknown[] {
  if (!isRecord(raw) || !Array.isArray(raw[key])) {
    throw new DeckError(`${file}: expected an object with a "${key}" array`);
  }
  return raw[key];
}

export function parseCategories(raw: unknown): Category[] {
  const categories = list(raw, "categories", "categories.json").map((entry, i): Category => {
    if (!isRecord(entry) || typeof entry.label !== "string") {
      throw new DeckError(`categories.json: entry ${i} has no string "label"`);
    }
    if (!POLARITIES.includes(entry.polarity as Polarity)) {
      throw new DeckError(`Category "${entry.label}": unknown polarity ${JSON.stringify(entry.polarity)}`);
    }
    return {
      label: entry.label,
      unit: typeof entry.unit === "string" ? entry.unit : null,
      polarity: entry.polarity as Polarity,
      fetchUrl: typeof entry.fetch_url === "string" ? entry.fetch_url : null,
    };
  });
  const labels = categories.map((c) => c.label);
  if (new Set(labels).size !== labels.length) {
    throw new DeckError("Duplicate category labels in categories.json");
  }
  return categories;
}

export function parseCards(raw: unknown, categories: Category[]): Card[] {
  const expected = new Set(categories.map((c) => c.label));
  return list(raw, "cards", "cards.json").map((entry, i): Card => {
    if (!isRecord(entry) || typeof entry.library !== "string" || !isRecord(entry.stats)) {
      throw new DeckError(`cards.json: entry ${i} needs a string "library" and a "stats" object`);
    }
    const stats = entry.stats;
    const keys = Object.keys(stats);
    const missing = [...expected].filter((label) => !(label in stats));
    const unknown = keys.filter((key) => !expected.has(key));
    if (missing.length || unknown.length) {
      throw new DeckError(
        `Card "${entry.library}": stats do not match categories.json ` +
          `(missing: ${JSON.stringify(missing)}, unknown: ${JSON.stringify(unknown)})`,
      );
    }
    for (const [label, value] of Object.entries(stats)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DeckError(`Card "${entry.library}": stat "${label}" is not a number (${JSON.stringify(value)})`);
      }
    }
    const imgScale = entry.img_scale ?? 1;
    if (typeof imgScale !== "number" || !(imgScale > 0)) {
      throw new DeckError(`Card "${entry.library}": img_scale must be a positive number (${JSON.stringify(imgScale)})`);
    }
    const color = entry.color ?? null;
    if (color !== null && (typeof color !== "string" || !HEX_COLOR.test(color))) {
      throw new DeckError(`Card "${entry.library}": color must look like "#1a2b3c" (${JSON.stringify(color)})`);
    }
    return {
      library: entry.library,
      url: typeof entry.url === "string" ? entry.url : null,
      imgUrl: typeof entry.img_url === "string" ? entry.img_url : null,
      imgScale,
      color,
      stats: stats as Record<string, number>,
    };
  });
}

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
