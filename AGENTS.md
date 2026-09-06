# AGENTS.md — working on Friendslop Base

The operating manual for agents and humans changing this repository. It is
self-contained on purpose: `CLAUDE.md` imports it, other tools read it directly.
Keep this file the single source of truth and update it when a contract below
changes.

## 1. What this is

A browser multiplayer starter: a shared building for 2–8 players — common room,
hall, mezzanine, workshop, back room and an outdoor yard behind sliding doors —
with physical props you can pick up and throw, bouncy balls, guns that shove
whoever they hit, and proximity voice that sounds like it comes from the other
player's mouth. Nobody has health and nobody dies. No objectives, scores, roles
or accounts — the game built on top of it decides those.

**One repository, at most one process, one public port.** Deployed on Node,
that port serves the compiled client, `GET /healthz`, the game + WebRTC-signaling
WebSocket at `/ws`, and the Opus fallback voice WebSocket at `/voice`. Deployed
as static files, there is no process of ours at all: the room creator's browser
runs the same authority in a worker and peers reach it over WebRTC, with a
PeerJS broker only for the handshake. There is no database, TURN server, media
server, account system or second dev server. Rooms live in memory and end when
the process — or the host's tab — does.

The client picks a mode at boot by probing `/healthz`; `?net=server` and
`?net=p2p` force one. See §12.

Stack: TypeScript throughout. Three.js and Rapier (WASM) in the browser, Rapier
again on the server, `ws`, Vite for the client, Playwright + real Chrome for
browser tests, Blender's Python API for the original character. Node ≥ 22.20.

## 2. Repository map

```
index.html                    Vite entry; loads src/client/main.ts
src/
  shared/                     Runs on BOTH client and server. No DOM, no three, no Node APIs.
    level.ts                  LEVEL boxes (render + collision), DOORS (sliding leaves),
                              SPAWNS, PROPS (crate/ball/gun) + propKind, PALETTE,
                              STEP = 1/60, MAX_PLAYERS = 8, WEAPON tuning,
                              DOOR_TRAVEL/AUTO_RANGE, VOICE distance model
    acoustics.ts              REVERB_REGIONS (room/hall boxes, IR paths, wet levels), regionWeights()
    protocol.ts               Binary Writer/Reader, encode/decode for inputs, snapshots, voice
                              frames; PlayerState/PropState/Input types; VERSION = 1
    simulation.ts             Rapier world + character motor. THE authority boundary.
                              addPlayer/removePlayer, motor(), step(), restore(), target(),
                              pickup(), release(), shoot(), reach(), doorTarget(),
                              toggleDoor(), setDoor(), doorStates(), syncDoors(),
                              propStates(), syncProps(), eye(), dispose()
  net/                        Isomorphic transport layer. No three, no DOM, no node:*.
    channel.ts                Channel interface (send/close/onmessage/onclose, backpressure),
                              constant-time token compare, id and room-code generators
    mode.ts                   detect(): probes /healthz, returns mode + iceServers + broker
    loopback.ts               linkedChannels(): two Channels wired to each other in memory
    ws-node.ts / ws-client.ts ws socket and browser WebSocket as Channels
    peer.ts                   PeerJS: hostRoom() claims a code, RoomClient opens channels
    worker-bridge.ts          Proxies Channels across postMessage, both sides
  host/
    index.ts                  createHost(): rooms, join/reconnect, 60 Hz tick, 20 Hz snapshots,
                              action validation, signaling relay, pair routing, voice relay,
                              maintenance. THE authority. Transport-agnostic; runs in Node
                              and in a browser worker. Everything stateful lives here.
    worker.ts                 Worker entry: createHost() behind the bridge
  server/
    index.ts                  HTTP(S) listener, static assets via sirv, /healthz, signals
    app.ts                    attachApplication(server): Node adapter only. WebSocketServer
                              -> Channel -> host.accept(). No game logic.
  client/
    main.ts                   UI template (one innerHTML string), input, prediction loop,
                              snapshot reconciliation, remote interpolation, dev handle
    hosting.ts                startHosting(): spawns the host worker, claims a broker code,
                              hands the local player a loopback Channel
    style.css                 All styling; brand tokens in :root (--ink, --green, --cream)
    rendering/scene.ts        GameScene: room geometry, props, avatars, animation mixing,
                              head/jaw/arm bone driving, labels, camera
    audio/voice.ts            Voice: mic gate, peers, WebRTC ↔ relay state machine, loudness()
    audio/spatial.ts          Web Audio graph: emitter → HRTF panner → range gain → dry + reverb sends
    audio/worklet.ts          AudioWorklet capture and jitter-buffered playback
    audio/codec.worker.ts     Opus encode/decode (WebCodecs probe, libopus-wasm fallback)
public/
  favicon.svg                 Brand mark (same paths are inlined in the topbar)
  models/common-worker.glb    Generated character. Never hand-edit; regenerate.
  audio/room.wav, hall.wav    Generated impulse responses
  fonts/                      Self-hosted DM Sans + Space Grotesk
assets-source/
  blender/common-worker.blend Generated Blender source of the character
  README.md                   Rig contract (bones, materials, which bones the runtime owns)
tools/
  dev.ts                      Dev server: Vite middleware + app on one port, in-process restarts
  bots.ts                     Headless protocol clients (load test / second player)
  generate-assets.py          Blender script that builds and exports the character
  generate-ir.py              Synthesises the impulse responses (pure Python)
tests/
  core.test.ts                Protocol round trips, motor, ownership, Opus, acoustics (node:test)
  server/integration.test.ts  Boots attachApplication on port 0: caps, moderator, relay, tickets
  browser/multiplayer.spec.ts Real Chrome: lobby, movement, character, pickup, P2P/relay voice
  production/smoke.spec.ts    Built assets on :3001 (PRODUCTION=1)
docs/                         architecture.md (wire format), voice.md (state machine, latency),
                              deployment.md, THIRD_PARTY.md
Dockerfile, render.yaml       Single-container deploy; TLS optional via TLS_CERT/TLS_KEY
.github/workflows/pages.yml  Static/P2P client deploy to GitHub Pages
```

