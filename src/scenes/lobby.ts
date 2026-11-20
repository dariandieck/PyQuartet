import { cleanSettings } from "../game/settings.ts";
import type { HostLink, HostPeer, JoinedRoom } from "../net/peer.ts";
import {
  cleanName,
  CODE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  normalizeCode,
  type HostMessage,
  type LobbySeat,
} from "../net/protocol.ts";
import { Button } from "../render/button.ts";
import { centeredRect, drawText, fillRoundRect, type Point } from "../render/draw.ts";
import { HtmlInput } from "../render/htmlInput.ts";
import { colors } from "../render/theme.ts";
import { ClientSession } from "../session/client.ts";
import { HostSession } from "../session/host.ts";
import { GameScene } from "./game.ts";
import { MenuScene } from "./menu.ts";
import type { AppContext, InputEvent, Scene } from "./scene.ts";
import { loadSettings, SettingsPanel } from "./settingsPanel.ts";

const NAME_KEY = "pyquartet.name";

/** PeerJS is ~100 KB, so it is only loaded once someone actually creates or joins a room. */
const loadNet = () => import("../net/peer.ts");

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.name === "NetError" ? error.message : fallback;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage can be blocked (private mode); the name is just not remembered then.
  }
}

type Mode = "host" | "join";
type Stage = "form" | "connecting" | "room";

interface Member {
  name: string;
  isBot: boolean;
  isHost: boolean;
  link?: HostLink;
}

const ROW_X = 430;
const ROW_Y = 290;
const ROW_STEP = 50;
// Game settings sit to the right of the player list.
const PANEL_X = 930;
const PANEL_TOP = 262;

/** Create a room (host) or join one by code; hands the connections to a game session on start. */
export class LobbyScene implements Scene {
  private stage: Stage = "form";
  private error = "";
  private toast = "";
  private toastTime = 0;
  private readonly nameInput: HtmlInput;
  private readonly codeInput: HtmlInput | null = null;
  /** Editable for the host; guests see the host's choice once the first lobby update arrives. */
  private readonly panel: SettingsPanel;
  private settingsKnown: boolean;

  // Host side
  private hostPeer: HostPeer | null = null;
  private members: Member[] = [];
  // Join side
  private joined: JoinedRoom | null = null;
  private seats: LobbySeat[] = [];

  private code = "";
  /** Set once a game session owns the connections, so disposing the lobby must not close them. */
  private handedOver = false;
  private disposed = false;

  private readonly primaryButton: Button;
  private readonly backButton: Button;
  private readonly copyButton: Button;
  private readonly addBotButton: Button;
  private readonly startButton: Button;
  private readonly leaveButton: Button;
  private removeButtons: Button[] = [];

  constructor(
    private readonly app: AppContext,
    private readonly mode: Mode,
  ) {
    const formTop = mode === "host" ? 245 : 225;
    this.nameInput = new HtmlInput(app, centeredRect(640, formTop, 360, 50), {
      value: loadName(),
      placeholder: "Your name",
      maxLength: MAX_NAME_LENGTH,
      enterKeyHint: mode === "join" ? "next" : "go",
      // When joining, the keyboard's enter key moves on to the code field instead of submitting half a form.
      onEnter: () => (this.codeInput ? this.codeInput.element.focus() : this.submit()),
    });
    if (mode === "join") {
      this.codeInput = new HtmlInput(app, centeredRect(640, 335, 220, 50), {
        placeholder: "CODE",
        // A little slack for pasted codes with spaces or dashes; normalizeCode() cleans it up on submit.
        maxLength: CODE_LENGTH + 4,
        className: "code",
        autocapitalize: "characters",
        enterKeyHint: "go",
        onEnter: () => this.submit(),
      });
    }
    const settings = loadSettings(app.deck.cards.length);
    this.panel = new SettingsPanel(app, PANEL_X, PANEL_TOP, settings, mode === "host" ? () => this.broadcastLobby() : undefined);
    this.panel.visible = false;
    this.settingsKnown = mode === "host";
    const primaryY = mode === "host" ? 340 : 430;
    this.primaryButton = new Button(centeredRect(640, primaryY, 300, 58), mode === "host" ? "Create room" : "Join", () =>
      this.submit(),
    );
    this.backButton = new Button(centeredRect(640, primaryY + 72, 300, 50), "Back", () => this.toMenu(), 18);
    this.copyButton = new Button(centeredRect(830, 178, 100, 40), "Copy", () => this.copyCode(), 16);
    this.addBotButton = new Button(centeredRect(ROW_X, 525, 200, 52), "Add bot", () => this.addBot(), 18);
    this.startButton = new Button(centeredRect(PANEL_X, 525, 200, 52), "Start game", () => this.startGame(), 18);
    this.leaveButton = new Button(centeredRect(640, 610, 200, 50), "Leave", () => this.toMenu(), 18);
    (this.codeInput ?? this.nameInput).focus();
    if (mode === "join" && !this.nameInput.value) this.nameInput.focus();
  }

