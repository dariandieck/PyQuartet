/** What the card gallery searches in; pure data, so the scoring can be tested without a DOM. */
export interface SearchEntry {
  library: string;
  pypi: string | null;
  repo: string | null;
  url: string | null;
  keywords: readonly string[];
  summary: string | null;
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** How well one lower-case query word matches an entry; 0 means not at all. The best field counts. */
function wordScore(word: string, entry: SearchEntry): number {
  const name = entry.library.toLowerCase();
  let best = name === word ? 100 : name.startsWith(word) ? 70 : 0;

  for (const id of [entry.pypi, entry.repo]) {
    if (!id) continue;
    const value = id.toLowerCase();
    // The package or repo name is the library under another name: "torch" ranks PyTorch above TorchVision.
    if (value === word || value.split("/").includes(word)) best = Math.max(best, 80);
    else if (value.includes(word)) best = Math.max(best, 35);
  }
  for (const keyword of entry.keywords) {
    const value = keyword.toLowerCase();
    if (value === word) best = Math.max(best, 50);
    else if (value.split("-").some((part) => part.startsWith(word))) best = Math.max(best, 40);
    else if (value.includes(word)) best = Math.max(best, 25);
  }
  if (name.includes(word)) best = Math.max(best, 30);
  if (entry.summary) {
    if (words(entry.summary).some((w) => w.startsWith(word))) best = Math.max(best, 12);
    else if (entry.summary.toLowerCase().includes(word)) best = Math.max(best, 6);
  }
  if (entry.url?.toLowerCase().includes(word)) best = Math.max(best, 5);
  return best;
}

const byName = (a: SearchEntry, b: SearchEntry) => a.library.localeCompare(b.library, "en", { sensitivity: "base" });

/**
 * Entries sorted by a number (a category value), or by name without `value`. Equal values stay alphabetical
 * in both directions, so a descending sort doesn't reverse them into Z to A.
 */
export function sortEntries<T extends SearchEntry>(
  entries: readonly T[],
  value: ((entry: T) => number) | null,
  descending: boolean,
): T[] {
  const sign = descending ? -1 : 1;
  const compare = value ? (a: T, b: T) => value(a) - value(b) : byName;
  return [...entries].sort((a, b) => sign * compare(a, b) || byName(a, b));
}

/**
 * Entries matching every word of the query, best hits first (equal scores alphabetically).
 * An empty query returns all entries alphabetically.
 */
export function searchCards<T extends SearchEntry>(entries: readonly T[], query: string): T[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return [...entries].sort(byName);
  const hits: { entry: T; score: number }[] = [];
  for (const entry of entries) {
    let score = 0;
    for (const word of queryWords) {
      const s = wordScore(word, entry);
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) hits.push({ entry, score });
  }
  return hits.sort((a, b) => b.score - a.score || byName(a.entry, b.entry)).map((hit) => hit.entry);
}