## 3. How it works (the model to keep in your head)

**Authority.** One `Simulation` owns truth: positions, velocities, who holds
what. Clients send *inputs*, never positions. The same `Simulation` class runs
in each browser as a prediction world (`new Simulation(true)`).

Where the authority *runs* is a deployment property, not a code path. `createHost`
in `src/host/index.ts` speaks only the `Channel` interface, so it runs in Node
behind `ws` or in a browser worker behind WebRTC DataChannels. A browser host is
also a player: it joins its own authority through `linkedChannels()` and keeps
the full prediction and reconciliation path, so there is exactly one client
code path and the host is not a special case.

**Clocks.** Server ticks physics at 60 Hz (`STEP`), consuming at most one input
per player per tick. Clients batch two inputs every 1/30 s. Snapshots go out at
20 Hz (`tick % 3 === 0`); a full keyframe every 2 s, deltas against the
client's acknowledged baseline otherwise. A client that has lost its baseline
sends `0` and gets a full one.

**Prediction.** The client keeps unacknowledged inputs, applies each snapshot by
`restore()`-ing its own state then replaying the unacked inputs, and blends the
resulting camera correction. Remote players render from a 100 ms interpolation
buffer (position, yaw, pitch). Props are dynamic Rapier bodies on the server and
kinematic proxies on the client, except the one you hold, which is predicted.

**Rooms.** Six-character codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Player
ids start at 1, never reused within a room, error past 65000. A dropped socket
neutralises inputs, drops the held prop, and reserves the slot for 30 s under a
reconnect token; an empty room is disposed after 30 s. `MAX_ROOMS` (default 16)
caps room creation. Client-side preview avatars use ids ≥ 60000 — that range
is never a real player.

