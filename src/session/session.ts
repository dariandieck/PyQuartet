import type { GameEvent } from "../net/protocol.ts";

/**
 * A running game as seen by one player. The scene renders the events and sends the player's intents back;
 * the same interface covers local games (host without network), hosting and joining.
 */
export interface Session {
  readonly isHost: boolean;
  readonly isOnline: boolean;
  /** Events emitted before a listener is attached are buffered and replayed. */
  listen(handler: (event: GameEvent) => void): void;
  /** The local player calls a category (only valid while they are the caller). */
  call(label: string): void;
  /** Host only: plays the category a bot announced. */
  confirmBotCall(): void;
  /** Host only: collects the cards and starts the next round. */
  continueRound(): void;
  leave(): void;
}

export class EventChannel {
  private handler: ((event: GameEvent) => void) | null = null;
  private buffer: GameEvent[] = [];

  listen(handler: (event: GameEvent) => void): void {
    this.handler = handler;
    const pending = this.buffer;
    this.buffer = [];
    pending.forEach(handler);
  }

  emit(event: GameEvent): void {
    if (this.handler) this.handler(event);
    else this.buffer.push(event);
  }
}
