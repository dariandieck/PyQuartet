import { colors, font } from "./theme.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function centeredRect(cx: number, cy: number, w: number, h: number): Rect {
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h;
}

export function fillRoundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number, color: string): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Strokes inside the rect, so borders don't grow the visual size. */
export function strokeRoundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number, color: string, width: number): void {
  const inset = width / 2;
  ctx.beginPath();
  ctx.roundRect(r.x + inset, r.y + inset, r.w - width, r.h - width, Math.max(radius - inset, 0));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export interface TextStyle {
  size: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle): number {
  ctx.font = font(style.size, style.bold);
  ctx.fillStyle = style.color ?? colors.text;
  ctx.textAlign = style.align ?? "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

export function textWidth(ctx: CanvasRenderingContext2D, text: string, size: number, bold = false): number {
  ctx.font = font(size, bold);
  return ctx.measureText(text).width;
}

/** Largest font size <= `size` at which `text` fits into `maxWidth`. */
export function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  bold = false,
  minSize = 9,
): number {
  const width = textWidth(ctx, text, size, bold);
  if (width <= maxWidth) return size;
  return Math.max(minSize, Math.floor(size * (maxWidth / width) * 10) / 10);
}

/** Polarity arrow; the down arrow is the mirrored up arrow, so both are exactly the same size. */
export function drawArrow(ctx: CanvasRenderingContext2D, up: boolean, cx: number, cy: number, size = 5): void {
  const h = size * 1.8;
  ctx.save();
  ctx.translate(cx, cy);
  if (!up) ctx.scale(1, -1);
  ctx.beginPath();
  ctx.moveTo(-size, h / 2);
  ctx.lineTo(size, h / 2);
  ctx.lineTo(0, -h / 2);
  ctx.closePath();
  ctx.fillStyle = up ? colors.arrowUp : colors.arrowDown;
  ctx.fill();
  ctx.restore();
}