**Actions.** `pickup` / `drop` / `throw` / `shoot` / `door` are JSON messages with
a client request id (deduplicated server-side). `pickup` succeeds only if
`Simulation.target()` — a 2.8 m ray from the player's eye along their look
direction — hits exactly that object and nobody owns it. Aim matters: floor
props need pitch downward.

**Props have kinds.** `PROPS` in `level.ts` pairs each start position with
`crate`, `ball` or `gun`; the id is still the index + 1. The kind picks the
collider (a ball is a bouncy sphere with `CoefficientCombineRule.Max`), the mesh,
and how it is carried. Kinds are static and never travel on the wire.

**Shooting.** A gun fires with left click or `F`, on a `WEAPON.cooldown` tick
timer the server owns. The authority casts the ray, and a hit adds
`WEAPON.knock`/`WEAPON.lift` to the victim's velocity plus `WEAPON.stagger` ticks
of lost footing, which is a networked `PlayerState` field so the client's replay
agrees. There is no health, no death and no respawn: you get pushed. The
accepted shot is broadcast for tracers and sound; the shooter draws its own
tracer immediately and ignores the echo.

**Doors.** `DOORS` in `level.ts` lists sliding leaves that live in the physics
world as kinematic bodies. Hand-worked leaves toggle with `E` when the crosshair
is on them; leaves marked `auto` open for anyone within `AUTO_RANGE`. Both sides
animate over `DOOR_TRAVEL` seconds. The authority is the source of truth and
broadcasts every change; a client ORs that with its own proximity so an
automatic leaf never flickers.

**Voice.** Two transports through one spatial emitter per peer: native WebRTC
(STUN only, lower id offers) and a server relay of raw 20 ms Opus frames over
`/voice`. A per-pair state machine (see `docs/voice.md`) falls back to relay
after 3 s, probes direct again with backoff, and upgrades only when both ends
confirm. The voice socket authenticates with a per-connection ticket issued
over `/ws`. The server stamps the sender id on every relayed frame.

**Avatars.** One GLB, cloned per player with `SkeletonUtils.clone`; the material
named `Jacket / tintable` is recoloured from `PALETTE[(id-1) % 8]`. Clips
`Idle/Walk/Sprint/Crouch/Jump` are chosen from flags and speed. Four bones are
aimed by the runtime rather than by clips: `head` from networked look pitch,
`jaw` from voice loudness (mouth opens like a lid), `armL`/`armR` when `held`.
Section 7 explains exactly how, because it is easy to get wrong.

Wire tables, byte layouts and limits: `docs/architecture.md`. Do not restate
them here; change them there when you change `protocol.ts`.

## 4. Commands

```sh
npm install
npm run dev                          # http://localhost:3000 — one port, client HMR
npm run typecheck                    # tsc --noEmit over src, tools, tests, configs
npm test                             # tests/*.test.ts        (protocol, physics, Opus, acoustics)
npm run test:server                  # tests/server/*.test.ts (rooms, auth, routing)
npm run test:browser                 # Playwright, installed Chrome, synthetic microphone
npm run build && npm start           # production: dist/client + dist/server, PORT (3000)
npm run build:client                 # static deploys: dist/client only, no server compile
PRODUCTION=1 npm run test:browser    # smoke-test the build on :3001
npm run bots                         # 8 headless clients for 30 s (ROOM_CODE, BOTS, SECONDS, SERVER_URL)
npm run broker                       # PeerJS signalling broker on :3010 (BROKER_PORT); npm run dev starts one already
npm run assets                       # python3 tools/generate-ir.py && blender ... generate-assets.py
```

Only `blender` is not an npm dependency. `npm run assets` expects it on `PATH`;
on macOS call `/Applications/Blender.app/Contents/MacOS/Blender --background
--factory-startup --python tools/generate-assets.py` directly. Blender 5.2 is
the tested version (`BLENDER_EEVEE`, not `BLENDER_EEVEE_NEXT`).

There is no linter or formatter config. `npm run typecheck` is the gate; code
is prettier-default shaped (2 spaces, double quotes, semicolons, trailing
commas, ~80 columns). The Python tools are intentionally dense — match the file
you are in.

