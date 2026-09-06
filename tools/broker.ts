import { PeerServer } from "peer";
/**
 * A local PeerJS broker for development and the p2p tests. In production this
 * is somebody else's service (the public cloud, or one you point config.json
 * at) — it never holds game state, only the handshake.
 */
const port = Number(process.env.BROKER_PORT ?? 3010);
PeerServer({ port, path: "/" }, () =>
  console.log(`Broker → http://localhost:${port}`),
);