  private get buttons(): Button[] {
    return [
      this.primaryButton,
      this.backButton,
      this.copyButton,
      this.addBotButton,
      this.startButton,
      this.leaveButton,
      ...this.removeButtons,
    ];
  }

  // ---- form --------------------------------------------------------------------------------

  private submit(): void {
    if (this.stage !== "form") return;
    this.error = "";
    if (this.mode === "host") void this.createRoom();
    else void this.join();
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.nameInput.visible = stage === "form";
    if (this.codeInput) this.codeInput.visible = stage === "form";
    this.panel.visible = stage === "room";
  }

  private fail(message: string): void {
    this.closeConnections();
    this.error = message;
    this.setStage("form");
  }

  // ---- host --------------------------------------------------------------------------------

  private async createRoom(): Promise<void> {
    const name = cleanName(this.nameInput.value, "Host");
    saveName(name);
    this.setStage("connecting");
    try {
      const { HostPeer } = await loadNet();
      const peer = await HostPeer.create();
      if (this.disposed) {
        peer.destroy();
        return;
      }
      this.hostPeer = peer;
      this.code = peer.code;
      this.members = [{ name, isBot: false, isHost: true }];
      peer.onConnection = (link) => this.onGuest(link);
      this.rebuildRows();
      this.setStage("room");
    } catch (error) {
      if (!this.disposed) this.fail(errorText(error, "Could not create the room."));
    }
  }

  private onGuest(link: HostLink): void {
    link.onMessage = (message) => {
      if (message.t !== "hello" || this.members.some((m) => m.link === link)) return;
      if (message.version !== this.app.deck.version) {
        return this.reject(link, "Your game version differs from the host's. Reload the page and try again.");
      }
      if (this.handedOver) return this.reject(link, "The game has already started.");
      if (this.members.length >= MAX_PLAYERS) return this.reject(link, "The room is full.");
      this.members.push({ name: this.uniqueName(message.name), isBot: false, isHost: false, link });
      this.membersChanged();
    };
    link.onClose = () => {
      const before = this.members.length;
      this.members = this.members.filter((m) => m.link !== link);
      if (this.members.length !== before) this.membersChanged();
    };
  }