## 5. The fast loop: connect, change, see it

1. **Is a server already up?** `curl -s localhost:3000/healthz` → `{"ok":true}`
   means someone (often the user) is running `npm run dev`. Use it; do not start
   a second one on another port unless you need isolation.
2. **Edit.** Client files (`src/client/**`, `style.css`) hot-reload in place.
   Editing `src/server/**` or `src/shared/**` restarts the application systems
   inside the same process and **resets every room** — everyone gets kicked to
   the lobby and must rejoin. Expect this; it is not a crash.
3. **Get in.** Open `http://localhost:3000/?test=1&name=Dev`, click *Create a
   room*, read the code from `#room-code`. Query switches:
   `?room=CODE` prefills the code, `?name=` the name, `?fresh=1` forgets the
   saved reconnect token, `?wasm=1` forces the WASM Opus encoder, `?test=1`
   (DEV builds only) lets key events reach the input set without pointer lock.
4. **Drive it.** After `welcome`, DEV builds expose `window.__friendslop`:

   ```ts
   state      // your predicted PlayerState (x, y, z, yaw, pitch, flags, held, …)
   members    // [{ id, name, connected, voiceReady }]
   scene      // GameScene — avatars Map, props Map, camera, renderer
   sim        // your prediction Simulation
   voice      // Voice — peers Map, status, codec, loudness(id), force(id, relay)
   input(code, down)   // e.g. input("KeyW", true) — bypasses pointer lock
   look(yaw, pitch)    // set the camera/look angles directly
   action(throwing?)   // pick up / drop / throw whatever target() hits
   join(code), send(json)
   ```

   Useful reads: `scene.avatars.get(id).root.position`, `.mouth`, `.current`
   (clip name), `.head.bone.matrixWorld`. Look direction math: forward is
   `(-sin yaw · cos pitch, -sin pitch, -cos yaw · cos pitch)`; to face a point,
   `yaw = atan2(-(dx), -(dz))`, positive pitch looks **down**.
5. **Get a second player.** Never rely on a second browser tab you are not
   looking at: background tabs throttle `requestAnimationFrame`, so that
   player's inputs stall and remote avatars appear frozen or never appear. Use
   a headless client instead — section 8.
6. **Gate before you claim done.**
   `npm run typecheck && npm test && npm run test:server && npm run test:browser`.
   The browser suite reuses a running `:3000` server and needs installed Chrome.
   Report failures verbatim; do not paraphrase them away.

## 6. Where a change goes

| You want to… | Touch | Notes |
| --- | --- | --- |
| Change the room's geometry | `src/shared/level.ts` `LEVEL` | Boxes are both mesh and collider. Metres, Y up. Decorative extras live in `GameScene` constructor. |
| Move spawns / props | `SPAWNS`, `PROPS` in `level.ts` | Eight spawns; prop ids are index + 1. Give a prop a kind: `crate`, `ball` or `gun`. |
| Add a prop kind | `PROPS`/`PropKind` in `level.ts`, `shape()` in `simulation.ts`, `makeProp()` in `scene.ts` | Keep children[0] of the mesh group the tintable body — `setHighlight` writes its emissive. |
| Add or move a door | `DOORS` in `level.ts` | Leaves slide from `p` to `p + slide`; mount them in front of the wall they cover. `auto` makes them open on approach. |
| Tune the guns | `WEAPON` in `level.ts` | Range, cooldown, shove, lift, recoil, stagger length and how much steering a staggered player keeps. |
| Tune movement | `Simulation.motor()` | Runs identically on both sides. Gravity is set in the Rapier world **and** the motor's vertical acceleration — change both. |
| Add a player action | `app.ts` `msg.type === "action"` → validate with server state → mutate `Simulation`; client trigger in `main.ts`; visual in `scene.ts` | Clients never decide ownership or authoritative position. Dedupe by `request`. |
| Add replicated state | `protocol.ts` writer **and** reader, `PlayerState`/`PropState`, tests in `core.test.ts`, tables in `docs/architecture.md` | Bump `VERSION` for incompatible layouts. Keep membership/control out of the tick. Respect the fixed record sizes and ±327.67 m prop range. |
| Change how remote players look or animate | `scene.ts` `avatar()`, `updatePlayer()`, `render()` | Runtime-owned bones: section 7. |
| Change the character mesh or rig | `tools/generate-assets.py` → regenerate → commit `.glb` **and** `.blend` | Keep the clip names, `Jacket / tintable`, and the bone names, or update `scene.ts` with them. |
| Change voice range / acoustics | `VOICE` in `level.ts`; `REVERB_REGIONS` in `acoustics.ts`; graph in `spatial.ts`; IRs via `tools/generate-ir.py` | Regions are axis-aligned boxes that blend across `blendWidth`. |
| Change voice transport behaviour | `voice.ts` state machine, `app.ts` `pair()/route()/route-request` | Both endpoints must confirm before an upgrade. Read `docs/voice.md` first. |
| Change UI copy, HUD, drawers | The template string at the top of `main.ts`; `style.css` | Ids like `#room-code`, `#hud`, `#loading`, button names are used by the Playwright tests — keep them or update the tests. |
| Change branding | `public/favicon.svg`, the inline SVG in the `.brand` button, `.brand-*` rules | The mark's paths are duplicated deliberately (favicon vs inline); change both. |

