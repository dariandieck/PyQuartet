import type { AppContext } from "../scenes/scene.ts";
import type { Rect } from "./draw.ts";

// Smallest comfortable touch target; the logical rect shrinks a lot on phones.
const MIN_HIT_PX = 44;
const MIN_THUMB_PX = 26;

export interface HtmlSliderOptions {
  min: number;
  max: number;
  value: number;
  label: string;
  onInput: (value: number) => void;
}

/**
 * A native range input over a logical rect of the canvas: dragging, touch and arrow keys come for free,
 * which a canvas-drawn slider would have to rebuild (and fight the page's pinch zoom on phones).
 * Call `sync()` every frame so it follows window resizes.
 */
export class HtmlSlider {
  readonly element: HTMLInputElement;

  constructor(
    private readonly app: AppContext,
    public rect: Rect,
    options: HtmlSliderOptions,
  ) {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "game-slider";
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = "1";
    input.value = String(options.value);
    input.setAttribute("aria-label", options.label);
    input.addEventListener("input", () => options.onInput(this.value));
    app.overlay.append(input);
    this.element = input;
    this.sync();
  }

  get value(): number {
    return Number(this.element.value);
  }

  set visible(visible: boolean) {
    this.element.style.display = visible ? "" : "none";
  }

  sync(): void {
    const box = this.app.toCss(this.rect);
    const height = Math.max(box.height, MIN_HIT_PX);
    const style = this.element.style;
    style.left = `${box.left}px`;
    style.top = `${box.top - (height - box.height) / 2}px`;
    style.width = `${box.width}px`;
    style.height = `${height}px`;
    style.setProperty("--thumb", `${Math.max(MIN_THUMB_PX, 30 * box.scale)}px`);
    style.setProperty("--track", `${Math.max(4, 8 * box.scale)}px`);
  }

  dispose(): void {
    this.element.remove();
  }
}
