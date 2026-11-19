// Fetches every card's stats (GitHub, pepy.tech) and writes them into data/cards.json.
// Usage: npm run stats                       (all cards)
//        npm run stats -- pandas numpy       (only these libraries)
// Missing "pypi"/"repo" fields are looked up from the library name and homepage and saved as well.
// Optional keys in .env.local: GITHUB_TOKEN (higher rate limit), PEPY_API_KEY (exact downloads).
import { readCards, readCategories, writeCards } from "./lib/cardsFile.ts";
import { LookupError } from "./lib/http.ts";
import { credentialsFromEnv, fetchStat, resolveLibrary } from "./lib/lookup.ts";

const credentials = credentialsFromEnv(process.env);
const only = new Set(process.argv.slice(2).map((name) => name.toLowerCase()));
const categories = await readCategories();
const cards = await readCards();
const reason = (error: unknown) => (error instanceof LookupError ? error.message : String(error));

if (!credentials.pepyApiKey) console.log("No PEPY_API_KEY: downloads are rounded (pepy badge).");
let failures = 0;

// One card after another: parallel requests would only hit GitHub's rate limit sooner.
for (const card of cards) {
  if (only.size && !only.has(card.library.toLowerCase())) continue;
  if (!card.repo || !card.pypi) {
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

await writeCards(cards, categories);
console.log(`Wrote data/cards.json${failures ? ` (${failures} value(s) kept because the lookup failed)` : ""}`);
