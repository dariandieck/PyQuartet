import { Bot } from "../game/bot.ts";
import { Game, isTie, type RoundResult } from "../game/engine.ts";
import { formatValue, polarityHint, type Card, type Category } from "../game/model.ts";
import { Button } from "../render/button.ts";
import { openUrl } from "../links.ts";
import { CardSprite, drawPile, linkAt } from "../render/cardView.ts";
import { centeredRect, drawArrow, drawText, fillRoundRect, strokeRoundRect, textWidth, type Point, type Rect } from "../render/draw.ts";
import { colors, SCREEN_H, SCREEN_W } from "../render/theme.ts";
import { Animator, easeOut, Sequencer } from "../render/tween.ts";
import { MenuScene } from "./menu.ts";
import type { AppContext, InputEvent, Scene } from "./scene.ts";

export const SHORT_GAME_ROUNDS = 10;
const REVEAL_PAUSE = 0.35; // cards rest face down on the table before the flip

const HUMAN = 0;
const BOT = 1;
type Seat = typeof HUMAN | typeof BOT;

const PILE_SCALE = 0.5;
const PILE_POS: Record<Seat, Point> = { [HUMAN]: { x: 120, y: 545 }, [BOT]: { x: 120, y: 175 } };
const POT_POS: Point = { x: 1160, y: 345 };
const HAND_POS: Record<Seat, Point> = { [HUMAN]: { x: 640, y: 555 }, [BOT]: { x: 640, y: 120 } };
const HAND_SCALE: Record<Seat, number> = { [HUMAN]: 1, [BOT]: 0.6 };
const TABLE_POS: Record<Seat, Point> = { [HUMAN]: { x: 520, y: 330 }, [BOT]: { x: 760, y: 330 } };
const TABLE_SCALE = 0.9;
const TABLE_AREA: Rect = centeredRect(640, 330, 580, 330);

type Phase = "anim" | "choose" | "confirm" | "result" | "over";

const nameOf = (id: number) => (id === HUMAN ? "You" : "Bot");

export class GameScene implements Scene {
  private readonly game: Game;
  private readonly bot: Bot;
  private readonly animator = new Animator();
  private readonly seq = new Sequencer(this.animator);

  // Displayed counts lag behind the engine while cards are in flight.
  private pileCounts: number[];
  private potCount: number;
  private sprites: CardSprite[] = [];
  private hand = new Map<number, CardSprite>();
  private table = new Map<number, CardSprite>();

  private phase: Phase = "anim";
  private selected: string | null = null;
  private result: RoundResult | null = null;
  private message = "";
  private detail = "";
  /** While set, the center text shows only "<label>!" plus arrow instead of message/detail. */
  private callout: Category | null = null;

  private readonly callButton: Button;
  private readonly continueButton: Button;
  private readonly againButton: Button;
  private readonly menuButton: Button;
  private readonly buttons: Button[];

  constructor(
    private readonly app: AppContext,
    private readonly maxRounds: number | null = null,
  ) {
    const { cards, categories } = app.deck;
    this.game = new Game([{ name: "You" }, { name: "Bot", isBot: true }], cards, categories, { maxRounds });
    this.bot = new Bot(cards, categories);
    this.pileCounts = this.game.players.map((p) => p.stack.length);
    this.potCount = this.game.pot.length;

    this.callButton = new Button(centeredRect(910, 600, 170, 58), "Call!", () => this.callPressed(), 24);
    this.continueButton = new Button(centeredRect(640, 620, 220, 56), "Continue", () => this.continueRound());
    this.againButton = new Button(centeredRect(540, 470, 200, 58), "Play again", () => this.playAgain());
    this.menuButton = new Button(centeredRect(760, 470, 200, 58), "Menu", () => this.toMenu());
    this.buttons = [this.callButton, this.continueButton, this.againButton, this.menuButton];
    this.buttons.forEach((b) => (b.visible = false));

    this.message = this.game.callerId === HUMAN ? "You start." : "Bot starts.";
    this.seq.wait(1.0);
    if (this.potCount > 0) this.seq.then(() => this.announceLeftovers()).wait(1.4);
    this.seq.then(() => this.startRound());
  }

  // ---- flow --------------------------------------------------------------------------------

  private announceLeftovers(): void {
    this.message = `${this.potCount} leftover card(s) go to the pot.`;
    this.detail = "They are won together with the first round.";
  }

