import { formatStat, polarityHint, type Card, type Category } from "../game/model.ts";
import { openUrl } from "../links.ts";
import type { GameEvent, PublicState, ResultInfo, SeatInfo } from "../net/protocol.ts";
import { Button } from "../render/button.ts";
import { CardSprite, drawPile, linkAt } from "../render/cardView.ts";
import {
  centeredRect,
  contains,
  drawArrow,
  drawText,
  fillRoundRect,
  fitFontSize,
  strokeRoundRect,
  textWidth,
  type Point,
} from "../render/draw.ts";
import { colors, SCREEN_H, SCREEN_W } from "../render/theme.ts";
import { Animator, easeOut, Sequencer } from "../render/tween.ts";
import type { Session } from "../session/session.ts";
import { computeLayout, type TableLayout } from "./layout.ts";
import { isTouchDevice } from "../platform.ts";
import { MenuScene } from "./menu.ts";
import type { AppContext, InputEvent, Scene } from "./scene.ts";

const REVEAL_PAUSE = 0.35; // cards rest face down on the table before the flip
const MIN_BOT_THINKING = 0.8; // seconds "X is thinking..." stays visible, however early the bot's call arrives
const TOAST_SECONDS = 4;
/** Card zoom on touch screens: the card fills the screen height, so stats are readable and tappable on phones. */
const INSPECT_SCALE = 2.1;
const FLIP_SECONDS = 0.45;

type Phase = "wait" | "choose" | "confirm" | "result" | "over";

export interface GameSceneOptions {
  /** Local games only: creates (and starts) a fresh session for "Play again". */
  playAgain?: () => Session;
}

/**
 * Plays back a session's events as animations. Events are queued on the sequencer, so each one starts only
 * after the previous animations have finished, no matter how fast the host sends them.
 */
export class GameScene implements Scene {
  private readonly animator = new Animator();
  private readonly seq = new Sequencer(this.animator);

  private started = false;
  private seats: SeatInfo[] = [];
  private youId = 0;
  private maxRounds: number | null = null;
  private layout: TableLayout = computeLayout([0, 1], 0);

  // Displayed state; lags behind the host while cards are in flight and is resynced from PublicState.
  private counts: number[] = [];
  private potCount = 0;
  private roundNumber = 0;
  private left = new Set<number>();
  private callerId = -1;

  private sprites: CardSprite[] = [];
  private hand = new Map<number, CardSprite>();
  private table = new Map<number, CardSprite>();

  private phase: Phase = "wait";
  private selected: string | null = null;
  /** While set, the center text shows only "<label>!" plus arrow instead of message/detail. */
  private callout: Category | null = null;
  private result: ResultInfo | null = null;
  /** Players who still have to click Call after the current call. */
  private waitingFor: number[] = [];
  private message = "Starting...";
  private detail = "";
  /** Small status line for online games, e.g. who we are waiting for. */
  private hint = "";
  private toast = "";
  private toastTime = 0;
  private overTitle = "";
  private overDetail = "";
  private readonly touch = isTouchDevice();
  /** Card shown enlarged (touch screens only); taps go to it until it is closed. */
  private inspected: CardSprite | null = null;

  private readonly callButton: Button;
  private readonly continueButton: Button;
  private readonly againButton: Button;
  private readonly menuButton: Button;
  private readonly leaveButton: Button;
  /** Category picker for a caller who has no card in play (possible in ties with 3+ players). */
  private readonly pickerButtons: Button[];
  private readonly buttons: Button[];

  constructor(
    private readonly app: AppContext,
    private readonly session: Session,
    private readonly options: GameSceneOptions = {},
  ) {
    this.callButton = new Button(centeredRect(910, 600, 170, 58), "Call!", () => this.callPressed(), 24);
    // Below the result's hint line (center text ends around y 600).
    this.continueButton = new Button(centeredRect(640, 645, 220, 56), "Continue", () => this.continuePressed());
    this.againButton = new Button(centeredRect(540, 470, 200, 58), "Play again", () => this.playAgain());
    this.menuButton = new Button(centeredRect(760, 470, 200, 58), "Menu", () => this.toMenu());
    this.leaveButton = new Button(centeredRect(70, 26, 110, 36), "Leave", () => this.toMenu(), 16);
    this.pickerButtons = app.deck.categories.map(
      (c) => new Button(centeredRect(640, 0, 320, 44), c.label, () => this.select(c.label), 18),
    );
    this.buttons = [this.callButton, this.continueButton, this.againButton, this.menuButton, this.leaveButton, ...this.pickerButtons];
    this.buttons.forEach((b) => (b.visible = false));
    this.leaveButton.visible = session.isOnline;

    session.listen((event) => this.seq.then(() => this.apply(event)));
  }

