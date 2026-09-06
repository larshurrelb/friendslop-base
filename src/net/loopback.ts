import type { Channel } from "./channel.js";

/**
 * Two Channels wired to each other in memory. Used by tests, and by any host
 * that needs to talk to itself without a transport in between.
 */
export function linkedChannels(): [Channel, Channel] {
  const make = (): Channel & { peer?: Channel } => ({
    open: true,
    bufferedAmount: 0,
    send() {},
    close() {},
    onmessage: null,
    onclose: null,
  });
  const a = make(),
    b = make();
  let live = true;
  const wire = (from: Channel, to: Channel) => {
    Object.defineProperty(from, "open", { get: () => live });
    from.send = (data) => {
      if (!live) return;
      // Deliver asynchronously so a send never re-enters its own caller.
      queueMicrotask(() => to.onmessage?.(data));
    };
    from.close = () => {
      if (!live) return;
      live = false;
      queueMicrotask(() => {
        from.onclose?.();
        to.onclose?.();
      });
    };
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}
