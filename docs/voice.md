# Voice and acoustics

## Capture and decode

Voice starts after an explicit interaction. One getUserMedia stream feeds
native WebRTC tracks and an AudioWorklet capture path. Requested constraints
are mono, echo cancellation, noise suppression and automatic gain control.
The context requests 48 kHz; capture/playback also convert sample cadence when
the device/context chooses another rate. For production-quality music at a
non-48-kHz rate, replace the simple sample-cadence conversion with a bandlimited
resampler. The starter is tuned for speech.

A worker probes Chrome's raw Opus WebCodecs encoder with a 20 ms round-trip
against libopus. If it fails, use the packaged libopus WASM encoder. Both produce
48 kHz mono 960-sample raw packets, target bitrate 24 kbit/s. The decoder uses
WASM consistently, including packet-loss concealment. A first-party custom
WASM build was considered; the implemented version pins libopus-wasm 0.2.0,
which ships a reproducibly built embedded module. No runtime codec downloads.

MediaRecorder is deliberately absent. Its blobs are recording/container chunks,
not independently timed 20 ms packets.

The microphone gate applies to both paths. PTT release, focus loss, pointer-lock
loss and mute clear it. Capture jobs are generation-tagged so queued encoded
output from an old gate is discarded. Warm encoding does not imply relay upload:
packets leave the browser only when at least one pair uses relay or is upgrading.

## Pair lifecycle

The server keeps a canonical unordered pair record, route epoch and direct-ready
acknowledgments. Either endpoint may request relay. Both endpoints must confirm
a direct path before the server commits an upgrade. A route change never affects
other room pairs.

- **DIRECT_CONNECTING**: initial negotiation; fall back after 3 s without a
  healthy connection. STUN only: two public Google STUN discovery endpoints.
- **DIRECT**: native media plus 500 ms liveness/statistics checks.
- **DIRECT_SUSPECT**: disconnected/unhealthy path; 750 ms grace before fallback.
  Explicit `failed` transitions request fallback immediately.
- **RELAY_PREPARING**: start forwarding, prime the PCM buffer and preserve the
  direct gain while active speech arrives. Wait up to 2 s for usable audio.
- **RELAY**: Opus packets play through the same emitter as direct media.
- **DIRECT_PROBING**: relay remains audible during a 5 s ICE retry. Retry delays
  back off from 10 s to 60 s. A destroyed peer connection is reconstructed.
- **UPGRADING**: after 2 s of direct health and both endpoint acknowledgments,
  ramp the source gains and retain a 1 s relay rollback window.
- **UNAVAILABLE**: show a status if relay audio cannot start; incoming PCM can
  restore it. Local microphone/autoplay failures are reported separately.

Diagnostics can force one pair to remain relayed, then allow upgrades again.
The lower player ID initiates negotiation to avoid ordinary offer glare.

A tiny unordered data channel supplies ping/pong while microphones are quiet.
For an active speaker, RTP packet progression must also be current; a data
channel alone cannot prove usable media. The speaking detector uses gated RMS
with a 180 ms hangover. An analyser measures the actual mixed source output for
debugging/tests. This does not constitute a guarantee that a user's physical
speaker device is audible.

## Playback deadlines

The worklet starts at 60 ms buffered PCM, adapts its target within 40–120 ms,
limits queued PCM to 120 ms, and applies small playback-rate corrections for
drift. Sequence gaps up to five packets get Opus concealment. Long gaps reset
decoder/playback state. A slow socket drops fresh send attempts instead of
building an application backlog. This bounds application queues, not TCP delay.

The separate native WebRTC and fallback codec paths have different timing.
Their gain transition is around 40 ms; it can reduce clicks but cannot guarantee
no missing or repeated speech. Under healthy regional networking, plan roughly
60–150 ms direct and 120–250 ms relay mouth-to-ear; these are design targets,
not measured WAN guarantees.

## Spatial graph

Direct MediaStreamAudioSource and relay playback worklet → selection gains →
one persistent emitter → HRTF PannerNode → range gain → dry/master and region
convolution sends. World interaction effects instantiate the same emitter.
One AudioListener follows the camera; source positions follow interpolated
character positions, every rendered frame. The master has a compressor.

Every remote WebRTC MediaStream is also attached to a retained, muted playing
HTML audio element. This is the Chromium WebAudio silence workaround. The
unspatialized element never becomes audible. Cleanup releases streams/elements.

Room/hall impulse responses are original generated stereo WAVs. Shared region
convolvers preserve tails while per-source sends crossfade. Configurable box volumes in `src/shared/acoustics.ts`
blend across their boundary margins; the sample doorway spans two meters. A listener's region chooses the IR; when the
speaker's region differs, reduce the wet send to half. Dry and wet paths share
distance attenuation, with an explicit fade to zero near the audible limit.
This intentionally approximates acoustics; it does not model walls/portals.

## Scale and privacy

An eight-player room has 28 peer connections, seven per browser. At 24 kbit/s,
worst-case fully relayed voice is ~1.344 Mbit/s of relay egress payload and 2800
outgoing media messages/s before overhead. CPU and network limits require real
host/device measurements. Cap rooms; do not infer VPS capacity from this math.

In browser-hosted mode that egress lands on a home upstream rather than a
datacenter link, on top of ~510 kbit/s of snapshot traffic at eight players.
Cable and fibre absorb it; DSL and phone tethering may not.

The transport under the relay changes with the deployment — a `/voice`
WebSocket against a Node authority, an unordered DataChannel to the host in
browser-hosted mode — but the state machine, framing, ticket authentication and
sender-ID stamping above it are identical. Unordered delivery suits a
jitter-buffered Opus stream better than TCP's head-of-line blocking.

WSS encrypts client/server traffic; DataChannels are DTLS-encrypted. Whoever
runs the authority can inspect relayed Opus — a Node server you operate, or
another player's browser in browser-hosted mode. There is no added end-to-end
encryption. Native WebRTC encrypts direct peer media. No audio is persisted by
the application.