  // ---- event playback ----------------------------------------------------------------------

  private apply(event: GameEvent): void {
    switch (event.kind) {
      case "start":
        return this.onStart(event);
      case "roundStart":
        return this.onRoundStart(event);
      case "called":
        return this.onCalled(event);
      case "reveal":
        return this.onReveal(event);
      case "collect":
        return this.onCollect(event);
      case "playerLeft":
        return this.onPlayerLeft(event);
      case "gameOver":
        return this.onGameOver(event);
      case "confirmed":
        return this.onConfirmed(event);
      case "hostLeft":
        return this.onHostLeft();
    }
  }

  private onStart(event: Extract<GameEvent, { kind: "start" }>): void {
    this.started = true;
    this.seats = event.seats;
    this.youId = event.youId;
    this.maxRounds = event.maxRounds;
    this.layout = computeLayout(event.seats.map((s) => s.id), event.youId);
    this.applyState(event.state);
    this.callerId = event.callerId;
    this.message = `${this.name(event.callerId)} ${this.verb(event.callerId, "start", "starts")}.`;
    this.seq.wait(1.0);
    if (this.potCount > 0) {
      this.seq
        .then(() => {
          this.message = `${this.potCount} leftover card(s) go to the pot.`;
          this.detail = "They are won together with the first round.";
        })
        .wait(1.4);
    }
  }

  private onRoundStart(event: Extract<GameEvent, { kind: "roundStart" }>): void {
    this.applyState(event.state);
    this.inspected = null;
    this.result = null;
    this.selected = null;
    this.callout = null;
    this.hint = "";
    this.callerId = event.callerId;
    if (event.tie) {
      this.message = "Tie! Draw your next card.";
    } else {
      const next = this.roundNumber + 1;
      const limit = this.maxRounds ? ` of ${this.maxRounds}${next === this.maxRounds ? " (last round)" : ""}` : "";
      this.message = `Round ${next}${limit}`;
    }
    this.detail = "";
    const ownCard = event.card ? this.cardByLibrary(event.card) : null;
    // Opponents' cards are face down until the reveal, so any card object works as a stand-in.
    const hidden = this.app.deck.cards[0]!;
    event.participants.forEach((id, i) => {
      const isYou = id === this.youId && ownCard !== null;
      this.drawCard(id, isYou ? ownCard : hidden, isYou, i * 0.15);
    });
    this.seq.then(() => this.afterDraw());
  }

  private drawCard(playerId: number, card: Card, faceUp: boolean, delay: number): void {
    const seat = this.layout.seats.get(playerId);
    if (!seat) return;
    this.counts[playerId] = Math.max(0, (this.counts[playerId] ?? 1) - 1);
    const sprite = new CardSprite(card, seat.pile.x, seat.pile.y, { scale: seat.pileScale, turn: 0, z: 10 });
    this.sprites.push(sprite);
    this.hand.set(playerId, sprite);
    this.animator.tween(
      sprite,
      0.55,
      { x: seat.hand.x, y: seat.hand.y, scale: seat.handScale, turn: faceUp ? 1 : 0 },
      { delay, ease: easeOut },
    );
  }