  private startRound(): void {
    this.result = null;
    this.selected = null;
    this.callout = null;
    if (this.game.isTiePending) {
      this.message = "Tie! Draw your next card.";
    } else {
      const limit = this.maxRounds ? ` of ${this.maxRounds}` : "";
      this.message = `Round ${this.game.roundNumber + 1}${limit}`;
    }
    this.detail = "";
    this.game.participants.forEach((playerId, i) => this.drawCard(playerId as Seat, i * 0.15));
    this.seq.then(() => this.afterDraw());
  }

  private drawCard(seat: Seat, delay: number): void {
    const card = this.game.topCard(seat)!;
    this.pileCounts[seat]! -= 1;
    const sprite = new CardSprite(card, PILE_POS[seat].x, PILE_POS[seat].y, { scale: PILE_SCALE, turn: 0, z: 10 });
    this.sprites.push(sprite);
    this.hand.set(seat, sprite);
    const to = HAND_POS[seat];
    this.animator.tween(
      sprite,
      0.55,
      { x: to.x, y: to.y, scale: HAND_SCALE[seat], turn: seat === HUMAN ? 1 : 0 },
      { delay, ease: easeOut },
    );
  }

  private afterDraw(): void {
    if (this.game.callerId === HUMAN) {
      this.phase = "choose";
      this.message = "Your call!";
      this.detail = "Pick a value on your card.";
      this.callButton.visible = true;
      this.callButton.enabled = false;
    } else {
      this.message = "Bot is thinking...";
      this.detail = "";
      this.seq.wait(1.0).then(() => this.botCall());
    }
  }

  private botCall(): void {
    this.announce(this.bot.chooseCategory(this.hand.get(BOT)!.card));
    // The bot's choice is only played once the human confirms it with Call.
    this.phase = "confirm";
    this.callButton.visible = true;
    this.callButton.enabled = true;
  }

  private select(label: string): void {
    this.selected = label;
    this.announce(this.game.category(label));
    this.callButton.enabled = true;
  }

  private callPressed(): void {
    let category: Category;
    if (this.phase === "choose" && this.selected !== null) {
      this.hand.get(HUMAN)!.hover = null;
      category = this.game.category(this.selected);
    } else if (this.phase === "confirm" && this.callout !== null) {
      category = this.callout;
    } else {
      return;
    }
    this.phase = "anim";
    this.callButton.visible = false;
    this.seq.wait(0.6).then(() => this.play(category));
  }

  private announce(category: Category): void {
    for (const sprite of this.hand.values()) sprite.highlight = category.label;
    this.callout = category;
  }

  private play(category: Category): void {
    this.result = this.game.playRound(category.label);
    for (const [seat, sprite] of this.hand) {
      sprite.z = 20;
      const to = TABLE_POS[seat as Seat];
      this.animator.tween(sprite, 0.55, { x: to.x, y: to.y, scale: TABLE_SCALE });
    }
    [this.table, this.hand] = [this.hand, new Map()];
    this.seq.wait(REVEAL_PAUSE).then(() => this.reveal());
  }

  private reveal(): void {
    for (const sprite of this.table.values()) {
      if (!sprite.faceUp) this.animator.tween(sprite, 0.45, { turn: 1 });
    }
    this.seq.wait(0.2).then(() => this.showResult());
  }

  private showResult(): void {
    const result = this.result!;
    const tie = isTie(result);
    this.callout = null;
    for (const play of result.plays) {
      const sprite = this.table.get(play.playerId)!;
      if (result.bestIds.includes(play.playerId)) {
        sprite.outcome = tie ? "tie" : "win";
        if (!tie) {
          this.animator.tween(sprite, 0.15, { scale: TABLE_SCALE * 1.08 });
          this.animator.tween(sprite, 0.2, { scale: TABLE_SCALE }, { delay: 0.15 });
        }
      } else {
        sprite.outcome = "lose";
      }
    }

    const values = result.plays.map((p) => `${nameOf(p.playerId)} ${formatValue(p.value)}`).join("  vs  ");
    if (result.redistributed) {
      this.message = "Tie, and nobody has cards left!";
      this.detail = "The pot is shared back between the tied players.";
    } else if (result.winnerId === null) {
      this.message = "Tie! All cards go to the pot.";
      this.detail = `${values}. The same caller picks again for the tie.`;
    } else {
      const winner = result.winnerId === HUMAN ? "You win" : "Bot wins";
      this.message = tie ? `Tie, but only one player has cards left: ${winner} the pot.` : `${winner} the round!`;
      this.detail = `${result.category.label}: ${values}  (${polarityHint(result.category)})`;
    }
    this.phase = "result";
    this.continueButton.visible = true;
  }

