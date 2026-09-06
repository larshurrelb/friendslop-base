import type { Channel } from "./channel.js";

/** Browser WebSocket as a Channel. Resolves once the socket is usable. */
export function openSocket(path: string) {
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`,
  );
  ws.binaryType = "arraybuffer";
  const channel: Channel = {
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    send: (data) => {
      if (channel.open) ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
    onmessage: null,
    onclose: null,
  };
  ws.onmessage = (e) => channel.onmessage?.(e.data);
  ws.onclose = () => channel.onclose?.();
  ws.onerror = () => {};
  return new Promise<Channel>((resolve, reject) => {
    ws.onopen = () => resolve(channel);
    // A socket that never opens reports close, not error, in every browser.
    ws.addEventListener("close", () => reject(Error("Connection refused")), {
      once: true,
    });
  });
}