  private afterDraw(): void {
    if (this.callerId === this.youId) {
      this.phase = "choose";
      this.message = "Your call!";
      const own = this.hand.get(this.youId);
      const hasCard = own !== undefined;
      if (!hasCard) this.detail = "You don't play in this tie, but you pick the value.";
      else this.detail = this.touch ? "Tap your card to pick a value." : "Pick a value on your card, or click the card to flip it.";
      // On phones the card is too small to read and tap, so it opens enlarged right away.
      if (own && this.touch) this.inspected = own;
      this.layoutPicker(!hasCard);
      this.callButton.visible = true;
      this.callButton.enabled = false;
    } else {
      this.phase = "wait";
      const caller = this.name(this.callerId);
      if (this.seats[this.callerId]?.isBot) {
        this.message = `${caller} is thinking...`;
        this.seq.wait(MIN_BOT_THINKING);
      } else {
        this.message = `Waiting for ${caller} to call...`;
      }
      const verb = this.touch ? "tap" : "click";
      this.detail = this.hand.has(this.youId) ? `Meanwhile, ${verb} your card to read about it.` : "";
    }
  }

  private onCalled(event: Extract<GameEvent, { kind: "called" }>): void {
    this.announce(this.category(event.label));
    this.layoutPicker(false);
    this.waitingFor = event.waitingFor;
    if (event.waitingFor.includes(this.youId)) {
      // Someone else called: you click Call too, as if reading the value off your own card.
      this.phase = "confirm";
      this.callButton.visible = true;
      this.callButton.enabled = true;
      this.hint = "";
    } else {
      this.phase = "wait";
      this.callButton.visible = false;
      this.hint = this.waitingHint();
      if (event.waitingFor.length === 0) this.seq.wait(0.6);
    }
  }

  private onConfirmed(event: Extract<GameEvent, { kind: "confirmed" }>): void {
    this.waitingFor = event.waitingFor;
    if (this.phase !== "confirm") this.hint = this.waitingHint();
  }

  /** "Waiting for Anna and Bot 2 to call..." while other players still have to click Call. */
  private waitingHint(): string {
    const others = this.waitingFor.filter((id) => id !== this.youId).map((id) => this.name(id));
    if (others.length === 0) return "";
    const names = others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
    return `Waiting for ${names} to call...`;
  }

  private onReveal(event: Extract<GameEvent, { kind: "reveal" }>): void {
    this.inspected = null; // let everyone watch the cards go to the table
    this.phase = "wait";
    this.hint = "";
    this.callButton.visible = false;
    this.result = event.result;
    const table = new Map<number, CardSprite>();
    for (const play of event.result.plays) {
      const seat = this.layout.seats.get(play.playerId);
      if (!seat) continue;
      let sprite = this.hand.get(play.playerId);
      if (!sprite) {
        sprite = new CardSprite(this.app.deck.cards[0]!, seat.pile.x, seat.pile.y, { scale: seat.pileScale });
        this.sprites.push(sprite);
      }
      sprite.card = this.cardByLibrary(play.library) ?? sprite.card;
      sprite.highlight = event.result.label;
      sprite.hover = null;
      sprite.z = 20;
      // A card still showing its info side turns back to the values on the way to the table.
      const turn = sprite.side === "info" ? { turn: 1 } : {};
      this.animator.tween(sprite, 0.55, { x: seat.table.x, y: seat.table.y, scale: this.layout.tableScale, ...turn });
      table.set(play.playerId, sprite);
    }
    this.table = table;
    this.hand = new Map();
    this.seq.wait(REVEAL_PAUSE).then(() => {
      for (const sprite of this.table.values()) {
        if (!sprite.faceUp) this.animator.tween(sprite, 0.45, { turn: 1 });
      }
      this.seq.wait(0.2).then(() => this.showResult());
    });
  }

