# Architecture and wire format

## Runtime boundaries

The authority is `createHost()` in `src/host/index.ts`. It speaks only the
`Channel` interface — send, close, message, close-notification, backpressure —
so the same code serves both deployments.

Deployed on Node, one HTTP(S) listener serves compiled client assets,
`/healthz`, game and signaling WebSocket `/ws`, and encoded voice WebSocket
`/voice`. Vite middleware replaces static serving in development.

Deployed as static files, the room creator's browser runs `createHost()` in a
dedicated worker; joining players reach it over WebRTC DataChannels brokered by
PeerJS, one channel per kind. WebRTC is unavailable inside a worker, so every
peer connection is held on the main thread and proxied across `postMessage` by
`src/net/worker-bridge.ts`, which also feeds real `bufferedAmount` back so the
host's backpressure checks still mean something. The host joins itself over
`linkedChannels()` rather than reading the authority directly.

The client chooses at boot by probing `/healthz`, overridable with `?net=`.

Each room owns a Rapier world. At 60 Hz the server consumes at most one fixed
input step per player, applies the shared motor, clamps held-object anchors,
and steps physics. At 20 Hz it emits snapshots. A bounded accumulator avoids a
spiral of catch-up work after an event-loop stall. Hidden or disconnected
clients stop moving after 250 ms without fresh input.

A client keeps unacknowledged inputs and a prediction world with kinematic
prop proxies. On a snapshot, it resets its capsule and motor state to the
server's full-precision state, updates prop proxies, and replays unacknowledged
inputs. The render camera blends small corrections. Remote entities use a
100 ms interpolation buffer and hold the latest state when the buffer runs out.
There is currently no remote extrapolation. Player capsules do not block one
another. Dynamic prop contacts are authoritative and may cause corrections.

## Protocol v2

All numeric binary fields are little-endian. A WebSocket message is a complete
application packet, so no outer length framing is required. Physics never
travels as JSON. Low-frequency lobby, signaling, route control and action
messages use bounded JSON for inspectability.

### Inputs (type 1)

| Field                                         | Bytes |
| --------------------------------------------- | ----: |
| Version = 2, type = 1, input count (max 8)    |     3 |
| Acknowledged baseline tick                    |     4 |
| Repeated: sequence u32                        |     4 |
| Movement x/z: signed i16 normalized to [-1,1] |     4 |
| Yaw/pitch: f32 radians                        |     8 |
| Jump/sprint/crouch bitfield                   |     1 |

Two inputs normally travel every 1/30 s. The server caps queued inputs and
rejects non-finite numbers, invalid lengths, duplicate steps and implausibly
far-ahead sequence numbers. The fixed server clock determines movement speed.

### Snapshots (type 2)

Header: version u8, type u8, full flag u8, server tick u32, baseline tick u32,
player count u8, changed-prop count u16.

Each player record is 38 bytes: ID u16, position 3×f32, velocity 3×f32,
yaw/pitch 2×i16 scaled by π/32767, state flags u8, held-item ID u16, stagger
u8, acknowledged input sequence u32. Flags encode grounded, crouched,
sprinting, and prior jump-button state for edge-triggered jumps. Stagger counts
the ticks of lost footing left after being shot; while it runs the motor keeps
only `WEAPON.control` of the player's own steering, so the client replays a
shove the same way the server applied it. Version 2 added that byte.

Each prop record is 18 bytes: ID u16, position 3×i16 in centimeters,
quaternion 4×i16 scaled by 32767, owner u16 (0 = free). Normalize reconstructed
quaternions. The room must fit ±327.67 m on each axis. IDs are not reused within
a room lifetime.

All players appear in every snapshot; prop records are sparse. This deliberately
keeps full-precision local reconciliation simple at the eight-player limit.
There are no variable per-field masks or smallest-three quaternions in v2.

