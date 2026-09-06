<p align="center">
  <img src="public/favicon.svg" width="96" alt="Friendslop Base logo">
</p>

<h1 align="center">Friendslop Base</h1>

An open-source browser multiplayer starter for 2–8 people. It provides a shared
3D building and yard, authoritative physics, throwable props, bouncy balls,
shove-only guns, sliding doors, and proximity voice. There are no accounts,
objectives, scores, health, or deaths—the game you build supplies those.

The stack is TypeScript, Three.js, Rapier, WebSockets/WebRTC, Vite, and
Playwright. Code and original assets are MIT licensed.

<p align="center">
  <img src="docs/media/lobby.webp" width="49%" alt="Friendslop Base lobby and building overview">
  <img src="docs/media/multiplayer-voice.webp" width="49%" alt="Seven Friendslop players using proximity voice in the common room">
</p>

## Run locally

Requires Node.js 22.20+ and desktop Chrome.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>, create a room, and share its six-character code.
Microphone access is optional. HTTPS is required for voice outside localhost.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Shift / Ctrl or C / Space | Sprint / crouch / jump |
| E / Q | Pick up or drop / throw |
| Click or F | Fire a held gun |
| V / M | Push to talk / mute |
| Escape | Release the mouse |

## How it works

One `Simulation` owns positions, physics, doors, prop ownership, and shots.
Clients send inputs—not positions—and run the same simulation for prediction and
reconciliation. Remote players are interpolated. Voice prefers direct WebRTC
and falls back to relayed Opus frames, with HRTF positioning and room reverb.

The same client supports two deployment modes:

- **Node server:** one process and one public port serve the client, game and
  signaling WebSocket, voice fallback, and `/healthz`.
- **Static/P2P:** the room creator runs the authority in a browser worker;
  PeerJS is used only to establish WebRTC connections.

Rooms exist only in memory and end when the server—or P2P host tab—stops.
There is no database, account service, TURN server, or separate media server.
See [architecture](docs/architecture.md), [voice](docs/voice.md), and
[deployment](docs/deployment.md) for the detailed contracts and tradeoffs.

## Build your own game

Start with these files:

| Change | Main file |
| --- | --- |
| Rooms, spawns, props, doors, weapons, voice range | `src/shared/level.ts` |
| Movement and authoritative physics | `src/shared/simulation.ts` |
| Actions, validation, rooms, signaling | `src/host/index.ts` |
| Input, HUD, prediction and reconciliation | `src/client/main.ts` |
| Three.js scene and avatars | `src/client/rendering/scene.ts` |
| Binary network state | `src/shared/protocol.ts` |

Keep authority on the host: never trust client-supplied positions, ownership,
or hit results. Code under `src/shared`, `src/host`, and `src/net` must remain
usable in both Node and browser-hosted mode. Incompatible protocol changes must
update the encoder, decoder, tests, documentation, and protocol version.

### Work with an AI coding agent

The repository includes [AGENTS.md](AGENTS.md), a tool-neutral operating manual
covering architecture, file ownership, invariants, commands, browser testing,
and known sharp edges. Ask any repository-aware coding agent to read it before
making changes. `CLAUDE.md` provides a small compatibility entry point for
Claude Code; other agents can use `AGENTS.md` directly.

Example request:

> Read AGENTS.md completely. Add [feature]. Preserve server authority, both
> deployment modes, and the one-process/one-port design. Update tests and docs,
> then run every required gate and report anything you could not verify.

Review generated changes like any other contribution. In particular, inspect
network validation, privacy behavior, dependency licenses, and generated assets
rather than treating agent output as trusted.

## Verify and deploy

```sh
npm run typecheck
npm test
npm run test:server
npm run test:browser
npm run build
npm start
```

The browser suite uses installed Chrome and synthetic microphone audio. Static
hosts use `npm run build:client`; the Dockerfile and `render.yaml` build the
single-process Node deployment. More options are in
[docs/deployment.md](docs/deployment.md).

Relayed voice is encrypted in transit with HTTPS/WSS but is readable by the
authority process; it is not application-level end-to-end encrypted. Direct
WebRTC voice is peer encrypted. Operators should disclose this distinction to
players and provide any privacy notice required for their deployment.

## License and third-party software

Friendslop Base code, procedural models, and synthesized audio are available
under the [MIT License](LICENSE). Bundled fonts and Opus components keep their
own permissive licenses and notices. See
[third-party materials](docs/THIRD_PARTY.md) before redistributing a build.
