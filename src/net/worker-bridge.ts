import type { Channel, ChannelKind } from "./channel.js";

export type ToWorker =
  | { t: "room"; code: string }
  | { t: "open"; id: number; kind: ChannelKind }
  | { t: "msg"; id: number; data: string | ArrayBuffer }
  | { t: "close"; id: number }
  | { t: "buffer"; levels: [number, number][] };
export type FromWorker =
  | { t: "ready" }
  | { t: "msg"; id: number; data: string | ArrayBuffer }
  | { t: "close"; id: number; code?: number; reason?: string };

/**
 * Main-thread side. WebRTC cannot be reached from a worker, so every peer
 * connection stays here and is proxied across postMessage.
 */
export function bridgeToWorker(worker: Worker) {
  const channels = new Map<number, Channel>();
  let next = 1;
  worker.addEventListener("message", (e) => {
    const m = e.data as FromWorker;
    if (m.t === "ready") return;
    const channel = channels.get(m.id);
    if (!channel) return;
    if (m.t === "msg") channel.send(m.data);
    if (m.t === "close") {
      channels.delete(m.id);
      channel.close(m.code, m.reason);
    }
  });
  // The worker cannot see a DataChannel's real send queue; feed it periodically
  // so the host's backpressure checks still mean something.
  const timer = setInterval(() => {
    const levels: [number, number][] = [];
    for (const [id, c] of channels)
      if (c.bufferedAmount) levels.push([id, c.bufferedAmount]);
    worker.postMessage({ t: "buffer", levels } satisfies ToWorker);
  }, 100);
  return {
    room(code: string) {
      worker.postMessage({ t: "room", code } satisfies ToWorker);
    },
    attach(channel: Channel, kind: ChannelKind) {
      const id = next++;
      channels.set(id, channel);
      worker.postMessage({ t: "open", id, kind } satisfies ToWorker);
      channel.onmessage = (data) =>
        worker.postMessage({ t: "msg", id, data } satisfies ToWorker);
      channel.onclose = () => {
        if (!channels.delete(id)) return;
        worker.postMessage({ t: "close", id } satisfies ToWorker);
      };
    },
    dispose() {
      clearInterval(timer);
      worker.terminate();
    },
  };
}

/** Worker side. Rebuilds each proxied connection as a Channel. */
export function bridgeFromMain(
  accept: (channel: Channel, kind: ChannelKind) => void,
  post: (m: FromWorker) => void,
) {
  type Entry = { channel: Channel; buffered: number; live: boolean };
  const entries = new Map<number, Entry>();
  const drop = (id: number) => {
    const entry = entries.get(id);
    if (!entry || !entry.live) return;
    entry.live = false;
    entries.delete(id);
    entry.channel.onclose?.();
  };
  return (m: ToWorker) => {
    if (m.t === "open") {
      const id = m.id;
      const entry: Entry = { channel: null!, buffered: 0, live: true };
      entry.channel = {
        get open() {
          return entry.live;
        },
        get bufferedAmount() {
          return entry.buffered;
        },
        send: (data) => {
          if (entry.live) post({ t: "msg", id, data });
        },
        close: (code, reason) => {
          if (!entry.live) return;
          post({ t: "close", id, code, reason });
          drop(id);
        },
        onmessage: null,
        onclose: null,
      };
      entries.set(id, entry);
      accept(entry.channel, m.kind);
      return;
    }
    if (m.t === "msg") entries.get(m.id)?.channel.onmessage?.(m.data);
    if (m.t === "close") drop(m.id);
    if (m.t === "buffer") {
      for (const entry of entries.values()) entry.buffered = 0;
      for (const [id, amount] of m.levels) {
        const entry = entries.get(id);
        if (entry) entry.buffered = amount;
      }
    }
  };
}