  private showResult(): void {
    const result = this.result!;
    const tie = result.bestIds.length > 1;
    const category = this.category(result.label);
    this.callout = null;
    for (const play of result.plays) {
      const sprite = this.table.get(play.playerId);
      if (!sprite) continue;
      if (result.bestIds.includes(play.playerId)) {
        sprite.outcome = tie ? "tie" : "win";
        if (!tie) {
          const scale = this.layout.tableScale;
          this.animator.tween(sprite, 0.15, { scale: scale * 1.08 });
          this.animator.tween(sprite, 0.2, { scale }, { delay: 0.15 });
        }
      } else {
        sprite.outcome = "lose";
      }
    }

    // Compact values can look equal ("50.6k" vs "50.6k") although one is higher; then spell them out.
    const compact = result.plays.map((p) => formatStat(category, p.value));
    const exact = new Set(compact).size < new Set(result.plays.map((p) => p.value)).size;
    const values = result.plays
      .map((p, i) => `${this.name(p.playerId)} ${exact ? formatStat(category, p.value, true) : compact[i]}`)
      .join("  vs  ");
    if (result.redistributed) {
      this.message = "Tie, and nobody has cards left!";
      this.detail = "The pot is shared back between the tied players.";
    } else if (result.winnerId === null) {
      this.message = "Tie! All cards go to the pot.";
      this.detail = `${values}. The same caller picks again for the tie.`;
    } else {
      const winner = `${this.name(result.winnerId)} ${this.verb(result.winnerId, "win", "wins")}`;
      this.message = tie ? `Tie, but only one player has cards left: ${winner} the pot.` : `${winner} the round!`;
      this.detail = `${category.label}: ${values}  (${polarityHint(category)})`;
    }
    const touchHint = this.touch ? "Tap a card to see it larger." : "Click a card to read about it.";
    if (this.session.isHost) {
      this.phase = "result";
      this.continueButton.visible = true;
      this.hint = touchHint;
    } else {
      this.hint = ["Waiting for the host to continue...", touchHint].filter(Boolean).join("  ");
    }
  }

  private onCollect(event: Extract<GameEvent, { kind: "collect" }>): void {
    this.inspected = null;
    this.phase = "wait";
    this.hint = "";
    this.continueButton.visible = false;
    const result = this.result;
    const flying = [...this.table.values()];
    this.table = new Map();
    if (result) {
      const present = (id: number | null) => (id !== null && !this.left.has(id) ? id : null);
      if (result.winnerId !== null || result.redistributed) {
        flying.push(...this.spawnFrom(this.layout.pot, this.layout.potScale, this.potCount));
        this.potCount = 0;
        const receivers = result.winnerId !== null ? [present(result.winnerId)] : result.bestIds.map(present);
        flying.forEach((sprite, i) => this.fly(sprite, receivers[i % receivers.length] ?? null, i * 0.09));
      } else {
        flying.forEach((sprite, i) => this.fly(sprite, null, i * 0.12));
      }
    }
    this.seq.then(() => {
      this.applyState(event.state);
      const out = (result?.eliminatedIds ?? []).filter((id) => !this.left.has(id));
      if (out.length === 0) return;
      if (out.includes(this.youId)) {
        this.message = "You are out!";
        this.detail = "You can keep watching the game.";
      } else {
        this.message = `${out.map((id) => this.name(id)).join(" and ")} ${out.length > 1 ? "are" : "is"} out!`;
        this.detail = "";
      }
      this.seq.wait(1.4);
    });
  }

  private onPlayerLeft(event: Extract<GameEvent, { kind: "playerLeft" }>): void {
    const id = event.playerId;
    this.left.add(id);
    this.showToast(`${this.name(id)} left the game, their cards go to the pot.`);
    const seat = this.layout.seats.get(id);
    const own = this.hand.get(id);
    if (own) {
      this.hand.delete(id);
      this.fly(own, null, 0);
    }
    if (seat) {
      const leaving = this.spawnFrom(seat.pile, seat.pileScale, Math.min(this.counts[id] ?? 0, 4));
      this.counts[id] = 0;
      leaving.forEach((sprite, i) => this.fly(sprite, null, 0.05 + i * 0.08));
    }
    if (event.restart) {
      // Nothing was played yet: everyone puts their drawn card back and the round is drawn again.
      for (const [playerId, sprite] of this.hand) this.fly(sprite, playerId, 0.1);
      this.hand = new Map();
      this.inspected = null;
      this.callout = null;
      this.selected = null;
      this.phase = "wait";
      this.callButton.visible = false;
      this.layoutPicker(false);
    }
    this.seq.then(() => this.applyState(event.state));
  }

  private onGameOver(event: Extract<GameEvent, { kind: "gameOver" }>): void {
    this.applyState(event.state);
    const winners = event.winners;
    if (winners.length > 1) this.overTitle = "Draw!";
    else if (winners[0] === this.youId) this.overTitle = "You win the game!";
    else this.overTitle = `${this.name(winners[0]!)} wins the game!`;
    // In the rounds mode the game may also end early, when one player has won every card.
    const prefix = this.maxRounds && this.roundNumber >= this.maxRounds ? `After ${this.maxRounds} rounds` : "Final cards";
    this.overDetail = `${prefix}:  ${this.seats.map((s) => `${this.name(s.id)} ${this.counts[s.id] ?? 0}`).join("  -  ")}`;
    this.showGameOver();
  }

