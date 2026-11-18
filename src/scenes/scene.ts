import type { Deck } from "../game/deck.ts";
import type { CardRenderer } from "../render/cardView.ts";
import type { Point, Rect } from "../render/draw.ts";

export type InputEvent =
  | { kind: "move"; point: Point }
  | { kind: "down"; point: Point }
  | { kind: "key"; key: string };

export interface Scene {
  handle(event: InputEvent): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** Whether the cursor over `p` should show a pointer (clickable). */
  wantsPointer(p: Point): boolean;
  /** Called when the app switches away from this scene (remove DOM elements, close connections). */
  dispose?(): void;
}

/** Where a logical rect currently sits on the page, for positioning HTML elements over the canvas. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** CSS pixels per logical pixel. */
  scale: number;
}

export interface AppContext {
  readonly deck: Deck;
  readonly renderer: CardRenderer;
  readonly mouse: Point;
  /** Container for HTML elements layered over the canvas (e.g. text inputs). */
  readonly overlay: HTMLElement;
  toCss(rect: Rect): CssBox;
  switchTo(scene: Scene): void;
}
