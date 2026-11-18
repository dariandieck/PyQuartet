export type Polarity = "positive" | "negative"; // positive: higher value wins, negative: lower value wins

export interface Category {
  label: string;
  unit: string | null;
  polarity: Polarity;
  fetchUrl: string | null;
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

/** "<label> (<unit>)": only shown on the card itself; everywhere else uses the plain label. */
export function displayLabel(category: Category): string {
  return category.unit ? `${category.label} (${category.unit})` : category.label;
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

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatValue(value: number): string {
  return Number.isInteger(value) ? intFormat.format(value) : decimalFormat.format(value);
}
