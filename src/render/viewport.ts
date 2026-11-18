import type { Point } from "./draw.ts";
import { SCREEN_H, SCREEN_W } from "./theme.ts";

/**
 * Maps the fixed logical 1280x720 scene onto the window: the backing store has full device-pixel resolution
 * (so text and shapes stay sharp on HiDPI screens) and the scene is letterboxed to keep its aspect ratio.
 */
export class Viewport {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  dpr = 1;
  private cssW = 0;
  private cssH = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  needsResize(): boolean {
    return (
      this.canvas.clientWidth !== this.cssW ||
      this.canvas.clientHeight !== this.cssH ||
      (window.devicePixelRatio || 1) !== this.dpr
    );
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.scale = Math.min(this.cssW / SCREEN_W, this.cssH / SCREEN_H);
    this.offsetX = (this.cssW - SCREEN_W * this.scale) / 2;
    this.offsetY = (this.cssH - SCREEN_H * this.scale) / 2;
  }

  apply(ctx: CanvasRenderingContext2D): void {
    const s = this.dpr * this.scale;
    ctx.setTransform(s, 0, 0, s, this.dpr * this.offsetX, this.dpr * this.offsetY);
  }

  toLogical(clientX: number, clientY: number): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.offsetX) / this.scale,
      y: (clientY - bounds.top - this.offsetY) / this.scale,
    };
  }
}
