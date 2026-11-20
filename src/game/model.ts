export type Polarity = "positive" | "negative"; // positive: higher value wins, negative: lower value wins

/** Where `npm run stats` and the card editor fetch a category's value from. */
export const STAT_SOURCES = [
  "github_stars",
  "github_forks",
  "github_contributors",
  "github_size_mb",
  "pepy_downloads",
] as const;
export type StatSource = (typeof STAT_SOURCES)[number];

export interface Category {
  label: string;
  /** Real unit such as "MB"; unitless counts are shown compact instead ("50.6k"). */
  unit: string | null;
  polarity: Polarity;
  source: StatSource | null;
}

export interface Card {
  library: string;
  /** Library homepage, opened when the card image is clicked. */
  url: string | null;
  imgUrl: string | null;
  /** Multiplier on the fitted logo size, to even out logos with more or less padding. */
  imgScale: number;
  /** Brand color "#rrggbb" for the card frame; filled by `npm run colors`. */
  color: string | null;
  stats: Readonly<Record<string, number>>;
}

export function beats(category: Category, a: number, b: number): boolean {
  return category.polarity === "positive" ? a > b : a < b;
}

export function bestValue(category: Category, values: number[]): number {
  return category.polarity === "positive" ? Math.max(...values) : Math.min(...values);
}

export function cardValue(card: Card, category: Category): number {
  return card.stats[category.label]!;
}

export function polarityHint(category: Category): string {
  return category.polarity === "positive" ? "higher wins" : "lower wins";
}

const exactFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

/**
 * A stat value as shown to players: unitless counts compact ("50.6k", "18B"), values with a unit exact plus
 * unit ("417 MB"). `exact` spells counts out in full, for when compact values would look equal.
 */
export function formatStat(category: Category, value: number, exact = false): string {
  if (category.unit) return `${exactFormat.format(value)} ${category.unit}`;
  return exact ? exactFormat.format(value) : compactFormat.format(value).replace("K", "k");
}
