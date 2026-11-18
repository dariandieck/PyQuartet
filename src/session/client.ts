import type Peer from "peerjs";
import type { ClientLink } from "../net/peer.ts";
import type { GameEvent } from "../net/protocol.ts";
import { EventChannel, type Session } from "./session.ts";

/** A joined network game: forwards the host's events to the scene and the player's call to the host. */
export class ClientSession implements Session {
  readonly isHost = false;
  readonly isOnline = true;
  private readonly channel = new EventChannel();

  constructor(
    private readonly peer: Peer,
    private readonly link: ClientLink,
    initialEvents: GameEvent[],
  ) {
    initialEvents.forEach((event) => this.channel.emit(event));
    link.onMessage = (message) => {
      if (message.t === "event") this.channel.emit(message.event);
    };
    link.onClose = () => this.channel.emit({ kind: "hostLeft" });
  }

  listen(handler: (event: GameEvent) => void): void {
    this.channel.listen(handler);
  }

  call(label: string): void {
    this.link.send({ t: "call", label });
  }

  confirmBotCall(): void {}

  continueRound(): void {}

  leave(): void {
    this.link.onClose = () => {};
    this.link.close();
    this.peer.destroy();
  }
}
