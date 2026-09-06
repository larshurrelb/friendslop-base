import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { createHost } from "../host/index.js";
import { nodeChannel } from "../net/ws-node.js";
export async function attachApplication(server: Server) {
  const host = await createHost({ maxRooms: Number(process.env.MAX_ROOMS ?? 16) });
  const game = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
  const voice = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const upgrades = (req: any, socket: any, head: any) => {
    const path = req.url?.split("?")[0];
    if (path !== "/ws" && path !== "/voice") return;
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }
    const wss = path === "/ws" ? game : voice;
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  };
  server.on("upgrade", upgrades);

  for (const [wss, kind] of [[game, "game"], [voice, "voice"]] as const) {
    wss.on("connection", (ws) => {
      host.accept(nodeChannel(ws), kind);
      let alive = true;
      ws.on("pong", () => { alive = true; });
      const heartbeat = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        ws.ping();
      }, 5000);
      ws.on("close", () => clearInterval(heartbeat));
    });
  }
  return {
    rooms: host.rooms,
    dispose() {
      server.off("upgrade", upgrades);
      host.dispose();
      game.close();
      voice.close();
    },
  };
}
