import type { Deck } from "../game/deck.ts";
import type { CardRenderer } from "../render/cardView.ts";
import type { Point } from "../render/draw.ts";

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
}

export interface AppContext {
  readonly deck: Deck;
  readonly renderer: CardRenderer;
  readonly mouse: Point;
  switchTo(scene: Scene): void;
}