  private onHostLeft(): void {
    if (this.phase === "over") return;
    this.overTitle = "The host left the game.";
    this.overDetail = "The room is closed.";
    this.showGameOver();
  }

  private showGameOver(): void {
    this.phase = "over";
    this.callout = null;
    this.inspected = null;
    for (const b of this.buttons) b.visible = false;
    if (this.options.playAgain) {
      this.againButton.visible = true;
      this.menuButton.rect = centeredRect(760, 470, 200, 58);
    } else {
      this.menuButton.rect = centeredRect(640, 470, 200, 58);
    }
    this.menuButton.visible = true;
  }

  // ---- animation helpers -------------------------------------------------------------------

  /** Face-down stand-in cards starting on a pile (their identity doesn't matter, they are never shown). */
  private spawnFrom(at: Point, scale: number, count: number): CardSprite[] {
    const card = this.app.deck.cards[0]!;
    return Array.from({ length: count }, () => {
      const sprite = new CardSprite(card, at.x, at.y, { scale });
      this.sprites.push(sprite);
      return sprite;
    });
  }

  /** Sends a card face down to a player's stack, or to the pot when playerId is null. */
  private fly(sprite: CardSprite, playerId: number | null, delay: number): void {
    const seat = playerId === null ? undefined : this.layout.seats.get(playerId);
    const to = seat ? seat.pile : this.layout.pot;
    const scale = seat ? seat.pileScale : this.layout.potScale;
    sprite.z = 30;
    const land = () => {
      this.sprites = this.sprites.filter((s) => s !== sprite);
      if (seat && playerId !== null) this.counts[playerId] = (this.counts[playerId] ?? 0) + 1;
      else this.potCount += 1;
    };
    this.animator.tween(sprite, 0.6, { x: to.x, y: to.y, scale, turn: 0 }, { delay, onDone: land });
  }

  private applyState(state: PublicState): void {
    this.counts = [...state.counts];
    this.potCount = state.potCount;
    this.left = new Set(state.left);
    this.roundNumber = state.roundNumber;
  }

  // ---- player intents ----------------------------------------------------------------------

  private select(label: string): void {
    if (this.phase !== "choose") return;
    this.selected = label;
    this.announce(this.category(label));
    this.callButton.enabled = true;
  }

  private announce(category: Category): void {
    for (const sprite of this.hand.values()) sprite.highlight = category.label;
    this.callout = category;
  }

  private callPressed(): void {
    if (this.phase === "choose" && this.selected !== null) {
      const label = this.selected;
      const own = this.hand.get(this.youId);
      if (own) {
        own.hover = null;
        if (own.turn > 1) this.animator.tween(own, FLIP_SECONDS, { turn: 1 });
      }
      this.phase = "wait";
      this.callButton.visible = false;
      this.layoutPicker(false);
      this.session.call(label);
    } else if (this.phase === "confirm") {
      this.phase = "wait";
      this.callButton.visible = false;
      this.waitingFor = this.waitingFor.filter((id) => id !== this.youId);
      this.hint = this.waitingHint();
      this.seq.wait(0.6).then(() => this.session.confirmCall());
    }
  }

  private continuePressed(): void {
    if (this.phase !== "result") return;
    this.phase = "wait";
    this.continueButton.visible = false;
    this.session.continueRound();
  }

  private playAgain(): void {
    const factory = this.options.playAgain;
    if (!factory) return;
    this.session.leave();
    this.app.switchTo(new GameScene(this.app, factory(), this.options));
  }

  private toMenu(): void {
    this.session.leave();
    this.app.switchTo(new MenuScene(this.app));
  }

  // ---- input -------------------------------------------------------------------------------

