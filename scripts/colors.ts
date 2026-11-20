// Extracts each library's brand color from its logo (img_url) and writes it as "color" into data/cards.json.
// Usage: npm run colors                 (recompute all cards)
//        npm run colors -- --missing    (only cards without a color yet, keeps manual overrides)
import { readCards, readCategories, writeCards } from "./lib/cardsFile.ts";
import { brandColorOf } from "./lib/colors.ts";

const onlyMissing = process.argv.includes("--missing");
const categories = await readCategories();
const cards = await readCards();
let changed = 0;

await Promise.all(
  cards.map(async (card) => {
    if (!card.img_url || (onlyMissing && card.color)) return;
    try {
      const color = await brandColorOf(card.img_url);
      if (!color) {
        console.warn(`${card.library.padEnd(14)} no saturated color found, keeping ${card.color ?? "fallback"}`);
        return;
      }
      console.log(`${card.library.padEnd(14)} ${color}`);
      if (color !== card.color) changed += 1;
      card.color = color;
    } catch (error) {
      console.warn(`${card.library.padEnd(14)} failed (${(error as Error).message}), keeping ${card.color ?? "fallback"}`);
    }
  }),
);

await writeCards(cards, categories);
console.log(`Updated ${changed} card color(s) in data/cards.json`);
