import type { AppContext } from "../scenes/scene.ts";
import type { Rect } from "./draw.ts";

export interface HtmlInputOptions {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  /** Rewrites the text while typing, e.g. to force upper case. */
  transform?: (value: string) => string;
  onEnter?: () => void;
}

/**
 * A real <input> positioned over a logical rect of the canvas (canvas text entry would need its own caret,
 * selection, IME and mobile keyboard handling). Call `sync()` every frame so it follows window resizes.
 */
export class HtmlInput {
  readonly element: HTMLInputElement;

  constructor(
    private readonly app: AppContext,
    public rect: Rect,
    options: HtmlInputOptions = {},
  ) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "game-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = options.value ?? "";
    input.placeholder = options.placeholder ?? "";
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.transform) {
      const transform = options.transform;
      input.addEventListener("input", () => {
        const next = transform(input.value);
        if (next !== input.value) input.value = next;
      });
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") options.onEnter?.();
    });
    app.overlay.append(input);
    this.element = input;
    this.sync();
  }

  get value(): string {
    return this.element.value;
  }

  set visible(visible: boolean) {
    this.element.style.display = visible ? "" : "none";
  }

  focus(): void {
    this.element.focus();
  }

  sync(): void {
    const box = this.app.toCss(this.rect);
    const style = this.element.style;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
    style.fontSize = `${20 * box.scale}px`;
    style.borderRadius = `${10 * box.scale}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
