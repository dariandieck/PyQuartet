import { contains, drawText, fillRoundRect, strokeRoundRect, type Point, type Rect } from "./draw.ts";
import { colors } from "./theme.ts";

export class Button {
  enabled = true;
  visible = true;
  /** Toggle buttons (e.g. a mode choice): null for a plain button, false draws it muted. */
  selected: boolean | null = null;

  constructor(
    public rect: Rect,
    public text: string,
    private readonly onClick: () => void,
    private readonly size = 21,
  ) {}

  hovered(p: Point): boolean {
    return this.visible && this.enabled && contains(this.rect, p);
  }

  /** Returns true if the click hit this button. */
  click(p: Point): boolean {
    if (!this.hovered(p)) return false;
    this.onClick();
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, mouse: Point): void {
    if (!this.visible) return;
    const muted = this.selected === false;
    const hover = this.hovered(mouse);
    const fill = !this.enabled
      ? colors.buttonDisabled
      : muted
        ? hover ? colors.button : colors.bgAccent
        : hover ? colors.buttonHover : colors.button;
    fillRoundRect(ctx, this.rect, 10, fill);
    strokeRoundRect(ctx, this.rect, 10, this.enabled && !muted ? colors.pyYellow : colors.textDim, 2);
    drawText(ctx, this.text, this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2 + 1, {
      size: this.size,
      color: this.enabled ? colors.text : colors.textDim,
      bold: true,
    });
  }
}