## 7. Avatar bone contract (read before touching `scene.ts` or the Blender script)

Rig: `hips → spine → head → jaw`, `spine → armL/armR`, `hips → legL/legR`.
Rigid weights, one bone per vertex. The head is a sphere bisected at the mouth
line: `Jawbowl` (lower, on `head`) and `Cranium` (upper, on `jaw`, hinged at the
back of the skull so it lifts like a lid). Cap and eyes ride `jaw`.

Coordinate facts: Blender is Z-up and the model faces −Y; glTF/three is Y-up and
the model faces +Z. The avatar root gets `rotation.y = yaw + π`, sits at
`s.y − 0.85` (−0.5 crouched, with `scale.y = 0.63`), the camera at `s.y + 0.65`,
the name label at `+1.95`.

Rules the code depends on:

- **Bone names contain no `.`.** The glTF exporter strips dots (`arm.L` became
  `armL`), which silently broke `getObjectByName("arm.L")` for a long time.
- **`head` and `jaw` are never keyframed** in the Blender actions. The exporter
  still bakes constant tracks for them, which is why the next rule exists.
- **Never assign `bone.rotation.x` to aim a bone.** The rest quaternions are not
  identity; a Euler write composes against a stale decomposition and swings the
  limb the wrong way. Use `hinge()` — a quaternion multiply about the bone's
  local X.
- **Never compound an offset onto the live quaternion.** Three.js
  `PropertyMixer` skips writing a track whose value did not change since the
  last frame, so a bone you aimed will *not* be reset by the mixer. `repose()`
  puts each driven bone's last mixer pose back, runs `mixer.update()`, then
  records the new pose; every offset is rebuilt from that recorded pose.
  Symptom of breaking this: heads and arms rotate endlessly.
- The client never plays the `Hold` clip; the held pose is the runtime hinge on
  the arms (`HOLD_LIFT = -1.1` rad ≈ arms forward). Head tilt is `pitch × 0.55`
  clamped to ±1.2 rad of pitch; mouth is `0..1 × 0.5` rad.
- In `generate-assets.py`, bmesh operators work in **object-local** space
  (`plane_co = JAW_LINE − HEAD[2]`, not the world height).

Regenerate with the Blender command in section 4, then check the result in
Blender renders or in-game before committing. `.blend1` backups are ignored.

## 8. A controllable second player

Fastest, zero code: `ROOM_CODE=<code> BOTS=1 SECONDS=600 npm run bots` joins a
bot that walks in a slow circle. It never talks or picks things up.

