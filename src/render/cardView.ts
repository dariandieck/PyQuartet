import { cardValue, displayLabel, formatValue, type Card, type Category } from "../game/model.ts";
import {
  contains,
  drawArrow,
  drawText,
  fillRoundRect,
  fitFontSize,
  strokeRoundRect,
  textWidth,
  type Point,
  type Rect,
} from "./draw.ts";
import type { ImageStore } from "./images.ts";
import { colors, libraryColor, textColorOn } from "./theme.ts";

export const CARD_W = 220;
export const CARD_H = 310;
const RADIUS = 14;
const HEADER_H = 40;
const IMAGE_TOP = 48;
const IMAGE_H = 100;
const STATS_TOP = 158;
const STATS_BOTTOM = CARD_H - 12;
const PAD = 12;
const FULL: Rect = { x: 0, y: 0, w: CARD_W, h: CARD_H };
const IMAGE_BOX: Rect = { x: PAD, y: IMAGE_TOP, w: CARD_W - 2 * PAD, h: IMAGE_H };
const PLACEHOLDER_RADIUS = 35;

export type Outcome = "win" | "lose" | "tie";

const OUTCOME_COLORS: Record<Outcome, string> = {
  win: colors.rowWin,
  lose: colors.rowLose,
  tie: colors.rowTie,
};

export interface FaceState {
  highlight: string | null;
  outcome: Outcome | null;
  hover: string | null;
}

export interface StatRow {
  category: Category;
  rect: Rect;
}

/** Draws cards in card-local coordinates (0..CARD_W, 0..CARD_H); callers set up the transform. */
export class CardRenderer {
  readonly rows: StatRow[];

  constructor(
    categories: Category[],
    private readonly images: ImageStore,
  ) {
    const rowH = (STATS_BOTTOM - STATS_TOP) / Math.max(categories.length, 1);
    this.rows = categories.map((category, i) => ({
      category,
      rect: { x: PAD / 2, y: STATS_TOP + i * rowH, w: CARD_W - PAD, h: rowH - 2 },
    }));
  }

  drawFront(ctx: CanvasRenderingContext2D, card: Card, state: FaceState): void {
    const accent = card.color ?? libraryColor(card.library);
    const onAccent = textColorOn(accent);
    fillRoundRect(ctx, FULL, RADIUS, colors.cardFace);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, CARD_W, CARD_H, RADIUS);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, CARD_W, HEADER_H);
    ctx.restore();
    const nameSize = fitFontSize(ctx, card.library, CARD_W - 2 * PAD, 21, true);
    drawText(ctx, card.library, CARD_W / 2, HEADER_H / 2 + 1, { size: nameSize, color: onAccent, bold: true });

    const box = IMAGE_BOX;
    fillRoundRect(ctx, box, 8, colors.white);
    const image = this.images.get(card);
    if (image && image.naturalWidth > 0) {
      const fit = Math.min((box.w - 8) / image.naturalWidth, (box.h - 8) / image.naturalHeight);
      const w = image.naturalWidth * fit * card.imgScale;
      const h = image.naturalHeight * fit * card.imgScale;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 8);
      ctx.clip(); // img_scale > 1 must not spill over the stats
      ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(box.x + box.w / 2, box.y + box.h / 2, PLACEHOLDER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      drawText(ctx, card.library.slice(0, 2).toUpperCase(), box.x + box.w / 2, box.y + box.h / 2 + 1, {
        size: 25,
        color: onAccent,
        bold: true,
      });
    }

    for (const { category, rect } of this.rows) {
      let fill: string | null = null;
      if (category.label === state.highlight) fill = state.outcome ? OUTCOME_COLORS[state.outcome] : colors.rowSelected;
      else if (category.label === state.hover) fill = colors.rowHover;
      if (fill) fillRoundRect(ctx, rect, 6, fill);
      this.drawRow(ctx, rect, category, cardValue(card, category));
    }

    strokeRoundRect(ctx, FULL, RADIUS, accent, 3);
  }

  private drawRow(ctx: CanvasRenderingContext2D, rect: Rect, category: Category, value: number): void {
    const cy = rect.y + rect.h / 2;
    drawArrow(ctx, category.polarity === "positive", rect.x + 9, cy, 4.5);
    const valueText = formatValue(value);
    const valueSize = fitFontSize(ctx, valueText, 90, 14.5, true);
    const valueWidth = textWidth(ctx, valueText, valueSize, true);
    drawText(ctx, valueText, rect.x + rect.w - 6, cy, { size: valueSize, color: colors.cardText, bold: true, align: "right" });
    const label = displayLabel(category);
    const labelSize = fitFontSize(ctx, label, rect.w - 22 - valueWidth - 12, 14.5);
    drawText(ctx, label, rect.x + 18, cy, { size: labelSize, color: colors.cardText, align: "left" });
  }

  drawBack(ctx: CanvasRenderingContext2D): void {
    fillRoundRect(ctx, FULL, RADIUS, colors.cardBack);
    const inner: Rect = { x: 12, y: 12, w: CARD_W - 24, h: CARD_H - 24 };
    ctx.beginPath();
    for (let x = inner.x + 16; x < inner.x + inner.w; x += 16) {
      ctx.moveTo(x, inner.y);
      ctx.lineTo(x, inner.y + inner.h);
    }
    for (let y = inner.y + 16; y < inner.y + inner.h; y += 16) {
      ctx.moveTo(inner.x, y);
      ctx.lineTo(inner.x + inner.w, y);
    }
    ctx.strokeStyle = colors.cardBackGrid;
    ctx.lineWidth = 1;
    ctx.stroke();
    strokeRoundRect(ctx, inner, 10, colors.pyYellow, 3);

    const badge: Rect = { x: (CARD_W - 176) / 2, y: (CARD_H - 96) / 2, w: 176, h: 96 };
    fillRoundRect(ctx, badge, 12, colors.pyBlue);
    strokeRoundRect(ctx, badge, 12, colors.pyYellow, 2);
    const size = fitFontSize(ctx, "PyQuartet", badge.w - 16, 31, true);
    const pyWidth = textWidth(ctx, "Py", size, true);
    const left = CARD_W / 2 - textWidth(ctx, "PyQuartet", size, true) / 2;
    drawText(ctx, "Py", left, CARD_H / 2 + 1, { size, color: colors.pyYellow, bold: true, align: "left" });
    drawText(ctx, "Quartet", left + pyWidth, CARD_H / 2 + 1, { size, color: colors.white, bold: true, align: "left" });

    strokeRoundRect(ctx, FULL, RADIUS, colors.pyYellow, 3);
  }

  /** Cheap stand-in for the cards under the top of a pile; only their edges are visible. */
  drawBackEdge(ctx: CanvasRenderingContext2D): void {
    fillRoundRect(ctx, FULL, RADIUS, colors.cardBack);
    strokeRoundRect(ctx, FULL, RADIUS, colors.pyYellow, 3);
  }

  drawShadow(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
    fillRoundRect(ctx, { ...FULL, x: dx, y: dy }, RADIUS, colors.shadow);
  }
}

