import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import { roomCode, type Channel, type ChannelKind } from "./channel.js";

/** Room codes are short and shared; namespace them inside the broker. */
const PREFIX = "friendslop-";
export type Broker = PeerOptions | undefined;

/**
 * peerjs maps `reliable: false` onto `ordered: false` only — the channel still
 * retransmits, so this is not the fire-and-forget datagram the protocol could
 * tolerate. What it does buy is the end of head-of-line blocking.
 *
 * Game stays ordered on purpose. The snapshot and input encodings tolerate loss
 * and reordering, but the JSON `join` must reach the authority before the first
 * binary input or the connection is rejected, and an unordered channel cannot
 * promise that. Voice is unordered because a jitter-buffered Opus stream would
 * rather drop a packet than wait behind one; its pre-auth frames are dropped
 * rather than fatal (see acceptVoice in src/host/index.ts).
 */
const GAME = { serialization: "raw", reliable: true } as const;
const VOICE = { serialization: "raw", reliable: false } as const;

function channelFor(conn: DataConnection): Channel {
  const channel: Channel = {
    get open() {
      return conn.open;
    },
    get bufferedAmount() {
      return conn.dataChannel?.bufferedAmount ?? 0;
    },
    send: (data) => {
      if (conn.open) conn.send(data);
    },
    // Never close({ flush: true }): in raw mode the marker object cannot be sent.
    close: () => conn.close(),
    onmessage: null,
    onclose: null,
  };
  conn.on("data", (data) => channel.onmessage?.(data as string | ArrayBuffer));
  conn.on("close", () => channel.onclose?.());
  conn.on("error", () => channel.onclose?.());
  return channel;
}

/** Claim a room code with the broker and surface each incoming connection. */
export async function hostRoom(
  broker: Broker,
  onChannel: (channel: Channel, kind: ChannelKind) => void,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    const peer = new Peer(PREFIX + code, broker);
    const outcome = await new Promise<"open" | "taken" | Error>((resolve) => {
      peer.once("open", () => resolve("open"));
      peer.once("error", (e: any) =>
        resolve(e?.type === "unavailable-id" ? "taken" : (e as Error)),
      );
    });
    if (outcome === "taken") {
      peer.destroy();
      continue;
    }
    if (outcome !== "open") {
      peer.destroy();
      throw outcome;
    }
    peer.on("connection", (conn) => {
      const kind: ChannelKind =
        (conn.metadata as any)?.kind === "voice" ? "voice" : "game";
      if (conn.open) onChannel(channelFor(conn), kind);
      else conn.once("open", () => onChannel(channelFor(conn), kind));
    });
    return { code, peer };
  }
  throw Error("Could not claim a room code. Try again.");
}

/** A joining player's side: one broker registration, one channel per kind. */
export class RoomClient {
  private peer?: Peer;
  constructor(private broker: Broker) {}
  private async ready() {
    if (this.peer && !this.peer.destroyed) return this.peer;
    const peer = (this.peer = new Peer(this.broker ?? {}));
    await new Promise<void>((resolve, reject) => {
      peer.once("open", () => resolve());
      peer.once("error", reject);
    });
    return peer;
  }
  async open(code: string, kind: ChannelKind) {
    const peer = await this.ready();
    const conn = peer.connect(PREFIX + code.toUpperCase(), {
      ...(kind === "voice" ? VOICE : GAME),
      metadata: { kind },
    });
    return new Promise<Channel>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Could not reach the host. They may have left.")),
        15000,
      );
      conn.once("open", () => {
        clearTimeout(timer);
        resolve(channelFor(conn));
      });
      conn.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
  dispose() {
    this.peer?.destroy();
    this.peer = undefined;
  }
}
