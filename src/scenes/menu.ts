import { polarityHint } from "../game/model.ts";
import { REPO_URL, openUrl } from "../links.ts";
import { Button } from "../render/button.ts";
import { CardSprite, linkAt } from "../render/cardView.ts";
import { centeredRect, contains, drawArrow, drawText, type Point, type Rect } from "../render/draw.ts";
import { colors } from "../render/theme.ts";
import { GameScene, SHORT_GAME_ROUNDS } from "./game.ts";
import type { AppContext, InputEvent, Scene } from "./scene.ts";

const SHOWCASE_Y = 400;
const SHOWCASE_FLIP_SPEED = 2.5; // turns per second, i.e. one flip takes 0.4 s

interface Showcase {
  sprite: CardSprite;
  restTurn: number;
  /** Hit-test against the resting rect so the bobbing motion can't make the hover flicker. */
  rect: Rect;
}

export class MenuScene implements Scene {
  private time = 0;
  private readonly buttons: Button[];
  private readonly showcase: Showcase[];

  constructor(private readonly app: AppContext) {
    this.buttons = [
      new Button(centeredRect(640, 340, 380, 62), "Play vs Bot", () => this.start(null)),
      new Button(centeredRect(640, 420, 380, 62), `Short game (${SHORT_GAME_ROUNDS} rounds)`, () =>
        this.start(SHORT_GAME_ROUNDS),
      ),
      new Button(centeredRect(1150, 684, 220, 46), "View on GitHub", () => openUrl(REPO_URL), 18),
    ];
    const cards = app.deck.cards;
    const len = cards.length;
    const i1 = Math.floor(Math.random() * len);
    const i2 = (i1 + 1 + Math.floor(Math.random() * (len - 1))) % len;
    // Left card rests face up, right card face down; hovering flips to the other side.
    this.showcase = [
      { sprite: new CardSprite(cards[i1]!, 190, SHOWCASE_Y, { scale: 0.8, turn: 1 }), restTurn: 1 },
      { sprite: new CardSprite(cards[i2]!, 1090, SHOWCASE_Y, { scale: 0.8, turn: 0 }), restTurn: 0 },
    ].map((s) => ({ ...s, rect: s.sprite.rect() }));
  }

  private start(maxRounds: number | null): void {
    this.app.switchTo(new GameScene(this.app, maxRounds));
  }

  private sprites(): CardSprite[] {
    return this.showcase.map((s) => s.sprite);
  }

  handle(event: InputEvent): void {
    if (event.kind === "down") {
      if (this.buttons.some((b) => b.click(event.point))) return;
      const link = linkAt(this.sprites(), event.point);
      if (link) openUrl(link);
    } else if (event.kind === "key" && (event.key === "Enter" || event.key === " ")) {
      this.start(null);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const step = SHOWCASE_FLIP_SPEED * dt;
    this.showcase.forEach(({ sprite, restTurn, rect }, i) => {
      const target = contains(rect, this.app.mouse) ? 1 - restTurn : restTurn;
      sprite.turn = sprite.turn < target ? Math.min(sprite.turn + step, target) : Math.max(sprite.turn - step, target);
      sprite.y = SHOWCASE_Y + Math.sin(this.time * 1.5 + i) * 8;
    });
  }

  wantsPointer(p: Point): boolean {
    return this.buttons.some((b) => b.hovered(p)) || linkAt(this.sprites(), p) !== null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawText(ctx, "PyQuartet", 640, 140, { size: 64, color: colors.pyYellow, bold: true });
    drawText(ctx, "Learn which Python packages power ML-Pipelines", 640, 205, { size: 22 });
    const { cards, categories } = this.app.deck;
    drawText(ctx, `${cards.length} cards  ·  ${categories.length} categories`, 640, 250, {
      size: 18,
      color: colors.textDim,
    });
    for (const button of this.buttons) button.draw(ctx, this.app.mouse);

    const perColumn = 4;
    const columnWidth = 300;
    const columns = Math.max(1, Math.ceil(categories.length / perColumn));
    const x0 = 640 - (columns * columnWidth) / 2;
    categories.forEach((category, i) => {
      const x = x0 + Math.floor(i / perColumn) * columnWidth + 20;
      const y = 575 + (i % perColumn) * 30;
      drawArrow(ctx, category.polarity === "positive", x, y, 5);
      drawText(ctx, `${category.label}: ${polarityHint(category)}`, x + 16, y, {
        size: 17,
        color: colors.textDim,
        align: "left",
      });
    });

    // Cards are the top layer, as in the game.
    for (const { sprite } of this.showcase) sprite.draw(ctx, this.app.renderer);
  }
}
