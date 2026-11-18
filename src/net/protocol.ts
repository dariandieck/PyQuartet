/**
 * Messages between the host (runs the authoritative engine) and the other players.
 * Cards travel as library names; every client has the same bundled deck (checked via `Deck.version`).
 */

export interface SeatInfo {
  id: number;
  name: string;
  isBot: boolean;
}

/** What every player may know: stack sizes, pot size, who left, rounds played. */
export interface PublicState {
  counts: number[];
  potCount: number;
  left: number[];
  roundNumber: number;
}

export interface PlayInfo {
  playerId: number;
  library: string;
  value: number;
}

export interface ResultInfo {
  label: string;
  callerId: number;
  plays: PlayInfo[];
  bestIds: number[];
  winnerId: number | null;
  redistributed: boolean;
  eliminatedIds: number[];
  gameOver: boolean;
}

/** Game events, played back in order by every player's game scene. */
export type GameEvent =
  | { kind: "start"; seats: SeatInfo[]; youId: number; maxRounds: number | null; callerId: number; state: PublicState }
  /** `card` is the receiving player's own drawn card (null if they don't play this round). */
  | { kind: "roundStart"; tie: boolean; participants: number[]; callerId: number; card: string | null; state: PublicState }
  /** `needsConfirm`: a bot called and the host still has to confirm with Call. */
  | { kind: "called"; callerId: number; label: string; needsConfirm: boolean }
  | { kind: "reveal"; result: ResultInfo; state: PublicState }
  | { kind: "collect"; state: PublicState }
  /** `restart`: the player left before the reveal, so the round is drawn again. */
  | { kind: "playerLeft"; playerId: number; restart: boolean; state: PublicState }
  | { kind: "gameOver"; winners: number[]; state: PublicState }
  | { kind: "hostLeft" };

export interface LobbySeat {
  name: string;
  isBot: boolean;
  isHost: boolean;
}

export type HostMessage =
  | { t: "lobby"; code: string; seats: LobbySeat[] }
  | { t: "reject"; reason: string }
  | { t: "event"; event: GameEvent }
  | { t: "ping" };

export type ClientMessage = { t: "hello"; name: string; version: string } | { t: "call"; label: string } | { t: "ping" };

export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 16;
export const CODE_LENGTH = 4;

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

export function cleanName(raw: unknown, fallback = "Player"): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
  return name || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Host-side validation: remote input is untrusted. */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (!isRecord(data)) return null;
  if (data.t === "hello" && typeof data.version === "string") {
    return { t: "hello", name: cleanName(data.name), version: data.version };
  }
  if (data.t === "call" && typeof data.label === "string") return { t: "call", label: data.label };
  if (data.t === "ping") return { t: "ping" };
  return null;
}

export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isRecord(data) || typeof data.t !== "string") return null;
  if (data.t === "event" && isRecord(data.event) && typeof data.event.kind === "string") return data as HostMessage;
  if (data.t === "lobby" && Array.isArray(data.seats) && typeof data.code === "string") return data as HostMessage;
  if (data.t === "reject" && typeof data.reason === "string") return data as HostMessage;
  if (data.t === "ping") return { t: "ping" };
  return null;
}
