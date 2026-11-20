import { cleanSettings, describeMode, minCards, ROUND_LIMIT, type GameMode, type GameSettings } from "../game/settings.ts";
import { Button } from "../render/button.ts";
import { centeredRect, drawText, type Point } from "../render/draw.ts";
import { HtmlSlider } from "../render/htmlSlider.ts";
import { colors } from "../render/theme.ts";
import type { AppContext } from "./scene.ts";

const SETTINGS_KEY = "pyquartet.settings";

/** Last used settings (shared by "Play vs Bot" and hosting), clamped to the current deck. */
export function loadSettings(deckSize: number): GameSettings {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"), deckSize);
  } catch {
    return cleanSettings(null, deckSize);
  }
}

function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked (private mode); the settings are just not remembered then.
  }
}

export const PANEL_HEIGHT = 200;

/**
 * Game mode toggle + card count slider, about 420 x 200 logical px from `top` down.
 * Without `onChange` it is read-only (guests in a room see what the host picked).
 */
export class SettingsPanel {
  private readonly modeButtons: Button[] = [];
  private readonly slider: HtmlSlider | null = null;
  private shown = true;

  constructor(
    private readonly app: AppContext,
    private readonly cx: number,
    private readonly top: number,
    public settings: GameSettings,
    private readonly onChange?: (settings: GameSettings) => void,
  ) {
    if (!onChange) return;
    const modes: [GameMode, string][] = [
      ["classic", "Classic"],
      ["rounds", `${ROUND_LIMIT} rounds`],
    ];
    modes.forEach(([mode, text], i) => {
      const rect = centeredRect(cx + (i - 0.5) * 210, top + 50, 200, 56);
      this.modeButtons.push(new Button(rect, text, () => this.change({ ...this.settings, mode }), 19));
    });
    const deckSize = app.deck.cards.length;
    this.slider = new HtmlSlider(app, centeredRect(cx, top + 178, 400, 40), {
      min: minCards(deckSize),
      max: deckSize,
      value: settings.cardCount,
      label: "Cards in play",
      onInput: (cardCount) => this.change({ ...this.settings, cardCount }),
    });
  }

  private change(settings: GameSettings): void {
    if (settings.mode === this.settings.mode && settings.cardCount === this.settings.cardCount) return;
    this.settings = settings;
    saveSettings(settings);
    this.onChange?.(settings);
  }

  set visible(visible: boolean) {
    this.shown = visible;
    for (const button of this.modeButtons) button.visible = visible;
    if (this.slider) this.slider.visible = visible;
  }

  /** Returns true if the click hit one of the panel's buttons. */
  click(p: Point): boolean {
    return this.modeButtons.some((b) => b.click(p));
  }

  wantsPointer(p: Point): boolean {
    return this.modeButtons.some((b) => b.hovered(p));
  }

  update(): void {
    this.modeButtons.forEach((button, i) => {
      button.selected = (i === 0 ? "classic" : "rounds") === this.settings.mode;
    });
    this.slider?.sync();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.shown) return;
    const { cx, top, settings } = this;
    const total = this.app.deck.cards.length;
    const cards = `Cards in play: ${settings.cardCount} of ${total}`;
    if (this.slider) {
      drawText(ctx, "Game mode", cx, top + 8, { size: 17, color: colors.textDim });
      for (const button of this.modeButtons) button.draw(ctx, this.app.mouse);
      drawText(ctx, describeMode(settings.mode), cx, top + 100, { size: 15, color: colors.textDim });
      drawText(ctx, cards, cx, top + 140, { size: 19, bold: true });
    } else {
      drawText(ctx, "Game settings", cx, top + 8, { size: 17, color: colors.textDim });
      drawText(ctx, settings.mode === "rounds" ? `${ROUND_LIMIT} rounds` : "Classic", cx, top + 55, { size: 22, bold: true });
      drawText(ctx, describeMode(settings.mode), cx, top + 90, { size: 15, color: colors.textDim });
      drawText(ctx, cards, cx, top + 140, { size: 19, bold: true });
    }
  }

  dispose(): void {
    this.slider?.dispose();
  }
}