  private continueRound(): void {
    if (this.phase !== "result") return;
    this.phase = "anim";
    this.continueButton.visible = false;
    this.collect();
  }

  private collect(): void {
    const result = this.result!;
    const flying = [...this.table.values()];
    this.table = new Map();
    const anyCard: Card = result.plays[0]!.card; // pot cards fly face down, so any card works

    if (result.winnerId !== null || result.redistributed) {
      for (let i = 0; i < this.potCount; i++) {
        const sprite = new CardSprite(anyCard, POT_POS.x, POT_POS.y, { scale: PILE_SCALE });
        this.sprites.push(sprite);
        flying.push(sprite);
      }
      this.potCount = 0;
      const receivers = result.winnerId !== null ? [result.winnerId] : result.bestIds;
      flying.forEach((sprite, i) => this.fly(sprite, receivers[i % receivers.length]!, i * 0.09));
    } else {
      flying.forEach((sprite, i) => this.fly(sprite, null, i * 0.12));
    }
    this.seq.then(() => this.afterCollect());
  }

  /** Sends a card face down to a player's stack, or to the pot when playerId is null. */
  private fly(sprite: CardSprite, playerId: number | null, delay: number): void {
    sprite.z = 30;
    const to = playerId === null ? POT_POS : PILE_POS[playerId as Seat];
    const land = () => {
      this.sprites = this.sprites.filter((s) => s !== sprite);
      if (playerId === null) this.potCount += 1;
      else this.pileCounts[playerId]! += 1;
    };
    this.animator.tween(sprite, 0.6, { x: to.x, y: to.y, scale: PILE_SCALE, turn: 0 }, { delay, onDone: land });
  }

  private afterCollect(): void {
    this.pileCounts = this.game.players.map((p) => p.stack.length);
    this.potCount = this.game.pot.length;
    if (this.game.isOver) this.gameOver();
    else this.startRound();
  }

  private gameOver(): void {
    this.phase = "over";
    const winners = this.game.winners();
    const counts = this.game.players.map((p) => p.stack.length);
    if (winners.length > 1) this.message = "Draw!";
    else this.message = winners[0] === HUMAN ? "You win the game!" : "The bot wins the game!";
    this.detail = `Final cards:  You ${counts[HUMAN]}  -  Bot ${counts[BOT]}`;
    this.againButton.visible = true;
    this.menuButton.visible = true;
  }

  private playAgain(): void {
    this.app.switchTo(new GameScene(this.app, this.maxRounds));
  }

  private toMenu(): void {
    this.app.switchTo(new MenuScene(this.app));
  }

  // ---- input -------------------------------------------------------------------------------

  handle(event: InputEvent): void {
    if (event.kind === "down" && this.buttons.some((b) => b.click(event.point))) return;
    if (event.kind === "down") {
      const link = this.linkAt(event.point);
      if (link) {
        openUrl(link);
        return;
      }
    }
    if (event.kind === "key" && event.key === "Escape") {
      this.toMenu();
      return;
    }
    const confirmKey = event.kind === "key" && (event.key === "Enter" || event.key === " ");
    switch (this.phase) {
      case "choose":
        this.handleChoose(event);
        break;
      case "confirm":
        if (confirmKey) this.callPressed();
        break;
      case "result":
        if (confirmKey) this.continueRound();
        break;
      case "over":
        if (confirmKey) this.playAgain();
        break;
      case "anim":
        break;
    }
  }

  private handleChoose(event: InputEvent): void {
    const sprite = this.hand.get(HUMAN)!;
    if (event.kind === "move") {
      sprite.hover = sprite.categoryAt(event.point, this.app.renderer)?.label ?? null;
    } else if (event.kind === "down") {
      const category = sprite.categoryAt(event.point, this.app.renderer);
      if (category) this.select(category.label);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const labels = this.game.categories.map((c) => c.label);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const index = this.selected ? labels.indexOf(this.selected) + step : step > 0 ? 0 : -1;
      this.select(labels[(index + labels.length) % labels.length]!);
    } else if (event.key === "Enter" || event.key === " ") {
      this.callPressed();
    }
  }