  handle(event: InputEvent): void {
    if (this.inspected) {
      if (event.kind === "down") this.tapInspector(event.point);
      else if (event.kind === "key" && event.key === "Escape") this.inspected = null;
      return;
    }
    if (event.kind === "down" && this.buttons.some((b) => b.click(event.point))) return;
    if (event.kind === "down" && this.touch) {
      // Touch: a tap on any face-up card enlarges it; values, flipping and the homepage link work on the big card.
      const card = this.phase === "over" ? null : this.faceUpCardAt(event.point);
      if (card) {
        this.inspected = card;
        return;
      }
    } else if (event.kind === "down") {
      const link = this.linkAt(event.point);
      if (link) {
        openUrl(link);
        return;
      }
    }
    // Online, Escape would silently drop the player from the room; there is the Leave button instead.
    if (event.kind === "key" && event.key === "Escape") {
      if (!this.session.isOnline) this.toMenu();
      return;
    }
    // Outside your own call, a click turns your hand card or a revealed table card to its info side.
    const flippable = event.kind === "down" && this.phase !== "choose" ? this.flippableAt(event.point) : null;
    if (flippable) {
      this.flip(flippable);
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
        if (confirmKey) this.continuePressed();
        break;
      case "over":
        if (confirmKey) {
          if (this.options.playAgain) this.playAgain();
          else this.toMenu();
        }
        break;
      case "wait":
        break;
    }
  }

  private handleChoose(event: InputEvent): void {
    const sprite = this.hand.get(this.youId);
    if (event.kind === "move") {
      if (sprite) sprite.hover = sprite.categoryAt(event.point, this.app.renderer)?.label ?? null;
    } else if (event.kind === "down") {
      const category = sprite?.categoryAt(event.point, this.app.renderer);
      if (category) this.select(category.label);
      else if (sprite && contains(sprite.rect(), event.point)) this.flip(sprite);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const labels = this.app.deck.categories.map((c) => c.label);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const index = this.selected ? labels.indexOf(this.selected) + step : step > 0 ? 0 : -1;
      this.select(labels[(index + labels.length) % labels.length]!);
    } else if (event.key === "Enter" || event.key === " ") {
      this.callPressed();
    }
  }

  /**
   * Cards that can be turned to their info side: your face-up hand card (from the draw until the reveal) and
   * every face-up card on the table while a round result is shown.
   */
  private flippableCards(): CardSprite[] {
    if (this.phase === "over") return [];
    const own = this.hand.get(this.youId);
    return [...this.table.values(), ...(own ? [own] : [])].filter((s) => s.faceUp);
  }

  private flippableAt(p: Point): CardSprite | null {
    const byZ = this.flippableCards().sort((a, b) => b.z - a.z);
    return byZ.find((s) => contains(s.rect(), p)) ?? null;
  }

  /** Turns your hand card between its values and its info side (keywords + summary). */
  private flip(sprite: CardSprite): void {
    // Only from a resting side, not during the draw or another flip (two tweens would fight over `turn`).
    if (Math.abs(sprite.turn - Math.round(sprite.turn)) > 1e-3) return;
    sprite.hover = null;
    this.animator.tween(sprite, FLIP_SECONDS, { turn: sprite.side === "info" ? 1 : 2 });
  }

  // ---- card zoom (touch) -------------------------------------------------------------------

  private faceUpCardAt(p: Point): CardSprite | null {
    const byZ = [...this.sprites].sort((a, b) => b.z - a.z);
    return byZ.find((s) => s.faceUp && Math.abs(Math.cos(Math.PI * s.turn)) > 0.95 && contains(s.rect(), p)) ?? null;
  }

  /** The enlarged copy of the inspected card, centered on screen (same face state as the original). */
  private inspectorSprite(): CardSprite | null {
    const original = this.inspected;
    if (!original) return null;
    // Same turn as the original, so flipping your hand card animates in the zoom as well.
    const big = new CardSprite(original.card, 640, 360, { scale: INSPECT_SCALE, turn: original.turn });
    big.highlight = original.highlight;
    big.outcome = original.outcome;
    return big;
  }

  /** Only your own card, while it's your call, can be used to pick a value. */
  private canPickFromInspector(): boolean {
    return this.phase === "choose" && this.inspected !== null && this.inspected === this.hand.get(this.youId);
  }