For pitch, speaking and actions, write a throwaway script on this pattern,
which is what `tools/bots.ts` does. Keep it outside the repo and run it as
`NODE_PATH=$PWD/node_modules npx tsx /path/to/bot.ts` so `ws` still resolves;
import `protocol.ts` by absolute path.

```ts
import { WebSocket } from "ws";
import { encodeInputs } from "/abs/path/to/friendslop-base/src/shared/protocol.ts";
const ws = new WebSocket("ws://localhost:3000/ws");               // leave binaryType alone:
let seq = 0, baseline = 0;                                        // raw arrives as a Buffer
ws.on("open", () => ws.send(JSON.stringify({ type: "join", name: "Bot", code: "ABC234" })));
ws.on("message", (raw, binary) => {
  if (binary) return;                                             // snapshots; decodeSnapshot(Uint8Array.from(raw).buffer) if needed
  const m = JSON.parse(raw.toString());
  if (m.type !== "welcome") return;
  setInterval(() => {                                             // two inputs every 1/30 s, like the client
    const inputs = [1, 2].map(() => ({ seq: ++seq, x: 0, z: 0, yaw: 0, pitch: -1.0, buttons: 0 }));
    ws.send(encodeInputs(inputs, baseline));
  }, 1000 / 30);
  ws.send(JSON.stringify({ type: "speaking", active: true }));    // drives the mouth-babble fallback
  // ws.send(JSON.stringify({ type: "action", request: 1, action: "pickup", object: 4 }));
});
```

`x`/`z` in `[-1, 1]` are strafe/forward relative to `yaw`; `buttons` is
`JUMP=1 | SPRINT=2 | CROUCH=4`. A pickup is only accepted when the eye ray hits
the object — compute yaw and pitch toward the prop's actual position, which you
can read from a browser client's `scene.props.get(id).position`.

Without a WebRTC peer, `Voice.loudness(id)` returns −1 and the avatar falls
back to procedural babble while the `speaking` flag is on; with a real peer the
mouth follows measured RMS. Playwright's fake microphone (`tests/voice-fixture.wav`)
exercises the real path.

## 9. Rules that are not negotiable

- Server authority: no client-sent position, ownership, or peer id is trusted.
  The server stamps voice frame sources and validates every action. Shots are
  decided by the authority's ray, not by a client claiming a hit, and a door
  only moves for a player actually looking at it.
- Nobody dies. A hit is a shove and a stagger; players are never removed,
  respawned or scored by this layer.
- `src/shared` stays isomorphic. `src/client` never imports `src/server`;
  `src/server` never imports three or Web Audio.
- Physics never travels as JSON. Bounded everything: input queues (12), inputs
  per packet (8), voice frame size (1500 B), send buffers, action dedupe history.
- At most one process of ours, one port. Do not add a second server, a
  database, a TURN server, or assume multiple replicas can share rooms. The
  PeerJS broker is a handshake rendezvous, not somewhere state may live.
- Protocol changes update writer, reader, tests and `docs/architecture.md`
  together, and bump `VERSION` when incompatible.
- Generated artefacts (`.glb`, `.blend`, `.wav`) are committed **with** the
  script change that produced them.
- Playwright selectors are part of the UI contract (`#loading`, `#hud`,
  `#room-code`, `#player-count`, `#peer-debug`, button names *Create a room*,
  *Join →*, *Enable voice*, *Diagnostics*, *Force relay*, *Allow P2P*).

## 10. Known sharp edges

- Background browser tabs throttle rAF (section 5). Symptom: a remote avatar
  never appears or is frozen. It is the tab, not the server.
- **A browser host in a background tab is the biggest unknown in p2p mode.** The
  authority runs in a worker specifically so a hidden tab keeps ticking, and the
  accumulator caps catch-up at 5 steps so a stall is a hitch rather than a
  spiral. This has *not* been measured: the throttling spike was cancelled. If
  a p2p room freezes when the host switches tabs, that is the first suspect.
  Playwright cannot catch it — the config passes
  `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`.
- Two `npm run dev` processes at once will make the browser suite fail in
  confusing, avatar-shaped ways. Check `pgrep -f tools/dev.ts` before believing
  a failure. Playwright's `reuseExistingServer` does not clean up orphans.
