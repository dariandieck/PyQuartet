import { loadDeck, type Deck } from "./game/deck.ts";
import { canFullscreen, enterFullscreen, isTouchDevice } from "./platform.ts";
import { CardRenderer } from "./render/cardView.ts";
import { drawText, type Point, type Rect } from "./render/draw.ts";
import { ImageStore } from "./render/images.ts";
import { colors } from "./render/theme.ts";
import { Viewport } from "./render/viewport.ts";
import { MenuScene } from "./scenes/menu.ts";
import type { AppContext, CssBox, InputEvent, Scene } from "./scenes/scene.ts";

const HANDLED_KEYS = new Set(["Enter", " ", "Escape", "ArrowUp", "ArrowDown"]);

export class App implements AppContext {
  readonly deck: Deck;
  readonly renderer: CardRenderer;
  readonly mouse: Point = { x: -1, y: -1 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private scene: Scene;
  private lastTime: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly overlay: HTMLElement,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not supported by this browser");
    this.ctx = ctx;
    this.viewport = new Viewport(canvas);
    this.deck = loadDeck();
    const images = new ImageStore();
    images.load(this.deck.cards);
    this.renderer = new CardRenderer(this.deck.categories, images);
    this.scene = new MenuScene(this);
    this.bindInput();
    requestAnimationFrame(this.frame);
  }

  switchTo(scene: Scene): void {
    this.scene.dispose?.();
    this.scene = scene;
  }

  toCss(rect: Rect): CssBox {
    const bounds = this.canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = this.viewport;
    return {
      left: bounds.left + offsetX + rect.x * scale,
      top: bounds.top + offsetY + rect.y * scale,
      width: rect.w * scale,
      height: rect.h * scale,
      scale,
    };
  }

  private dispatch(event: InputEvent): void {
    if (this.showsRotateHint) return;
    this.scene.handle(event);
  }

  private press(point: Point): void {
    // In portrait the whole screen is the rotate hint; a tap there goes fullscreen + landscape where possible.
    if (this.showsRotateHint) void enterFullscreen();
    else this.dispatch({ kind: "down", point });
  }

  /** Phones held upright: the 16:9 table would be tiny, so ask the player to turn the phone instead. */
  private get showsRotateHint(): boolean {
    return isTouchDevice() && this.canvas.clientHeight > this.canvas.clientWidth;
  }

  private drawRotateHint(time: number): void {
    const { ctx } = this;
    const d = this.viewport.density;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const cx = w / 2;
    const cy = h / 2 - 40;

    // A phone outline turning from portrait to landscape, pausing at both ends.
    const phase = (time / 1000) % 3;
    const t = Math.min(Math.max((phase - 0.6) / 0.9, 0), 1);
    const eased = t < 1 ? 3 * t * t - 2 * t * t * t : 1;
    const angle = (phase < 2.4 ? eased : 1 - Math.min((phase - 2.4) / 0.6, 1)) * (Math.PI / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-angle);
    ctx.beginPath();
    ctx.roundRect(-28, -48, 56, 96, 10);
    ctx.lineWidth = 4;
    ctx.strokeStyle = colors.pyYellow;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 38, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.pyYellow;
    ctx.fill();
    ctx.restore();

    const lines: [string, number, string, boolean][] = [
      ["Turn your phone sideways", 22, colors.pyYellow, true],
      ["PyQuartet is played in landscape.", 15, colors.text, false],
    ];
    if (canFullscreen()) lines.push(["Tap to play in fullscreen", 15, colors.textDim, false]);
    lines.forEach(([text, size, color, bold], i) => {
      drawText(ctx, text, cx, cy + 90 + i * 30, { size, color, bold });
    });
  }

  private resetMouse(): void {
    this.mouse.x = -1;
    this.mouse.y = -1;
  }

  private bindInput(): void {
    const toPoint = (e: PointerEvent): Point => {
      const p = this.viewport.toLogical(e.clientX, e.clientY);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      return p;
    };
    const isTouch = (e: PointerEvent) => e.pointerType === "touch";

    // Mouse/pen: act on press. Touch: act on release, and only for a short single-finger tap, because the same
    // finger may be starting a pan or a pinch zoom (which the browser then takes over with pointercancel).
    const fingers = new Set<number>();
    let tap: { id: number; x: number; y: number; valid: boolean } | null = null;

    this.canvas.addEventListener("pointerdown", (e) => {
      if (!isTouch(e)) {
        if (e.button === 0) this.press(toPoint(e));
        return;
      }
      fingers.add(e.pointerId);
      if (fingers.size === 1) tap = { id: e.pointerId, x: e.clientX, y: e.clientY, valid: true };
      else if (tap) tap.valid = false;
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!isTouch(e)) {
        this.dispatch({ kind: "move", point: toPoint(e) });
        return;
      }
      if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap.valid = false;
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!isTouch(e)) return;
      fingers.delete(e.pointerId);
      if (tap && tap.id === e.pointerId && tap.valid) {
        const point = toPoint(e);
        this.dispatch({ kind: "move", point });
        this.press(point);
        // No hover on touch screens: don't leave buttons or rows looking hovered after the finger is gone.
        this.resetMouse();
      }
      if (fingers.size === 0) tap = null;
    });
    this.canvas.addEventListener("pointercancel", (e) => {
      fingers.delete(e.pointerId);
      tap = null;
    });
    this.canvas.addEventListener("pointerleave", (e) => {
      if (!isTouch(e)) this.resetMouse();
    });
    window.addEventListener("keydown", (e) => {
      if (!HANDLED_KEYS.has(e.key) || e.repeat) return;
      // Typing in a text field (lobby name/code) must not trigger game shortcuts or lose spaces.
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.dispatch({ kind: "key", key: e.key });
    });
  }

  private readonly frame = (time: number): void => {
    // Clamp dt so a background tab or a stalled frame doesn't skip whole animations.
    const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    if (this.viewport.needsResize()) this.viewport.resize();

    this.scene.update(dt);

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const rotateHint = this.showsRotateHint;
    // Inputs would float over the hint and pop up the keyboard; they come back once the phone is turned.
    this.overlay.style.display = rotateHint ? "none" : "";
    if (rotateHint) {
      this.drawRotateHint(time);
    } else {
      this.viewport.apply(ctx);
      this.scene.draw(ctx);
    }
    this.canvas.style.cursor = !rotateHint && this.scene.wantsPointer(this.mouse) ? "pointer" : "default";

    requestAnimationFrame(this.frame);
  };
}
