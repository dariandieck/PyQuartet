import type { Card } from "../game/model.ts";

/**
 * Card images loaded straight from each card's `img_url`; cards show an initials placeholder until (or unless)
 * the image arrives. Cross-origin images may be drawn onto the canvas without CORS because we never read pixels back.
 */
export class ImageStore {
  private readonly images = new Map<string, HTMLImageElement>();

  load(cards: Card[]): void {
    for (const card of cards) {
      if (!card.imgUrl) continue;
      const image = new Image();
      image.decoding = "async";
      // Some image hosts block hotlinking based on the Referer header.
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => this.images.set(card.library, image));
      image.addEventListener("error", () => console.warn(`[images] could not load ${card.imgUrl}`));
      image.src = card.imgUrl;
    }
  }

  get(card: Card): HTMLImageElement | undefined {
    return this.images.get(card.library);
  }
}