  private tapInspector(p: Point): void {
    const big = this.inspectorSprite();
    if (!big) return;
    const link = big.linkAt(p, this.app.renderer);
    if (link) {
      openUrl(link);
      return;
    }
    if (this.inspected && this.flippableCards().includes(this.inspected)) {
      const category = this.canPickFromInspector() ? big.categoryAt(p, this.app.renderer) : null;
      if (category) this.select(category.label);
      else if (contains(big.rect(), p)) return this.flip(this.inspected!);
    }
    this.inspected = null;
  }

  private drawInspector(ctx: CanvasRenderingContext2D): void {
    const big = this.inspectorSprite();
    if (!big) return;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(-SCREEN_W, -SCREEN_H, SCREEN_W * 3, SCREEN_H * 3);
    big.draw(ctx, this.app.renderer);
    const canPick = this.canPickFromInspector();
    const flippable = this.inspected !== null && this.flippableCards().includes(this.inspected);
    const info = big.side === "info";
    let lines: [string, string] = ["Tap anywhere", "to close"];
    let small: [string, string] | null = null;
    if (canPick && !info) {
      lines = ["Tap a value", "to pick it"];
      small = ["Tap the card elsewhere", "to read about it"];
    } else if (flippable && info) {
      lines = ["Tap the card", "to turn it back"];
      if (big.card.url) small = ["Tap the blue name for", "the library's homepage"];
    } else if (flippable) {
      lines = ["Tap the card", "to read about it"];
      small = ["Tap outside the card", "to close"];
    }
    const [first, second] = lines;
    const box = centeredRect(1060, small ? 380 : 338, 330, small ? 180 : 110);
    fillRoundRect(ctx, box, 16, colors.bgAccent);
    strokeRoundRect(ctx, box, 16, colors.pyYellow, 2);
    drawText(ctx, first, 1060, 320, { size: 28, color: colors.pyYellow, bold: true });
    drawText(ctx, second, 1060, 356, { size: 28, color: colors.pyYellow, bold: true });
    if (small) {
      drawText(ctx, small[0], 1060, 420, { size: 20, color: colors.textDim });
      drawText(ctx, small[1], 1060, 446, { size: 20, color: colors.textDim });
    }
  }

  /** Homepage links (library name on an info side) are disabled under the game-over overlay. */
  private linkAt(p: Point): string | null {
    return this.phase === "over" ? null : linkAt(this.sprites, p, this.app.renderer);
  }

  wantsPointer(p: Point): boolean {
    if (this.buttons.some((b) => b.hovered(p)) || this.linkAt(p) !== null) return true;
    // Flippable cards are clickable as a whole (on your call, the values of your card select instead).
    return this.flippableAt(p) !== null;
  }

  // ---- helpers -----------------------------------------------------------------------------

  private name(id: number): string {
    return id === this.youId ? "You" : (this.seats[id]?.name ?? `Player ${id + 1}`);
  }

  private verb(id: number, forYou: string, forOthers: string): string {
    return id === this.youId ? forYou : forOthers;
  }

  private category(label: string): Category {
    return this.app.deck.categories.find((c) => c.label === label) ?? this.app.deck.categories[0]!;
  }

  private cardByLibrary(library: string): Card | null {
    return this.app.deck.cards.find((c) => c.library === library) ?? null;
  }

  private layoutPicker(visible: boolean): void {
    const top = this.layout.tableArea.y + 85;
    // More than five categories would run into the bottom of the table, so they go into two columns.
    const columns = this.pickerButtons.length > 5 ? 2 : 1;
    const perColumn = Math.ceil(this.pickerButtons.length / columns);
    this.pickerButtons.forEach((button, i) => {
      const column = Math.floor(i / perColumn);
      const x = 640 + (column - (columns - 1) / 2) * 340;
      button.rect = centeredRect(x, top + (i % perColumn) * 52, 320, 44);
      button.visible = visible;
    });
  }

  private showToast(text: string): void {
    this.toast = text;
    this.toastTime = TOAST_SECONDS;
  }

  // ---- frame -------------------------------------------------------------------------------

