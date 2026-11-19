import sharp from "sharp";
import { LookupError } from "./http.ts";

async function download(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; pyquartet-colors)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new LookupError(`image not reachable (${(error as Error).message})`);
  }
  if (!response.ok) throw new LookupError(`image download failed (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Most prominent vivid color: pixels are grouped into coarse RGB buckets, transparent, white, black and grey
 * pixels are ignored (backgrounds, outlines, neutral text), and each pixel counts with its chroma (max - min channel).
 * Chroma rather than HSL saturation, because pale anti-aliasing tints of thin strokes have a high HSL saturation
 * but a low chroma, so they can't outvote the solid brand color.
 */
async function brandColor(buffer: Buffer): Promise<string | null> {
  let data: Buffer;
  try {
    ({ data } = await sharp(buffer, { density: 150 })
      .resize(320, 320, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new LookupError("not a readable image");
  }

  const buckets = new Map<number, { weight: number; n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (data[i + 3]! < 200) continue;
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

  let best: { weight: number; n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? hex(best.r / best.n, best.g / best.n, best.b / best.n) : null;
}

/** Brand color of the logo at `url`, or null when the logo has no saturated color (e.g. all black). */
export async function brandColorOf(url: string): Promise<string | null> {
  return brandColor(await download(url));
}