- peerjs maps `reliable: false` onto `ordered: false` only; the DataChannel still
  retransmits. There is no way through peerjs 1.5 to get `maxRetransmits: 0`.
- Editing `src/server` or `src/shared` under a running dev server resets rooms
  mid-test. Rejoin; don't debug the "disconnect".
- After `welcome`, remote avatars only appear once a snapshot containing them
  is interpolated; give it a second before concluding something is broken.
- `WebGLRenderer.render` is an own property in three r180. Deleting or
  reassigning it during manual poking kills the frame loop silently — the last
  frame stays on screen and everything looks frozen. Read state through
  `__friendslop`; don't monkey-patch the renderer.
- `Simulation.pickup()` fails when the eye ray misses even by a little. Props
  rest at `y ≈ 0.3`, not their spawn `0.5`.
- Vite's preview of `file://` pages cannot be scripted from some agent browsers;
  serve scratch HTML over HTTP if you need to inspect it.
- `voice.monitor()` runs every 500 ms; `Voice.loudness()` is the per-frame
  path. Don't add per-frame work to `monitor()`.
- `initPhysics()` must resolve before `new Simulation()` on either side.

## 11. Deploying

`npm run build` → `dist/client` + `dist/server`; `npm start` runs
`node dist/server/server/index.js` on `PORT`. The Dockerfile is a two-stage
build with a health check on `/healthz`; `render.yaml` is a one-service
blueprint. TLS can terminate in Node with `TLS_CERT`/`TLS_KEY`. Remote voice
needs HTTPS (LAN HTTP does not get the microphone exception). Deploys reset
rooms; there is no cross-instance room routing. Details: `docs/deployment.md`.
The GitHub Pages workflow publishes `dist/client` in browser-hosted P2P mode and
uses GitHub's reported base path so repository subpaths work.

## 12. The two deployment modes

The same client bundle runs both. `detect()` in `src/net/mode.ts` probes
`/healthz` at boot: JSON with `ok: true` means a Node authority is present,
anything else (404, or a CDN's SPA fallback serving `index.html`) means browser
hosting. `?net=server` and `?net=p2p` force a mode, which is how both are
exercised against one `npm run dev`.

| | server mode | p2p mode |
| --- | --- | --- |
| Authority | Node, `src/server/app.ts` adapter | host's browser, `src/host/worker.ts` |
| Game transport | WebSocket `/ws` | PeerJS DataChannel, reliable ordered |
| Voice relay transport | WebSocket `/voice` | PeerJS DataChannel, unordered |
| Peer↔peer voice | unchanged — WebRTC mesh, signalling relayed by the authority |
| Room code | authority generates | claimed with the broker, then `ensureRoom()` |
| Who can join | everyone | direct-connectable peers, plus TURN if configured |

`iceServers` and `broker` come from `/healthz` in server mode and from
`public/config.json` in p2p mode, both falling back to Google STUN and the
public PeerJS broker.

Rules that are easy to break here:

- **The host is not a special case.** It joins its own authority over
  `linkedChannels()` and keeps prediction and reconciliation. Do not shortcut it
  to read the authoritative `Simulation` directly; that creates bugs only the
  host can reproduce.
- **`src/host` and `src/net` must stay free of `node:*`, `ws`, three and the
  DOM.** `src/net/ws-node.ts`, `ws-client.ts` and `peer.ts` are the adapters
  where those are allowed. `tools/dev.ts` watches `host` and `net` as well as
  `server` and `shared`, so editing any of them resets rooms.
- **Backpressure crosses the worker boundary on a timer.** The worker cannot see
  a DataChannel's queue, so `worker-bridge.ts` posts `bufferedAmount` every
  100 ms. A host that starts dropping snapshots under load is looking at values
  up to 100 ms stale.
- **Never `close({ flush: true })` a peerjs connection.** In `raw` serialization
  the close marker is an object the DataChannel cannot send.