  private reject(link: HostLink, reason: string): void {
    link.send({ t: "reject", reason });
    setTimeout(() => link.close(), 500);
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.members.map((m) => m.name));
    if (!taken.has(name)) return name;
    let i = 2;
    while (taken.has(`${name} ${i}`)) i++;
    return `${name} ${i}`;
  }

  private addBot(): void {
    if (this.members.length >= MAX_PLAYERS) return;
    let i = 1;
    while (this.members.some((m) => m.name === `Bot ${i}`)) i++;
    this.members.push({ name: `Bot ${i}`, isBot: true, isHost: false });
    this.membersChanged();
  }

  private removeMember(index: number): void {
    if (!this.members[index]?.isBot) return;
    this.members.splice(index, 1);
    this.membersChanged();
  }

  private membersChanged(): void {
    this.rebuildRows();
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    const settings = this.panel.settings;
    const seats: LobbySeat[] = this.members.map(({ name, isBot, isHost }) => ({ name, isBot, isHost }));
    for (const member of this.members) member.link?.send({ t: "lobby", code: this.code, seats, settings });
  }

  private rebuildRows(): void {
    this.removeButtons = [];
    if (this.mode !== "host") return;
    this.members.forEach((member, i) => {
      if (!member.isBot) return;
      const button = new Button(centeredRect(ROW_X + 190, ROW_Y + i * ROW_STEP, 34, 34), "×", () => this.removeMember(i), 20);
      this.removeButtons.push(button);
    });
  }

  private startGame(): void {
    const peer = this.hostPeer;
    if (!peer || this.members.length < 2 || this.handedOver) return;
    this.handedOver = true;
    const seats = this.members.map(({ name, isBot, link }) => ({ name, isBot, link }));
    const session = new HostSession(this.app.deck, seats, this.panel.settings, () => peer.destroy());
    this.app.switchTo(new GameScene(this.app, session));
    session.start();
  }

  private copyCode(): void {
    void navigator.clipboard?.writeText(this.code).then(
      () => this.showToast("Room code copied."),
      () => this.showToast("Could not copy, please share the code by hand."),
    );
  }

  // ---- join --------------------------------------------------------------------------------

  private async join(): Promise<void> {
    const name = cleanName(this.nameInput.value);
    const code = normalizeCode(this.codeInput?.value ?? "");
    if (code.length !== CODE_LENGTH) {
      this.error = `Enter the ${CODE_LENGTH}-character room code.`;
      return;
    }
    saveName(name);
    this.setStage("connecting");
    try {
      const { joinRoom } = await loadNet();
      const room = await joinRoom(code);
      if (this.disposed) {
        room.peer.destroy();
        return;
      }
      this.joined = room;
      this.code = code;
      room.link.onMessage = (message) => this.onHostMessage(message);
      room.link.onClose = () => {
        if (!this.handedOver) this.fail("Lost the connection to the room.");
      };
      room.link.send({ t: "hello", name, version: this.app.deck.version });
      this.setStage("room");
    } catch (error) {
      if (!this.disposed) this.fail(errorText(error, "Could not join the room."));
    }
  }

  private onHostMessage(message: HostMessage): void {
    const room = this.joined;
    if (!room) return;
    if (message.t === "lobby") {
      this.seats = message.seats;
      this.panel.settings = cleanSettings(message.settings, this.app.deck.cards.length);
      this.settingsKnown = true;
    } else if (message.t === "reject") {
      this.fail(message.reason);
    } else if (message.t === "event" && message.event.kind === "start") {
      this.handedOver = true;
      const session = new ClientSession(room.peer, room.link, [message.event]);
      this.app.switchTo(new GameScene(this.app, session));
    }
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  private closeConnections(): void {
    if (this.handedOver) return;
    for (const member of this.members) {
      if (!member.link) continue;
      member.link.onClose = () => {};
      member.link.close();
    }
    this.members = [];
    this.hostPeer?.destroy();
    this.hostPeer = null;
    if (this.joined) {
      this.joined.link.onClose = () => {};
      this.joined.peer.destroy();
      this.joined = null;
    }
    this.seats = [];
    this.removeButtons = [];
  }

  private toMenu(): void {
    this.app.switchTo(new MenuScene(this.app));
  }

  dispose(): void {
    this.disposed = true;
    this.nameInput.dispose();
    this.codeInput?.dispose();
    this.panel.dispose();
    this.closeConnections();
  }

  private showToast(text: string): void {
    this.toast = text;
    this.toastTime = 3;
  }

  // ---- scene -------------------------------------------------------------------------------

  handle(event: InputEvent): void {
    if (event.kind === "down") {
      if (!this.panel.click(event.point)) this.buttons.some((b) => b.click(event.point));
    } else if (event.kind === "key") {
      if (event.key === "Escape") this.toMenu();
      else if (event.key === "Enter" && this.stage === "form") this.submit();
    }
  }

  update(dt: number): void {
    if (this.toastTime > 0) this.toastTime -= dt;
    const { stage, mode } = this;
    const hosting = mode === "host" && stage === "room";
    this.primaryButton.visible = stage === "form";
    this.backButton.visible = stage !== "room";
    this.backButton.text = stage === "connecting" ? "Cancel" : "Back";
    this.copyButton.visible = hosting;
    this.addBotButton.visible = hosting;
    this.addBotButton.enabled = this.members.length < MAX_PLAYERS;
    this.startButton.visible = hosting;
    this.startButton.enabled = this.members.length >= 2;
    this.leaveButton.visible = stage === "room";
    this.nameInput.sync();
    this.codeInput?.sync();
    this.panel.update();
  }

  wantsPointer(p: Point): boolean {
    return this.panel.wantsPointer(p) || this.buttons.some((b) => b.hovered(p));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const title = this.mode === "host" ? "Create a room" : "Join a room";
    drawText(ctx, title, 640, this.stage === "room" ? 70 : 110, { size: 40, color: colors.pyYellow, bold: true });

    if (this.stage === "form") this.drawForm(ctx);
    else if (this.stage === "connecting") drawText(ctx, "Connecting...", 640, 300, { size: 24 });
    else this.drawRoom(ctx);

    for (const button of this.buttons) button.draw(ctx, this.app.mouse);
    if (this.toastTime > 0) drawText(ctx, this.toast, 640, 680, { size: 16, color: colors.pyYellow });
  }

  private drawForm(ctx: CanvasRenderingContext2D): void {
    const nameY = this.nameInput.rect.y;
    drawText(ctx, "Your name", 640, nameY - 18, { size: 17, color: colors.textDim });
    if (this.codeInput) {
      drawText(ctx, "Room code", 640, this.codeInput.rect.y - 18, { size: 17, color: colors.textDim });
    }
    if (this.error) drawText(ctx, this.error, 640, 560, { size: 18, color: colors.rowLose });
    const note =
      this.mode === "host"
        ? "Other players join with the room code. Everyone needs internet access to connect."
        : "Ask the host for the room code.";
    drawText(ctx, note, 640, 620, { size: 15, color: colors.textDim });
  }

  private drawRoom(ctx: CanvasRenderingContext2D): void {
    drawText(ctx, "Room code", 640, 128, { size: 17, color: colors.textDim });
    [...this.code].forEach((char, i) => {
      drawText(ctx, char, 640 + (i - (this.code.length - 1) / 2) * 52, 178, { size: 56, color: colors.pyYellow, bold: true });
    });
    const shareHint =
      this.mode === "host" ? "Share this code with the other players." : "Connected. Waiting for the host to start...";
    drawText(ctx, shareHint, 640, 232, { size: 17, color: colors.textDim });

    const rows: (LobbySeat | null)[] = this.mode === "host" ? this.members : this.seats;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const y = ROW_Y + i * ROW_STEP;
      const seat = rows[i] ?? null;
      fillRoundRect(ctx, centeredRect(ROW_X, y, 440, 42), 10, colors.bgAccent);
      if (!seat) {
        drawText(ctx, `${i + 1}.  Open seat`, ROW_X - 200, y + 1, { size: 18, color: colors.textDim, align: "left" });
        continue;
      }
      const tag = seat.isHost ? "  (host)" : seat.isBot ? "  (bot)" : "";
      drawText(ctx, `${i + 1}.  ${seat.name}${tag}`, ROW_X - 200, y + 1, { size: 18, bold: !seat.isBot, align: "left" });
    }
    if (this.settingsKnown) this.panel.draw(ctx);
  }
}
