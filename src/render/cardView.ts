import { cardValue, formatStat, type Card, type Category } from "../game/model.ts";
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
const MIN_IMAGE_H = 66;
const MAX_ROW_H = 28;
const STATS_BOTTOM = CARD_H - 10;
const PAD = 12;
const FULL: Rect = { x: 0, y: 0, w: CARD_W, h: CARD_H };

const CHIP_H = 18;
const CHIP_GAP = 5;
const CHIP_FONT = 10.5;
const SUMMARY_SIZES = [13.5, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9];
const LINE_HEIGHT = 1.32;

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

interface InfoWord {
  text: string;
  x: number;
  y: number;
  width: number;
  bold: boolean;
  link: boolean;
}

/** Positions on the info side, computed once per card (also used to hit-test the homepage link). */
interface InfoLayout {
  chips: { text: string; rect: Rect }[];
  dividerY: number;
  size: number;
  words: InfoWord[];
  linkRects: Rect[];
}

/** Draws cards in card-local coordinates (0..CARD_W, 0..CARD_H); callers set up the transform. */
export class CardRenderer {
  readonly rows: StatRow[];
  private readonly imageBox: Rect;
  private readonly fontSize: number;
  private readonly infoLayouts = new WeakMap<Card, InfoLayout>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(
    categories: Category[],
    private readonly images: ImageStore,
  ) {
    // The card keeps its size (the own hand card would leave the screen otherwise): more categories mean
    // slimmer rows and a flatter logo box, down to MIN_IMAGE_H.
    const count = Math.max(categories.length, 1);
    const rowH = Math.min(MAX_ROW_H, (STATS_BOTTOM - IMAGE_TOP - MIN_IMAGE_H - 8) / count);
    const statsTop = STATS_BOTTOM - count * rowH;
    this.imageBox = { x: PAD, y: IMAGE_TOP, w: CARD_W - 2 * PAD, h: statsTop - 8 - IMAGE_TOP };
    this.fontSize = Math.min(14.5, rowH * 0.56);
    this.rows = categories.map((category, i) => ({
      category,
      rect: { x: PAD / 2, y: statsTop + i * rowH, w: CARD_W - PAD, h: rowH - 2 },
    }));
  }

