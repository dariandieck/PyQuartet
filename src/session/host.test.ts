import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "../game/deck.ts";
import type { Card, Category } from "../game/model.ts";
import { defaultSettings } from "../game/settings.ts";
import type { HostLink } from "../net/peer.ts";
import type { ClientMessage, GameEvent, HostMessage } from "../net/protocol.ts";
import { HostSession } from "./host.ts";

const stars: Category = { label: "Stars", unit: null, polarity: "positive", source: null };
const card = (library: string, value: number): Card => ({
  library,
  url: null,
  imgUrl: null,
  imgScale: 1,
  keywords: [],
  summary: null,
  color: null,
  stats: { Stars: value },
});
const deck: Deck = {
  cards: ["a", "b", "c", "d", "e", "f"].map((l, i) => card(l, i)),
  categories: [stars],
  version: "test",
};
const ALL_CARDS = defaultSettings(deck.cards.length);

/** Stands in for a PeerJS link: records what the host sends and lets the test play the remote side. */
function fakeLink() {
  const sent: HostMessage[] = [];
  const link = {
    sent,
    onMessage: (_message: ClientMessage) => {},
    onClose: () => {},
    send: (message: HostMessage) => void sent.push(message),
    close: () => link.onClose(),
  };
  return link;
}

const events = (link: ReturnType<typeof fakeLink>) =>
  link.sent.flatMap((m) => (m.t === "event" ? [m.event] : []));

function collect(session: HostSession): GameEvent[] {
  const received: GameEvent[] = [];
  session.listen((e) => received.push(e));
  return received;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HostSession", () => {
  it("plays a local round against a bot: start, draw, call, reveal, collect", () => {
    const session = new HostSession(deck, [{ name: "You", isBot: false }, { name: "Bot", isBot: true }], ALL_CARDS);
    const received = collect(session);
    session.start();
    expect(received.map((e) => e.kind)).toEqual(["start", "roundStart"]);

    const roundStart = received[1] as Extract<GameEvent, { kind: "roundStart" }>;
    expect(roundStart.card).not.toBeNull();
    if (roundStart.callerId === 0) {
      session.call("Stars");
    } else {
      vi.advanceTimersByTime(2000);
      expect(received.at(-1)).toMatchObject({ kind: "called", callerId: 1, waitingFor: [0] });
      session.confirmCall();
    }
    expect(received.at(-1)).toMatchObject({ kind: "reveal" });

    session.continueRound();
    const after = received.slice(-2).map((e) => e.kind);
    expect(after[0] === "collect" || after[1] === "gameOver").toBe(true);
  });

  it("sends each player only their own card and ignores calls from non-callers", () => {
    const remote = fakeLink();
    const session = new HostSession(
      deck,
      [
        { name: "Host", isBot: false },
        { name: "Anna", isBot: false, link: remote as unknown as HostLink },
      ],
      ALL_CARDS,
    );
    const local = collect(session);
    session.start();

    const remoteStart = events(remote)[0] as Extract<GameEvent, { kind: "start" }>;
    expect(remoteStart.youId).toBe(1);
    const localRound = local[1] as Extract<GameEvent, { kind: "roundStart" }>;
    const remoteRound = events(remote)[1] as Extract<GameEvent, { kind: "roundStart" }>;
    expect(localRound.card).not.toEqual(remoteRound.card);

    const notCaller = localRound.callerId === 0 ? 1 : 0;
    if (notCaller === 0) session.call("Stars");
    else remote.onMessage({ t: "call", label: "Stars" });
    expect(local.at(-1)!.kind).toBe("roundStart"); // nothing happened

    if (localRound.callerId === 0) session.call("Stars");
    else remote.onMessage({ t: "call", label: "Stars" });
    expect(local.at(-1)).toMatchObject({ kind: "called", waitingFor: [notCaller] });

    // The caller can't confirm for the other player; the other player's Call reveals the cards.
    if (notCaller === 0) remote.onMessage({ t: "confirm" });
    else session.confirmCall();
    expect(local.at(-1)!.kind).toBe("called");
    if (notCaller === 0) session.confirmCall();
    else remote.onMessage({ t: "confirm" });
    expect(local.slice(-2).map((e) => e.kind)).toEqual(["confirmed", "reveal"]);
  });

  it("waits for every human in the round to click Call after a bot's call", () => {
    const remote = fakeLink();
    // Math.random 0.99 makes the last seat (the bot) the first caller.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const session = new HostSession(
      deck,
      [
        { name: "Host", isBot: false },
        { name: "Anna", isBot: false, link: remote as unknown as HostLink },
        { name: "Bot", isBot: true },
      ],
      ALL_CARDS,
    );
    vi.restoreAllMocks();
    const local = collect(session);
    session.start();
    vi.advanceTimersByTime(2000);
    expect(local.at(-1)).toMatchObject({ kind: "called", callerId: 2, waitingFor: [0, 1] });

    session.confirmCall();
    expect(local.at(-1)).toMatchObject({ kind: "confirmed", playerId: 0, waitingFor: [1] });
    remote.onMessage({ t: "confirm" });
    expect(local.slice(-2).map((e) => e.kind)).toEqual(["confirmed", "reveal"]);
  });

  it("redraws the round without a player who leaves before the reveal", () => {
    const remote = fakeLink();
    const session = new HostSession(
      deck,
      [
        { name: "Host", isBot: false },
        { name: "Anna", isBot: false, link: remote as unknown as HostLink },
        { name: "Bot 1", isBot: true },
      ],
      ALL_CARDS,
    );
    const local = collect(session);
    session.start();
    remote.close();

    const left = local.find((e) => e.kind === "playerLeft") as Extract<GameEvent, { kind: "playerLeft" }>;
    expect(left).toMatchObject({ playerId: 1, restart: true });
    expect(left.state.counts[1]).toBe(0);
    expect(left.state.potCount).toBe(2);
    const redraw = local.at(-1) as Extract<GameEvent, { kind: "roundStart" }>;
    expect(redraw.kind).toBe("roundStart");
    expect(redraw.participants).toEqual([0, 2]);
  });

  it("ends the game when the only other player leaves", () => {
    const remote = fakeLink();
    const session = new HostSession(
      deck,
      [
        { name: "Host", isBot: false },
        { name: "Anna", isBot: false, link: remote as unknown as HostLink },
      ],
      ALL_CARDS,
    );
    const local = collect(session);
    session.start();
    remote.close();
    expect(local.at(-1)).toMatchObject({ kind: "gameOver", winners: [0] });
  });

  it("deals only the chosen number of cards and announces the round limit", () => {
    const session = new HostSession(deck, [{ name: "You", isBot: false }, { name: "Bot", isBot: true }], {
      mode: "rounds",
      cardCount: 4,
    });
    const received = collect(session);
    session.start();
    const start = received[0] as Extract<GameEvent, { kind: "start" }>;
    expect(start.maxRounds).toBe(10);
    expect(start.state.counts.reduce((a, b) => a + b, 0) + start.state.potCount).toBe(4);
  });
});
