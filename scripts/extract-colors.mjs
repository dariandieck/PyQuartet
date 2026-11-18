// Extracts each library's brand color from its logo (img_url) and writes it as "color" into data/cards.json.
// Usage: npm run colors                 (recompute all cards)
//        npm run colors -- --missing    (only cards without a color yet, keeps manual overrides)
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const CARDS_FILE = new URL("../data/cards.json", import.meta.url);
const onlyMissing = process.argv.includes("--missing");

async function download(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; pyquartet-colors)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function hex(r, g, b) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Most prominent vivid color: pixels are grouped into coarse RGB buckets, transparent, white, black and grey
 * pixels are ignored (backgrounds, outlines, neutral text), and each pixel counts with its chroma (max - min channel).
 * Chroma rather than HSL saturation, because pale anti-aliasing tints of thin strokes have a high HSL saturation
 * but a low chroma, so they can't outvote the solid brand color.
 */
async function brandColor(buffer) {
  const { data } = await sharp(buffer, { density: 150 })
    .resize(320, 320, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const lightness = (max + min) / 2;
    const chroma = max - min;
    if (chroma < 0.25 || lightness < 0.08 || lightness > 0.92) continue;

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { weight: 0, n: 0, r: 0, g: 0, b: 0 };
    bucket.weight += chroma;
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? hex(best.r / best.n, best.g / best.n, best.b / best.n) : null;
}

/** Puts "color" right before "stats" so the JSON stays readable. */
function withColor(card, color) {
  const entries = Object.entries(card).filter(([key]) => key !== "color");
  const statsIndex = entries.findIndex(([key]) => key === "stats");
  entries.splice(statsIndex === -1 ? entries.length : statsIndex, 0, ["color", color]);
  return Object.fromEntries(entries);
}

const deck = JSON.parse(await readFile(CARDS_FILE, "utf8"));
let changed = 0;

deck.cards = await Promise.all(
  deck.cards.map(async (card) => {
    if (!card.img_url || (onlyMissing && card.color)) return card;
    try {
      const color = await brandColor(await download(card.img_url));
      if (!color) {
        console.warn(`${card.library.padEnd(14)} no saturated color found, keeping ${card.color ?? "fallback"}`);
        return card;
      }
      console.log(`${card.library.padEnd(14)} ${color}`);
      if (color !== card.color) changed += 1;
      return withColor(card, color);
    } catch (error) {
      console.warn(`${card.library.padEnd(14)} failed (${error.message}), keeping ${card.color ?? "fallback"}`);
      return card;
    }
  }),
);

await writeFile(CARDS_FILE, `${JSON.stringify(deck, null, 2)}\n`);
console.log(`Updated ${changed} card color(s) in data/cards.json`);
