import { Button } from "../render/button.ts";
import { centeredRect, drawText, type Point } from "../render/draw.ts";
import { colors } from "../render/theme.ts";
import { HostSession } from "../session/host.ts";
import { GameScene } from "./game.ts";
import { MenuScene } from "./menu.ts";
import type { AppContext, InputEvent, Scene } from "./scene.ts";
import { loadSettings, SettingsPanel } from "./settingsPanel.ts";

/** Game settings before a local game against the bot. */
export class SetupScene implements Scene {
  private readonly panel: SettingsPanel;
  private readonly buttons: Button[];

  constructor(private readonly app: AppContext) {
    this.panel = new SettingsPanel(app, 640, 200, loadSettings(app.deck.cards.length), () => {});
    this.buttons = [
      new Button(centeredRect(640, 480, 300, 58), "Start game", () => this.start()),
      new Button(centeredRect(640, 555, 300, 50), "Back", () => app.switchTo(new MenuScene(app)), 18),
    ];
  }

  private start(): void {
    const settings = this.panel.settings;
    // Local games run through the same host session as network games, just without connections.
    const newSession = () => {
      const session = new HostSession(this.app.deck, [{ name: "You", isBot: false }, { name: "Bot", isBot: true }], settings);
      session.start();
      return session;
    };
    this.app.switchTo(new GameScene(this.app, newSession(), { playAgain: newSession }));
  }

  handle(event: InputEvent): void {
    if (event.kind === "down") {
      if (!this.panel.click(event.point)) this.buttons.some((b) => b.click(event.point));
    } else if (event.kind === "key") {
      if (event.key === "Enter" || event.key === " ") this.start();
      else if (event.key === "Escape") this.app.switchTo(new MenuScene(this.app));
    }
  }

  update(): void {
    this.panel.update();
  }

  wantsPointer(p: Point): boolean {
    return this.panel.wantsPointer(p) || this.buttons.some((b) => b.hovered(p));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawText(ctx, "Play vs Bot", 640, 110, { size: 40, color: colors.pyYellow, bold: true });
    this.panel.draw(ctx);
    for (const button of this.buttons) button.draw(ctx, this.app.mouse);
  }

  dispose(): void {
    this.panel.dispose();
  }
}
