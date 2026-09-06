/** Headless protocol clients for a small, real-network room load check. */
import { WebSocket } from "ws";
import { encodeInputs, decodeSnapshot } from "../src/shared/protocol.js";
const url = process.env.SERVER_URL ?? "ws://localhost:3000/ws";
const count = Math.min(8, Math.max(1, Number(process.env.BOTS ?? 8))),
  seconds = Number(process.env.SECONDS ?? 30);
let code = process.env.ROOM_CODE ?? "";
const clients: {
  ws: WebSocket;
  seq: number;
  baseline: number;
  rx: number;
  tick: number;
  startTick: number;
  timer?: ReturnType<typeof setInterval>;
}[] = [];
for (let n = 0; n < count; n++) {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url),
      client = {
        ws,
        seq: 0,
        baseline: 0,
        rx: 0,
        tick: 0,
        startTick: 0,
        timer: undefined as ReturnType<typeof setInterval> | undefined,
      };
    clients.push(client);
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "join", name: `Bot ${n + 1}`, code })),
    );
    ws.on("message", (raw, binary) => {
      if (!binary) {
        const m = JSON.parse(raw.toString());
        if (m.type === "error") reject(Error(m.message));
        if (m.type === "welcome") {
          code = m.code;
          client.timer = setInterval(() => {
            const inputs = Array.from({ length: 2 }, () => ({
              seq: ++client.seq,
              x: 0,
              z: 1,
              yaw: client.seq / 160 + n * 0.7,
              pitch: 0,
              buttons: 0,
            }));
            if (ws.readyState === WebSocket.OPEN)
              ws.send(encodeInputs(inputs, client.baseline));
          }, 1000 / 30);
          resolve();
        }
        return;
      }
      const s = decodeSnapshot(Uint8Array.from(raw as Buffer).buffer);
      if (s.full) client.baseline = s.baseline;
      client.startTick ||= s.tick;
      client.tick = s.tick;
      client.rx++;
    });
    ws.on("error", reject);
  });
}
console.log(`${count} bots joined ${code}; running ${seconds}s.`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
console.log(
  JSON.stringify(
    {
      room: code,
      clients: clients.length,
      snapshots: clients.map((c) => c.rx),
      ticks: clients.map((c) => c.tick - c.startTick),
    },
    null,
    2,
  ),
);
for (const c of clients) {
  clearInterval(c.timer);
  c.ws.send(JSON.stringify({ type: "leave" }));
  c.ws.close();
}