  /** Card face with the accent header (library name); returns the accent color. */
  private drawFace(ctx: CanvasRenderingContext2D, card: Card): string {
    const accent = card.color ?? libraryColor(card.library);
    fillRoundRect(ctx, FULL, RADIUS, colors.cardFace);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, CARD_W, CARD_H, RADIUS);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, CARD_W, HEADER_H);
    ctx.restore();
    const nameSize = fitFontSize(ctx, card.library, CARD_W - 2 * PAD, 21, true);
    drawText(ctx, card.library, CARD_W / 2, HEADER_H / 2 + 1, { size: nameSize, color: textColorOn(accent), bold: true });
    return accent;
  }

  drawFront(ctx: CanvasRenderingContext2D, card: Card, state: FaceState): void {
    const accent = this.drawFace(ctx, card);
    const onAccent = textColorOn(accent);

    const box = this.imageBox;
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
      ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(35, box.h / 2 - 4), 0, Math.PI * 2);
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
    const valueText = formatStat(category, value);
    const valueSize = fitFontSize(ctx, valueText, 90, this.fontSize, true);
    const valueWidth = textWidth(ctx, valueText, valueSize, true);
    drawText(ctx, valueText, rect.x + rect.w - 6, cy, { size: valueSize, color: colors.cardText, bold: true, align: "right" });
    const labelSize = fitFontSize(ctx, category.label, rect.w - 22 - valueWidth - 12, this.fontSize);
    drawText(ctx, category.label, rect.x + 18, cy, { size: labelSize, color: colors.cardText, align: "left" });
  }

  /** The side you flip your hand card to: keywords as chips and the summary, whose library name links home. */
  drawInfo(ctx: CanvasRenderingContext2D, card: Card): void {
    const accent = this.drawFace(ctx, card);
    const layout = this.infoLayout(card);
    for (const { text, rect } of layout.chips) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      fillRoundRect(ctx, rect, rect.h / 2, accent);
      ctx.restore();
      strokeRoundRect(ctx, rect, rect.h / 2, accent, 1);
      const size = fitFontSize(ctx, text, rect.w - 10, CHIP_FONT);
      drawText(ctx, text, rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5, { size, color: colors.cardText });
    }
    ctx.fillStyle = "rgba(30, 34, 44, 0.15)";
    ctx.fillRect(PAD, layout.dividerY, CARD_W - 2 * PAD, 1);
    if (layout.words.length === 0) {
      drawText(ctx, "No description yet", CARD_W / 2, (layout.dividerY + CARD_H) / 2, { size: 13, color: colors.textDim });
    }
    for (const word of layout.words) {
      const color = word.link ? colors.pyBlue : colors.cardText;
      drawText(ctx, word.text, word.x, word.y, { size: layout.size, color, bold: word.bold, align: "left" });
      if (word.link) {
        ctx.fillStyle = colors.pyBlue;
        ctx.fillRect(word.x, word.y + layout.size * 0.55, word.width, 1);
      }
    }
    strokeRoundRect(ctx, FULL, RADIUS, accent, 3);
  }

  /** Whether a card-local point is on the library name link of the info side. */
  infoLinkAt(card: Card, p: Point): boolean {
    return this.infoLayout(card).linkRects.some((rect) => contains(rect, p));
  }

  private measure(): CanvasRenderingContext2D {
    // Hit-testing needs the text layout outside of drawing, so measuring has its own context.
    this.measureCtx ??= document.createElement("canvas").getContext("2d")!;
    return this.measureCtx;
  }

  private infoLayout(card: Card): InfoLayout {
    const cached = this.infoLayouts.get(card);
    if (cached) return cached;
    const ctx = this.measure();
    const width = CARD_W - 2 * PAD;

    const chips: InfoLayout["chips"] = [];
    let x = PAD;
    let y = HEADER_H + 10;
    for (const text of card.keywords) {
      const w = Math.min(width, textWidth(ctx, text, CHIP_FONT) + 14);
      if (x > PAD && x + w > PAD + width) {
        x = PAD;
        y += CHIP_H + CHIP_GAP;
      }
      chips.push({ text, rect: { x, y, w, h: CHIP_H } });
      x += w + CHIP_GAP;
    }
    const dividerY = (chips.length ? y + CHIP_H : HEADER_H) + 9;

    // The summary starts with the library name (see the card texts), which becomes the homepage link.
    const summary = card.summary ?? "";
    const tokens = summary.split(/\s+/).filter(Boolean);
    const startsWithName = summary.startsWith(card.library) && !/[\w-]/.test(summary.charAt(card.library.length));
    const nameTokens = startsWithName ? card.library.split(/\s+/).length : 0;
    const top = dividerY + 9;
    const bottom = CARD_H - 12;
    let words: InfoWord[] = [];
    let size = SUMMARY_SIZES[0]!;
    // Largest font size at which the whole summary fits.
    for (size of SUMMARY_SIZES) {
      words = [];
      const lineH = size * LINE_HEIGHT;
      const space = textWidth(ctx, " ", size);
      let line = 0;
      let cursor = PAD;
      tokens.forEach((text, i) => {
        const bold = i < nameTokens;
        const w = textWidth(ctx, text, size, bold);
        if (cursor > PAD && cursor + w > PAD + width) {
          line += 1;
          cursor = PAD;
        }
        words.push({ text, x: cursor, y: top + (line + 0.5) * lineH, width: w, bold, link: bold && card.url !== null });
        cursor += w + space;
      });
      if (top + (line + 1) * lineH <= bottom) break;
    }
    const lineH = size * LINE_HEIGHT;
    const linkRects = words
      .filter((w) => w.link)
      .map((w) => ({ x: w.x - 3, y: w.y - lineH / 2 - 2, w: w.width + 6, h: lineH + 4 }));
    const layout = { chips, dividerY, size, words, linkRects };
    this.infoLayouts.set(card, layout);
    return layout;
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
  /**
   * 0 = face down (PyQuartet back), 1 = front with the values, 2 = info side (keywords + summary);
   * the width follows |cos| to fake a 3D flip between them.
   */
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

  get side(): "back" | "front" | "info" {
    return this.turn < 0.5 ? "back" : this.turn < 1.5 ? "front" : "info";
  }

  /** Not in the middle of a flip. */
  get settled(): boolean {
    return Math.abs(Math.cos(Math.PI * this.turn)) > 0.95;
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
    const side = this.side;
    if (side === "info") renderer.drawInfo(ctx, this.card);
    else if (side === "front") renderer.drawFront(ctx, this.card, this);
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
    if (this.side !== "front" || !this.settled) return null;
    const local = this.toLocal(p);
    if (!local) return null;
    return renderer.rows.find((row) => contains(row.rect, local))?.category ?? null;
  }

  /** Homepage link if `p` is on the library name in the summary of the info side (not mid-flip). */
  linkAt(p: Point, renderer: CardRenderer): string | null {
    if (!this.card.url || this.side !== "info" || !this.settled) return null;
    const local = this.toLocal(p);
    return local && renderer.infoLinkAt(this.card, local) ? this.card.url : null;
  }
}

/** Topmost card under `p` whose info side links to the library homepage. */
export function linkAt(sprites: Iterable<CardSprite>, p: Point, renderer: CardRenderer): string | null {
  const byZ = [...sprites].sort((a, b) => b.z - a.z);
  for (const sprite of byZ) {
    if (contains(sprite.rect(), p)) return sprite.linkAt(p, renderer);
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
  labelColor: string = colors.text,
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
  const size = fitFontSize(ctx, label, 220, 17, true);
  drawText(ctx, label, cx, cy + h / 2 + 22, { size, color: labelColor, bold: true });
}
