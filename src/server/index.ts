import { healthConfig } from "./config.js";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import sirv from "sirv";
import { attachApplication } from "./app.js";
const serve = sirv("dist/client", {
  single: true,
  maxAge: 31536000,
  immutable: true,
});
const handler: http.RequestListener = (req, res) => {
  if (req.url === "/healthz") {
    res.setHeader("content-type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(healthConfig()));
    return;
  }
  res.setHeader("Permissions-Policy", "microphone=(self)");
  serve(req, res);
};
const server =
  process.env.TLS_CERT && process.env.TLS_KEY
    ? https.createServer(
        {
          cert: readFileSync(process.env.TLS_CERT),
          key: readFileSync(process.env.TLS_KEY),
        },
        handler,
      )
    : http.createServer(handler);
const app = await attachApplication(server);
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log(`Friendslop listening on ${process.env.PORT ?? 3000}`),
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    app.dispose();
    server.close(() => process.exit());
    setTimeout(() => process.exit(), 2000).unref();
  });