  update(dt: number): void {
    this.seq.update(dt);
    this.animator.update(dt);
    if (this.toastTime > 0) this.toastTime -= dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const renderer = this.app.renderer;
    const { tableArea } = this.layout;

    if (this.started) {
      fillRoundRect(ctx, tableArea, 24, colors.bgAccent);
      for (const seat of this.seats) {
        const pos = this.layout.seats.get(seat.id);
        if (!pos) continue;
        const count = this.counts[seat.id] ?? 0;
        const gone = this.left.has(seat.id);
        const label = gone ? `${seat.name} (left)` : `${this.name(seat.id)}: ${count}`;
        const color = gone ? colors.textDim : seat.id === this.callerId && this.phase !== "over" ? colors.pyYellow : colors.text;
        drawPile(ctx, renderer, pos.pile.x, pos.pile.y, count, pos.pileScale, label, color);
      }
      drawPile(ctx, renderer, this.layout.pot.x, this.layout.pot.y, this.potCount, this.layout.potScale, `Pot: ${this.potCount}`);
      // A tie in the last round is still played out, so the count can pass the limit.
      const roundText =
        this.maxRounds && this.roundNumber > this.maxRounds
          ? "Tie-break"
          : `Round ${this.roundNumber}` + (this.maxRounds ? ` / ${this.maxRounds}` : "");
      drawText(ctx, roundText, 1260, 26, { size: 20, color: colors.textDim, align: "right" });
      this.drawLegend(ctx);
    }
    if (this.toastTime > 0) drawText(ctx, this.toast, 24, 702, { size: 15, color: colors.pyYellow, align: "left" });

    if (this.phase !== "over") this.drawCenterText(ctx);
    for (const button of [this.callButton, this.continueButton, this.leaveButton, ...this.pickerButtons]) {
      button.draw(ctx, this.app.mouse);
    }

    // Cards are the top layer: text and in-game buttons must never cover them; only the game-over overlay does.
    for (const sprite of [...this.sprites].sort((a, b) => a.z - b.z)) sprite.draw(ctx, renderer);
    if (this.inspected) this.drawInspector(ctx);

    if (this.phase === "over") {
      this.drawGameOver(ctx);
      this.againButton.draw(ctx, this.app.mouse);
      this.menuButton.draw(ctx, this.app.mouse);
    }
  }

  private drawCenterText(ctx: CanvasRenderingContext2D): void {
    const area = this.layout.tableArea;
    const pickerShown = this.pickerButtons.some((b) => b.visible);
    let y: number;
    if (this.table.size > 0) y = area.y + area.h + 35;
    else if (pickerShown) y = area.y + 30;
    else y = area.y + area.h / 2 - 20;

    if (this.callout) {
      this.drawCallout(ctx, this.callout, y);
      if (this.hint) drawText(ctx, this.hint, 640, y + 40, { size: 16, color: colors.textDim });
      return;
    }
    const messageSize = fitFontSize(ctx, this.message, 1000, 28, true);
    drawText(ctx, this.message, 640, y, { size: messageSize, color: colors.pyYellow, bold: true });
    let next = y + 34;
    if (this.detail) {
      drawText(ctx, this.detail, 640, next, { size: fitFontSize(ctx, this.detail, 1100, 18), color: colors.text });
      next += 28;
    }
    if (this.hint) drawText(ctx, this.hint, 640, next, { size: 16, color: colors.textDim });
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
    drawText(ctx, "k = thousand    M = million    B = billion    T = trillion    MB = megabyte", 1260, 704, {
      size: 12,
      color: colors.textDim,
      align: "right",
    });
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    // Oversized so the dimming also covers the letterbox bars around the 16:9 scene.
    ctx.fillStyle = "rgba(0, 0, 0, 0.63)";
    ctx.fillRect(-SCREEN_W, -SCREEN_H, SCREEN_W * 3, SCREEN_H * 3);
    const panel = centeredRect(640, 380, 620, 280);
    fillRoundRect(ctx, panel, 20, colors.bgAccent);
    strokeRoundRect(ctx, panel, 20, colors.pyYellow, 3);
    drawText(ctx, this.overTitle, 640, 320, { size: fitFontSize(ctx, this.overTitle, 580, 39, true), color: colors.pyYellow, bold: true });
    drawText(ctx, this.overDetail, 640, 380, { size: fitFontSize(ctx, this.overDetail, 580, 21) });
  }
}
