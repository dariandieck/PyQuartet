import { loadDeck, type Deck } from "./game/deck.ts";
import { CardRenderer } from "./render/cardView.ts";
import type { Point } from "./render/draw.ts";
import { ImageStore } from "./render/images.ts";
import { colors } from "./render/theme.ts";
import { Viewport } from "./render/viewport.ts";
import { MenuScene } from "./scenes/menu.ts";
import type { AppContext, InputEvent, Scene } from "./scenes/scene.ts";

const HANDLED_KEYS = new Set(["Enter", " ", "Escape", "ArrowUp", "ArrowDown"]);

export class App implements AppContext {
  readonly deck: Deck;
  readonly renderer: CardRenderer;
  readonly mouse: Point = { x: -1, y: -1 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private scene: Scene;
  private lastTime: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
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
    this.scene = scene;
  }

  private dispatch(event: InputEvent): void {
    this.scene.handle(event);
  }

  private bindInput(): void {
    const toPoint = (e: PointerEvent): Point => {
      const p = this.viewport.toLogical(e.clientX, e.clientY);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      return p;
    };
    this.canvas.addEventListener("pointermove", (e) => this.dispatch({ kind: "move", point: toPoint(e) }));
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.dispatch({ kind: "down", point: toPoint(e) });
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.mouse.x = -1;
      this.mouse.y = -1;
    });
    window.addEventListener("keydown", (e) => {
      if (!HANDLED_KEYS.has(e.key) || e.repeat) return;
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
    this.viewport.apply(ctx);
    this.scene.draw(ctx);
    this.canvas.style.cursor = this.scene.wantsPointer(this.mouse) ? "pointer" : "default";

    requestAnimationFrame(this.frame);
  };
}
