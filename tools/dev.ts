import http from "node:http";
import { watch } from "node:fs";
import { createServer } from "vite";
import { spawn } from "node:child_process";
const server = http.createServer();
const vite = await createServer({
  server: { middlewareMode: true, hmr: { server } },
  appType: "spa",
});
const { healthConfig } = await vite.ssrLoadModule("/src/server/config.ts");
const port = Number(process.env.PORT ?? 3000);
const brokerPort = Number(process.env.BROKER_PORT ?? 3010);
// The signalling broker is a separate service in production too, so run it as
// one here rather than mounting it on this port: peerjs-server attaches a
// path-filtered WebSocketServer that would abort our own /ws upgrades.
const broker = spawn(
  process.execPath,
  ["--experimental-strip-types", "tools/broker.ts"],
  { stdio: "inherit", env: { ...process.env, BROKER_PORT: String(brokerPort) } },
);
server.on("request", (req, res) => {
  if (req.url === "/healthz") {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ...healthConfig(),
        broker: {
          host: "localhost",
          port: brokerPort,
          path: "/",
          secure: false,
        },
      }),
    );
    return;
  }
  vite.middlewares(req, res);
});
let app = await (
  await vite.ssrLoadModule("/src/server/app.ts")
).attachApplication(server);
let restart: ReturnType<typeof setTimeout>;
let chain = Promise.resolve();
const watcher = watch("src", { recursive: true }, (_event, file) => {
  if (!file || !/^(server|shared|host|net)[/\\]/.test(file)) return;
  clearTimeout(restart);
  restart = setTimeout(() => {
    chain = chain
      .then(async () => {
        app.dispose();
        vite.moduleGraph.invalidateAll();
        app = await (
          await vite.ssrLoadModule("/src/server/app.ts")
        ).attachApplication(server);
        console.log("Server modules restarted; rooms reset.");
      })
      .catch(console.error);
  }, 150);
});
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log(`Friendslop → http://localhost:${process.env.PORT ?? 3000}`),
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    watcher.close();
    broker.kill();
    app.dispose();
    await vite.close();
    server.close();
    process.exit();
  });
