import { createHost } from "./index.js";
import { bridgeFromMain, type ToWorker } from "../net/worker-bridge.js";

const queued: ToWorker[] = [];
let handle: ((m: ToWorker) => void) | undefined;
self.onmessage = (e: MessageEvent<ToWorker>) =>
  handle ? handle(e.data) : queued.push(e.data);

const host = await createHost({ maxRooms: 1 });
const bridge = bridgeFromMain(
  (channel, kind) => host.accept(channel, kind),
  (m) => self.postMessage(m),
);
handle = (m) => (m.t === "room" ? host.ensureRoom(m.code) : bridge(m));
for (const m of queued.splice(0)) handle(m);
self.postMessage({ t: "ready" });
