import Peer, { type DataConnection } from "peerjs";
import { CODE_LENGTH, parseClientMessage, parseHostMessage, type ClientMessage, type HostMessage } from "./protocol.ts";

/**
 * WebRTC data channels via PeerJS. The public PeerJS broker is only used for signaling (finding each other);
 * game data flows directly between the browsers. The room code is the host's peer id.
 */

const ID_PREFIX = "pyquartet-v1-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to avoid typos
const HEARTBEAT_MS = 2000;
// Generous, because browsers throttle timers in background tabs.
const TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 12_000;

export function randomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
}

export class NetError extends Error {
  override name = "NetError";
}

/** A message channel with heartbeat, so a vanished peer is noticed even without a clean close. */
export class Link<In, Out> {
  onMessage: (message: In) => void = () => {};
  onClose: () => void = () => {};
  private lastSeen = Date.now();
  private closed = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly conn: DataConnection,
    parse: (data: unknown) => In | null,
  ) {
    conn.on("data", (data) => {
      this.lastSeen = Date.now();
      const message = parse(data);
      if (message && (message as { t?: string }).t !== "ping") this.onMessage(message);
    });
    conn.on("close", () => this.shutDown());
    conn.on("error", () => this.shutDown());
    this.timer = setInterval(() => {
      if (Date.now() - this.lastSeen > TIMEOUT_MS) this.shutDown();
      else this.send({ t: "ping" } as Out);
    }, HEARTBEAT_MS);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  send(message: Out): void {
    if (!this.closed && this.conn.open) this.conn.send(message);
  }

  close(): void {
    this.shutDown();
  }

  private shutDown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.conn.close();
    this.onClose();
  }
}

export type HostLink = Link<ClientMessage, HostMessage>;
export type ClientLink = Link<HostMessage, ClientMessage>;

function destroyOnPageHide(peer: Peer): void {
  // Closing the tab should end connections right away instead of waiting for the heartbeat timeout.
  const handler = () => peer.destroy();
  window.addEventListener("pagehide", handler);
  peer.on("close", () => window.removeEventListener("pagehide", handler));
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const fail = (error: unknown) => {
      peer.destroy();
      reject(error);
    };
    peer.once("open", () => {
      peer.off("error", fail);
      resolve(peer);
    });
    peer.once("error", fail);
  });
}

export class HostPeer {
  onConnection: (link: HostLink) => void = (link) => link.close();

  private constructor(
    private readonly peer: Peer,
    readonly code: string,
  ) {
    destroyOnPageHide(peer);
    peer.on("connection", (conn) => {
      conn.on("open", () => this.onConnection(new Link(conn, parseClientMessage)));
    });
  }

  /** Opens a room under a fresh random code (retrying if a code is taken). */
  static async create(): Promise<HostPeer> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        return new HostPeer(await openPeer(ID_PREFIX + code.toLowerCase()), code);
      } catch (error) {
        if ((error as { type?: string }).type !== "unavailable-id") throw describe(error);
      }
    }
    throw new NetError("Could not reserve a room code, please try again.");
  }

  destroy(): void {
    this.peer.destroy();
  }
}

function describe(error: unknown): NetError {
  const type = (error as { type?: string }).type;
  if (type === "peer-unavailable") return new NetError("Room not found. Check the code.");
  if (type === "browser-incompatible") return new NetError("This browser does not support WebRTC.");
  if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
    return new NetError("Could not reach the connection server. Check your internet connection.");
  }
  return new NetError(error instanceof Error ? error.message : String(error));
}

export interface JoinedRoom {
  peer: Peer;
  link: ClientLink;
}

export async function joinRoom(code: string): Promise<JoinedRoom> {
  let peer: Peer;
  try {
    peer = await openPeer();
  } catch (error) {
    throw describe(error);
  }
  destroyOnPageHide(peer);
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      clearTimeout(timeout);
      peer.destroy();
      reject(describe(error));
    };
    const timeout = setTimeout(() => fail(new NetError("Connection timed out. Is the room still open?")), CONNECT_TIMEOUT_MS);
    peer.once("error", fail);
    const conn = peer.connect(ID_PREFIX + code.toLowerCase(), { reliable: true, serialization: "json" });
    conn.once("open", () => {
      clearTimeout(timeout);
      peer.off("error", fail);
      resolve({ peer, link: new Link(conn, parseHostMessage) });
    });
    conn.once("error", fail);
  });
}
