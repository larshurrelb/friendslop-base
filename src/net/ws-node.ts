import { WebSocket } from "ws";
import type { Channel } from "./channel.js";

export function nodeChannel(ws: WebSocket): Channel {
  const channel: Channel = {
    get open() { return ws.readyState === WebSocket.OPEN; },
    get bufferedAmount() { return ws.bufferedAmount; },
    send: (data) => { if (channel.open) ws.send(data); },
    close: (code, reason) => ws.close(code, reason),
    onmessage: null,
    onclose: null,
  };
  ws.on("message", (raw, binary) => {
    const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw;
    channel.onmessage?.(binary
      ? bytes instanceof ArrayBuffer ? bytes : Uint8Array.from(bytes).buffer
      : bytes.toString());
  });
  ws.on("close", () => channel.onclose?.());
  ws.on("error", () => {});
  return channel;
}
