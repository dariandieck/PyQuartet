import type { Point } from "./draw.ts";
import { SCREEN_H, SCREEN_W } from "./theme.ts";

// Upper bound for the backing store: mobile browsers refuse (or silently blank) canvases beyond ~16 MP.
const MAX_CANVAS_PIXELS = 12_000_000;

/** Device pixels per CSS pixel, including pinch zoom, so a zoomed-in canvas is re-rendered instead of upscaled. */
function pixelDensity(): number {
  return (window.devicePixelRatio || 1) * (window.visualViewport?.scale ?? 1);
}

/**
 * Maps the fixed logical 1280x720 scene onto the window: the backing store has full device-pixel resolution
 * (so text and shapes stay sharp on HiDPI screens and when pinch-zoomed) and the scene is letterboxed to keep
 * its aspect ratio.
 */
export class Viewport {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  /** Backing-store pixels per CSS pixel. */
  density = 1;
  private cssW = 0;
  private cssH = 0;
  private wantedDensity = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  needsResize(): boolean {
    return (
      this.canvas.clientWidth !== this.cssW ||
      this.canvas.clientHeight !== this.cssH ||
      pixelDensity() !== this.wantedDensity
    );
  }

  resize(): void {
    this.wantedDensity = pixelDensity();
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    const cap = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(this.cssW * this.cssH, 1));
    this.density = Math.min(this.wantedDensity, cap);
    this.canvas.width = Math.round(this.cssW * this.density);
    this.canvas.height = Math.round(this.cssH * this.density);
    this.scale = Math.min(this.cssW / SCREEN_W, this.cssH / SCREEN_H);
    this.offsetX = (this.cssW - SCREEN_W * this.scale) / 2;
    this.offsetY = (this.cssH - SCREEN_H * this.scale) / 2;
  }

  apply(ctx: CanvasRenderingContext2D): void {
    const s = this.density * this.scale;
    ctx.setTransform(s, 0, 0, s, this.density * this.offsetX, this.density * this.offsetY);
  }

  toLogical(clientX: number, clientY: number): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.offsetX) / this.scale,
      y: (clientY - bounds.top - this.offsetY) / this.scale,
    };
  }
}