export class CardSprite implements FaceState {
  scale = 1;
  /** 0 = face down, 1 = face up; the width follows |cos| to fake a 3D flip. */
  turn = 0;
  z = 0;
  highlight: string | null = null;
  outcome: Outcome | null = null;
  hover: string | null = null;

  constructor(
    public card: Card,
    public x: number,
    public y: number,
    init: Partial<Pick<CardSprite, "scale" | "turn" | "z">> = {},
  ) {
    Object.assign(this, init);
  }

  get faceUp(): boolean {
    return this.turn >= 0.5;
  }

  rect(): Rect {
    const w = CARD_W * this.scale;
    const h = CARD_H * this.scale;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  draw(ctx: CanvasRenderingContext2D, renderer: CardRenderer): void {
    const squash = Math.abs(Math.cos(Math.PI * this.turn));
    if (squash < 0.01) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale * squash, this.scale);
    ctx.translate(-CARD_W / 2, -CARD_H / 2);
    renderer.drawShadow(ctx, 6, 8);
    if (this.faceUp) renderer.drawFront(ctx, this.card, this);
    else renderer.drawBack(ctx);
    ctx.restore();
  }

  private toLocal(p: Point): Point | null {
    const r = this.rect();
    if (!contains(r, p)) return null;
    return { x: (p.x - r.x) / this.scale, y: (p.y - r.y) / this.scale };
  }

  /** Hit-tests a logical point against the stat rows (only meaningful while face up and unflipped). */
  categoryAt(p: Point, renderer: CardRenderer): Category | null {
    const local = this.toLocal(p);
    if (!local) return null;
    return renderer.rows.find((row) => contains(row.rect, local))?.category ?? null;
  }

  /** Homepage link if `p` is on the logo of a fully face-up card (not mid-flip). */
  linkAt(p: Point): string | null {
    if (!this.card.url || Math.abs(Math.cos(Math.PI * this.turn)) < 0.95 || !this.faceUp) return null;
    const local = this.toLocal(p);
    return local && contains(IMAGE_BOX, local) ? this.card.url : null;
  }
}

/** Topmost card under `p` whose logo links to the library homepage. */
export function linkAt(sprites: Iterable<CardSprite>, p: Point): string | null {
  const byZ = [...sprites].sort((a, b) => b.z - a.z);
  for (const sprite of byZ) {
    if (contains(sprite.rect(), p)) return sprite.linkAt(p);
  }
  return null;
}

export function drawPile(
  ctx: CanvasRenderingContext2D,
  renderer: CardRenderer,
  cx: number,
  cy: number,
  count: number,
  scale: number,
  label: string,
): void {
  const h = CARD_H * scale;
  if (count <= 0) {
    const empty: Rect = { x: cx - (CARD_W * scale) / 2, y: cy - h / 2, w: CARD_W * scale, h };
    fillRoundRect(ctx, empty, RADIUS * scale, colors.bgAccent);
    strokeRoundRect(ctx, empty, RADIUS * scale, colors.textDim, 2);
  } else {
    const layers = Math.min(count, 8);
    for (let i = 0; i < layers; i++) {
      const offset = (layers - 1 - i) * 3;
      ctx.save();
      ctx.translate(cx + offset, cy + offset);
      ctx.scale(scale, scale);
      ctx.translate(-CARD_W / 2, -CARD_H / 2);
      if (i === 0) renderer.drawShadow(ctx, 8, 12);
      if (i === layers - 1) renderer.drawBack(ctx);
      else renderer.drawBackEdge(ctx);
      ctx.restore();
    }
  }
  drawText(ctx, label, cx, cy + h / 2 + 22, { size: 17, color: colors.text, bold: true });
}
