export type Polarity = "positive" | "negative"; // positive: higher value wins, negative: lower value wins

/** Where `npm run stats` and the card editor fetch a category's value from. */
export const STAT_SOURCES = [
  "github_stars",
  "github_forks",
  "github_contributors",
  "pepy_downloads",
  "pypi_wheel_mb",
  "pypi_age_years",
  "depsdev_dependents",
] as const;
export type StatSource = (typeof STAT_SOURCES)[number];

/** Sources that need a PyPI package; the others need a GitHub repo. */
export function needsPypi(source: StatSource): boolean {
  return source === "pepy_downloads" || source === "pypi_wheel_mb" || source === "pypi_age_years" || source === "depsdev_dependents";
}

/** How a category's values are rounded in the game (see `roundStat`). */
export const ROUNDINGS = ["digits", "steps"] as const;
export type Rounding = (typeof ROUNDINGS)[number];

export interface Category {
  label: string;
  /** Real unit such as "MB"; unitless counts are shown compact instead ("50.6k"). */
  unit: string | null;
  polarity: Polarity;
  source: StatSource | null;
  /** In-game rounding; "digits" when left out. */
  rounding?: Rounding;
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
  /** GitHub-topic-like tags naming the core of the library, e.g. "data-analysis". */
  keywords: readonly string[];
  /** Two dense sentences for the card back (at most SUMMARY_MAX characters). */
  summary: string | null;
  stats: Readonly<Record<string, number>>;
}

/** Longest summary that still fits on the card back. */
export const SUMMARY_MAX = 300;

export function beats(category: Category, a: number, b: number): boolean {
  return category.polarity === "positive" ? a > b : a < b;
}

export function bestValue(category: Category, values: number[]): number {
  return category.polarity === "positive" ? Math.max(...values) : Math.min(...values);
}

export function cardValue(card: Card, category: Category): number {
  return card.stats[category.label]!;
}

const STEPS = [1, 2, 3, 5, 10];

/**
 * In-game rounding (data/cards.json keeps exact values), so close values tie more often. Both kinds are relative
 * to the magnitude and never turn a non-zero value into 0.
 * - "digits": one significant digit (7.8k → 8k, 9.5 → 10, 514 → 500), two when the leading digit is 1, where one
 *   digit would be too coarse (14.4 → 14, 1.22B → 1.2B).
 * - "steps": only 1, 2, 3 and 5 per power of ten (234M → 200M, 4.2k → 5k), for categories spread over many powers
 *   of ten, which tie too rarely with "digits". The nearest step is picked by ratio, not difference.
 */
export function roundStat(value: number, rounding: Rounding = "digits"): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = Math.abs(value);
  const base = 10 ** Math.floor(Math.log10(magnitude));
  if (rounding === "steps") {
    const ratio = (step: number) => Math.abs(Math.log((step * base) / magnitude));
    const step = STEPS.reduce((best, s) => (ratio(s) < ratio(best) ? s : best));
    // toPrecision drops float noise such as 3 * 0.1 = 0.30000000000000004.
    return Math.sign(value) * Number((step * base).toPrecision(1));
  }
  return Number(value.toPrecision(magnitude / base < 2 ? 2 : 1));
}

/** The card as played: stats rounded per category (see `roundStat`), so close values tie. */
export function playedCard(card: Card, categories: readonly Category[]): Card {
  const stats = Object.fromEntries(
    Object.entries(card.stats).map(([label, value]) => {
      const rounding = categories.find((c) => c.label === label)?.rounding;
      return [label, roundStat(value, rounding)];
    }),
  );
  return { ...card, stats };
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