Full baselines are sent on join, every two seconds and when resynchronization
is required. Each delta includes every prop that differs from the acknowledged
baseline, not the immediately previous snapshot. Applying delta B to baseline A
therefore does not require receiving an earlier delta. Clients retain a small
baseline history. A missing baseline requests resynchronization by sending 0
in the next input batch. Full player arrays carry player removals; the fixed
sample prop set does not currently spawn/despawn during a room. A prop's kind —
crate, ball, gun, bat or horn — is static, read from `PROPS` by ID on both sides, and never
travels on the wire.

### Actions, shots and doors (JSON)

`{type:"action", request, action}` covers `pickup`, `drop`, `throw`, `shoot`,
`swing`, `honk` and `door`, deduplicated by `request`. The reply is
`{type:"action-result", request, action, accepted}`.

`shoot` requires the held prop to be a gun and a cooldown of `WEAPON.cooldown`
ticks; the server casts the ray from the shooter's eye, and a hit adds velocity
and stagger to the victim. Nobody has health and nobody is removed. Every
accepted shot is broadcast as `{type:"shot", id, object, x, y, z, dx, dy, dz,
distance, hit}` — the muzzle origin, direction and length the clients draw the tracer from, with
`hit` the player ID struck or 0. A shooter draws its own tracer on the trigger
press and ignores the echo of its own shot.

`swing` requires a held bat and uses an authority-owned swept sphere over the
short `MELEE.range`; a struck player gets the same kind of shove and stagger as
a gun hit. `{type:"swing", id, object, hit}` drives the visible swing and impact
effects. `honk` requires a held horn and is authority-rate-limited by
`HORN.cooldown`; accepted uses are broadcast as spatial `sound` events.

`door` toggles one hand-worked leaf and is accepted only when that leaf is under
the player's crosshair. Automatic leaves open for anyone within `AUTO_RANGE`,
which both the authority and each client's prediction world compute in
`Simulation.step()`. Every change is broadcast as `{type:"door", id, open}`, and
the join `welcome` carries the full door state. A client applies the broadcast
as the authoritative value and may additionally hold an automatic leaf open for
its own player, so a leaf never flickers between the two sources.

### Voice packets (type 3)

| Field                                   |    Bytes |
| --------------------------------------- | -------: |
| Version, type                           |        2 |
| Source player ID, overwritten by server |        2 |
| Capture stream epoch u32                |        4 |
| Packet sequence u32                     |        4 |
| Capture timestamp in 48 kHz samples u32 |        4 |
| Opus payload length u16                 |        2 |
| Raw mono 20 ms Opus packet              | Variable |

Frames are capped at 1500 bytes. A sender uploads once; the server forwards to
peers selected by its pair-route table. Recipients never accept a sender ID
chosen by the originating client. The voice socket authenticates with a random
per-connection ticket issued over the game socket, not a token in the URL.

## Reliability and lifecycle

In server mode both sockets are reliable ordered TCP. In browser-hosted mode
the game channel is a reliable ordered DataChannel and the voice channel is
unordered; peerjs exposes `ordered` but not `maxRetransmits`, so neither is a
true datagram even though the protocol tolerates loss (baseline acks and input
sequence numbers). Inputs, snapshots and voice do not become unreliable by
using binary encoding. Backpressure can prevent sending a new
snapshot, and voice frames can be dropped before sending or expired on playback;
bytes already in the socket cannot be withdrawn. Separate sockets prevent a
large game queue from directly ordering voice behind it, but share the same
underlying network bottleneck.

Room codes locate rooms; random reconnect tokens establish player continuity.
A dead socket neutralizes inputs, drops held objects and reserves the slot for
30 seconds. Lobby moderation passes to a connected member. Rejoining rotates
the voice ticket and reinitializes the client world. A process restart loses
all rooms. In browser-hosted mode the room ends when the host's tab does: there
is no physics-host migration, and reconnect tokens live only in the host's
memory, so a host reload invalidates every token in that room.

WebSocket origins are checked against the request host. Payload sizes, input
queues, action deduplication history and outgoing media buffers are bounded.
Membership is checked before relaying signaling or audio. This is a starter,
not a hardened public matchmaking/abuse-management platform.