  /** Logo links are disabled under the game-over overlay. */
  private linkAt(p: Point): string | null {
    return this.phase === "over" ? null : linkAt(this.sprites, p);
  }

  wantsPointer(p: Point): boolean {
    if (this.buttons.some((b) => b.hovered(p)) || this.linkAt(p) !== null) return true;
    return this.phase === "choose" && this.hand.get(HUMAN)?.categoryAt(p, this.app.renderer) != null;
  }

  // ---- frame -------------------------------------------------------------------------------

  update(dt: number): void {
    this.seq.update(dt);
    this.animator.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const renderer = this.app.renderer;
    fillRoundRect(ctx, TABLE_AREA, 24, colors.bgAccent);

    drawPile(ctx, renderer, PILE_POS[BOT].x, PILE_POS[BOT].y, this.pileCounts[BOT]!, PILE_SCALE, `Bot: ${this.pileCounts[BOT]}`);
    drawPile(ctx, renderer, PILE_POS[HUMAN].x, PILE_POS[HUMAN].y, this.pileCounts[HUMAN]!, PILE_SCALE, `You: ${this.pileCounts[HUMAN]}`);
    drawPile(ctx, renderer, POT_POS.x, POT_POS.y, this.potCount, PILE_SCALE, `Pot: ${this.potCount}`);

    const roundText = `Round ${this.game.roundNumber}` + (this.maxRounds ? ` / ${this.maxRounds}` : "");
    drawText(ctx, roundText, 1260, 26, { size: 20, color: colors.textDim, align: "right" });
    this.drawLegend(ctx);

    if (this.phase !== "over") {
      const y = this.table.size > 0 ? TABLE_AREA.y + TABLE_AREA.h + 35 : TABLE_AREA.y + TABLE_AREA.h / 2 - 20;
      if (this.callout) {
        this.drawCallout(ctx, this.callout, y);
      } else {
        drawText(ctx, this.message, 640, y, { size: 28, color: colors.pyYellow, bold: true });
        if (this.detail) drawText(ctx, this.detail, 640, y + 34, { size: 18 });
      }
    }
    this.callButton.draw(ctx, this.app.mouse);
    this.continueButton.draw(ctx, this.app.mouse);

    // Cards are the top layer: text and in-game buttons must never cover them; only the game-over overlay does.
    for (const sprite of [...this.sprites].sort((a, b) => a.z - b.z)) sprite.draw(ctx, renderer);

    if (this.phase === "over") {
      this.drawGameOver(ctx);
      this.againButton.draw(ctx, this.app.mouse);
      this.menuButton.draw(ctx, this.app.mouse);
    }
  }

  private drawCallout(ctx: CanvasRenderingContext2D, category: Category, y: number): void {
    const text = `${category.label}!`;
    const size = 34;
    const arrowSize = 10;
    const gap = 14;
    const total = 2 * arrowSize + gap + textWidth(ctx, text, size, true);
    const left = 640 - total / 2;
    drawArrow(ctx, category.polarity === "positive", left + arrowSize, y, arrowSize);
    drawText(ctx, text, left + 2 * arrowSize + gap, y + 1, { size, color: colors.pyYellow, bold: true, align: "left" });
  }

  private drawLegend(ctx: CanvasRenderingContext2D): void {
    const y = 702;
    drawArrow(ctx, true, 1000, y, 5);
    drawText(ctx, "higher wins", 1012, y, { size: 15, color: colors.textDim, align: "left" });
    drawArrow(ctx, false, 1140, y, 5);
    drawText(ctx, "lower wins", 1152, y, { size: 15, color: colors.textDim, align: "left" });
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    // Oversized so the dimming also covers the letterbox bars around the 16:9 scene.
    ctx.fillStyle = "rgba(0, 0, 0, 0.63)";
    ctx.fillRect(-SCREEN_W, -SCREEN_H, SCREEN_W * 3, SCREEN_H * 3);
    const panel = centeredRect(640, 380, 560, 280);
    fillRoundRect(ctx, panel, 20, colors.bgAccent);
    strokeRoundRect(ctx, panel, 20, colors.pyYellow, 3);
    drawText(ctx, this.message, 640, 320, { size: 39, color: colors.pyYellow, bold: true });
    drawText(ctx, this.detail, 640, 380, { size: 21 });
  }
}
