import type { AppContext } from "../scenes/scene.ts";
import type { Rect } from "./draw.ts";

// iOS Safari zooms the whole page into any focused input with a smaller font, and stays zoomed.
const MIN_FONT_PX = 16;

export interface HtmlInputOptions {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  /** Extra CSS class, e.g. "code" for the upper-case room code look. */
  className?: string;
  /** Mobile keyboard hint, e.g. "characters" to start with caps. */
  autocapitalize?: "off" | "words" | "characters";
  /** Label of the mobile keyboard's enter key. */
  enterKeyHint?: "go" | "next" | "done";
  onEnter?: () => void;
}

/**
 * A real <input> positioned over a logical rect of the canvas (canvas text entry would need its own caret,
 * selection, IME and mobile keyboard handling). Call `sync()` every frame so it follows window resizes.
 * The value is never rewritten while typing: that breaks the composition of mobile keyboards (lost or doubled
 * characters), so callers normalize it when they read it.
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
    input.className = ["game-input", options.className].filter(Boolean).join(" ");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", options.autocapitalize ?? "words");
    if (options.enterKeyHint) input.enterKeyHint = options.enterKeyHint;
    input.value = options.value ?? "";
    input.placeholder = options.placeholder ?? "";
    if (options.maxLength) input.maxLength = options.maxLength;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) options.onEnter?.();
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
    // Closes the on-screen keyboard once the form is done.
    if (!visible) this.element.blur();
  }

  focus(): void {
    // Opening the keyboard unasked is annoying on phones; there the player taps the field.
    if (!matchMedia("(pointer: coarse)").matches) this.element.focus();
  }

  sync(): void {
    const box = this.app.toCss(this.rect);
    const fontSize = Math.max(MIN_FONT_PX, 20 * box.scale);
    const height = Math.max(box.height, fontSize * 1.6);
    const style = this.element.style;
    style.left = `${box.left}px`;
    style.top = `${box.top - (height - box.height) / 2}px`;
    style.width = `${box.width}px`;
    style.height = `${height}px`;
    style.fontSize = `${fontSize}px`;
    style.borderRadius = `${10 * box.scale}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
