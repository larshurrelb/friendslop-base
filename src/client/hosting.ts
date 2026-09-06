import { bridgeToWorker } from "../net/worker-bridge";
import { hostRoom, type Broker } from "../net/peer";
import { linkedChannels } from "../net/loopback";
import type { Channel, ChannelKind } from "../net/channel";

export type Hosting = {
  code: string;
  /** The host is a player too, and joins itself through the normal path. */
  local(kind: ChannelKind): Channel;
  dispose(): void;
};

/** Run the authority in a worker so a backgrounded tab keeps the room ticking. */
export async function startHosting(broker: Broker): Promise<Hosting> {
  const worker = new Worker(new URL("../host/worker.ts", import.meta.url), {
    type: "module",
  });
  const bridge = bridgeToWorker(worker);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("The room engine did not start.")),
      15000,
    );
    worker.addEventListener("message", function ready(e) {
      if ((e.data as any)?.t !== "ready") return;
      worker.removeEventListener("message", ready);
      clearTimeout(timer);
      resolve();
    });
    worker.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(Error(e.message || "The room engine failed to load."));
    });
  });
  let peer: { destroy(): void };
  let code: string;
  try {
    ({ code, peer } = await hostRoom(broker, (channel, kind) =>
      bridge.attach(channel, kind),
    ));
  } catch (e) {
    bridge.dispose();
    throw e;
  }
  bridge.room(code);
  return {
    code,
    local(kind) {
      const [mine, theirs] = linkedChannels();
      bridge.attach(theirs, kind);
      return mine;
    },
    dispose() {
      peer.destroy();
      bridge.dispose();
    },
  };
}
