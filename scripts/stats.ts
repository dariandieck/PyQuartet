// Fetches every card's stats (GitHub, pepy.tech) and writes them into data/cards.json.
// Usage: npm run stats                              (all cards)
//        npm run stats -- pandas numpy              (only these libraries)
//        npm run stats -- --only=Age,Dependents     (only these categories; no pypi/repo lookup)
// Missing "pypi"/"repo" fields are looked up from the library name and homepage and saved as well.
// Stats of categories no longer in categories.json are dropped on write.
// Optional keys in .env.local: GITHUB_TOKEN (higher rate limit), PEPY_API_KEY (exact downloads).
import { readCards, readCategories, writeCards } from "./lib/cardsFile.ts";
import { LookupError } from "./lib/http.ts";
import { credentialsFromEnv, fetchStat, resolveLibrary } from "./lib/lookup.ts";

const credentials = credentialsFromEnv(process.env);
const args = process.argv.slice(2);
const only = new Set(args.filter((a) => !a.startsWith("--")).map((name) => name.toLowerCase()));
const onlyLabels = args
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .map((label) => label.trim().toLowerCase());
const categories = await readCategories();
const unknownLabels = onlyLabels?.filter((label) => !categories.some((c) => c.label.toLowerCase() === label)) ?? [];
if (unknownLabels.length) {
  console.error(`Unknown categories: ${unknownLabels.join(", ")} (have: ${categories.map((c) => c.label).join(", ")})`);
  process.exit(1);
}
const cards = await readCards();
const reason = (error: unknown) => (error instanceof LookupError ? error.message : String(error));

if (!credentials.pepyApiKey) console.log("No PEPY_API_KEY: downloads are rounded (pepy badge).");
let failures = 0;

// One card after another: parallel requests would only hit GitHub's rate limit sooner.
for (const card of cards) {
  if (only.size && !only.has(card.library.toLowerCase())) continue;
  if (!onlyLabels && (!card.repo || !card.pypi)) {
    try {
      const found = await resolveLibrary({ library: card.pypi ?? card.library, url: card.url }, credentials);
      card.repo ||= found.repo;
      card.pypi ||= found.pypi;
      if (found.pypi && !found.pypiLinked) console.warn(`${card.library}: PyPI package "${found.pypi}" is a guess, check it`);
    } catch (error) {
      console.warn(`${card.library}: lookup failed (${reason(error)})`);
    }
  }
  const results: string[] = [];
  for (const category of categories) {
    if (!category.source) continue;
    if (onlyLabels && !onlyLabels.includes(category.label.toLowerCase())) continue;
    try {
      const value = await fetchStat(category.source, card, credentials);
      card.stats[category.label] = value;
      results.push(`${category.label} ${value}`);
    } catch (error) {
      failures += 1;
      results.push(`${category.label} kept (${reason(error)})`);
    }
  }
  console.log(`${card.library.padEnd(14)} ${results.join(" | ")}`);
}

// A card can only be saved with a value for every category (e.g. right after adding a category).
const incomplete = cards.flatMap((card) =>
  categories.filter((c) => typeof card.stats[c.label] !== "number").map((c) => `${card.library}: ${c.label}`),
);
if (incomplete.length) {
  console.error(`Nothing written, these values are still missing:\n  ${incomplete.join("\n  ")}`);
  process.exit(1);
}
await writeCards(cards, categories);
console.log(`Wrote data/cards.json${failures ? ` (${failures} value(s) kept because the lookup failed)` : ""}`);
