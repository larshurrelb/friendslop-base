import { detect, type NetworkConfig } from "../net/mode";
import type { Channel } from "../net/channel";
import { openSocket } from "../net/ws-client";
import { RoomClient } from "../net/peer";
import { startHosting, type Hosting } from "./hosting";
import "./style.css";
import { MovementSounds } from "./audio/movement";
import * as THREE from "three";
import { initPhysics, Simulation, type Character } from "../shared/simulation";
import { STEP, PALETTE, WEAPON, DOORS, propKind } from "../shared/level";
import {
  BUTTON,
  decodeSnapshot,
  encodeInputs,
  type Input,
  type Snapshot,
  type PropState,
} from "../shared/protocol";
import { GameScene } from "./rendering/scene";
import { Voice } from "./audio/voice";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
$("app").innerHTML = `<div id="world"></div><div id="shade" class="shade"></div>
<header class="topbar"><button id="about-button" class="brand" aria-label="About Friendslop Base"><span class="brand-mark"><svg viewBox="0 0 192 192" aria-hidden="true"><rect x="17" y="17" width="158" height="158" rx="46" fill="#26382d" transform="rotate(-11 96 96)"/><g fill="#d5ec99"><path d="M53.5 34.5L65.95 54.43A23.5 23.5 0 1 1 76.87 36.96Z"/><path d="M4 114a49.5 49.5 0 0 1 99 0Z"/><path d="M140 87.5L126.02 66.77A25 25 0 1 1 115 87.5Z"/><path d="M89 170a50.5 50.5 0 0 1 101 0Z"/></g></svg></span><span class="brand-word">friendslop <b>base</b></span><small></small></button><div id="top-actions" class="top-actions"><span id="net-mode" class="pill net-mode" hidden><i class="dot"></i> <span id="net-mode-text"></span></span><button id="help-button" class="icon-button" aria-label="Controls and help">?</button></div></header>
<main id="lobby" class="lobby"><div class="eyebrow">A space for your people</div><h1>The starting point<br>for <em>Friendslop.</em></h1><p class="intro">An open-source Friendslop template.<br>Built with Three.js, Rapier physics, and spatial voice.</p><a class="github-button" href="https://github.com/larshurrelb/friendslop-base" target="_blank" rel="noopener noreferrer" aria-label="Get Friendslop Base on GitHub">Get it on GitHub <span class="github-arrow" aria-hidden="true">↗</span></a><form id="entry" class="entry-card"><label for="name">WHAT SHOULD WE CALL YOU?</label><div class="name-input"><div class="avatar-chip">✳</div><input id="name" aria-label="Your name" autocomplete="nickname" maxlength="20" placeholder="Your name" required value="Guest"></div><button class="primary" id="create" type="submit">Create a room <span>↗</span></button><div class="separator">or find your friends</div><div class="join-row"><input id="join-code" aria-label="Room code" placeholder="ROOM CODE" maxlength="6" autocomplete="off"><button id="join" type="button">Join →</button></div><div class="entry-note">No accounts. Just a room code.</div><p id="entry-error" class="error" hidden></p></form><div class="lobby-foot"><span>Up to 8 friends</span><span>Proximity voice</span><span>Yours to build on</span></div><p class="mobile-notice">A keyboard and mouse are required to play.</p></main>
<div id="scene-caption" class="scene-caption"><b>Your next idea starts in here.</b><small>01 / THE COMMON ROOM</small></div>
<footer id="footer" class="footer"><span>A small beginning for a very good time.</span><span class="version">FRIENDSLOP BASE &nbsp; / &nbsp; v0.1</span></footer>
<div id="hud" class="hud" hidden><div class="room-bar"><div><small>YOUR ROOM</small><span id="room-code" class="room-code">------</span></div><button id="copy-room" aria-label="Copy room invite">Copy invite ↗</button><span id="player-count" class="count">1 / 8</span></div><div id="crosshair" class="crosshair"></div><div id="hitflash" class="hitflash"></div><div id="interact" class="interact" hidden></div><div class="bottom-left"><span class="zone-icon">⌂</span><div><div id="zone-name" class="zone-name">The common room</div><div id="zone-desc" class="zone-desc">SMALL ROOM · SOFT REFLECTIONS</div></div></div><div class="voice-controls"><button id="enable-voice">Enable voice</button><button id="mute" hidden aria-label="Mute microphone">Mic on</button><select id="voice-mode" aria-label="Microphone mode"><option value="open">Open mic</option><option value="ptt">Push to talk</option></select><span id="speaking-light" class="speaking-light"></span></div><div class="bottom-right"><button id="friends-button">Friends <span id="friend-number">1</span></button><button id="debug-button">Diagnostics <span>⌁</span></button></div><div id="pause" class="pause"><div class="eyebrow" style="justify-content:center">You’re in good company</div><h2>Make yourself at home.</h2><p>Explore the room and bring a friend.<br>There’s nothing to win. Yet.</p><button id="resume" class="primary">Click to explore →</button><small>WASD to move · Mouse to look · Esc to pause</small></div></div>
<aside id="friends" class="drawer" hidden><button class="close" data-close="friends" aria-label="Close friends">×</button><h3>In good company</h3><div id="member-list"></div><button id="solo-tab" class="primary">Open a second player <span>↗</span></button><p class="debug-note">Test solo in another tab. Use headphones when testing microphones.</p><button id="leave" class="primary" style="background:transparent;color:#637554;border-color:#c4d0b6">Leave room</button></aside>
<aside id="debug" class="drawer" hidden><button class="close" data-close="debug" aria-label="Close diagnostics">×</button><h3>Under the hood</h3><div id="metrics" class="metrics"></div><div id="peer-debug"></div><p id="codec-status" class="debug-note"></p><p id="net-detail" class="debug-note"></p></aside>
<aside id="help" class="drawer" hidden><button class="close" data-close="help" aria-label="Close help">×</button><h3>A little field guide</h3><div class="help-grid"><div><kbd class="key">W A S D</kbd></div><span>Move around</span><div><kbd class="key">Mouse</kbd></div><span>Look around</span><div><kbd class="key">Shift</kbd></div><span>Sprint</span><div><kbd class="key">Ctrl / C</kbd></div><span>Crouch</span><div><kbd class="key">Space</kbd></div><span>Jump</span><div><kbd class="key">E</kbd></div><span>Pick up / drop</span><div><kbd class="key">Q</kbd></div><span>Throw held object</span><div><kbd class="key">Click / F</kbd></div><span>Fire a gun you are holding</span><div><kbd class="key">V</kbd></div><span>Push to talk</span><div><kbd class="key">M</kbd></div><span>Mute microphone</span><div><kbd class="key">Esc</kbd></div><span>Release mouse</span></div><p class="about-copy">Voices get quieter with distance. Walk into the hall to hear the room change.</p><p class="about-copy">Doors open with <b>E</b>; the workshop doors open by themselves. Nobody can be hurt here — a hit just shoves you.</p></aside>
<aside id="about" class="drawer" hidden><button class="close" data-close="about" aria-label="Close about">×</button><h3>A starting point, together.</h3><p class="about-copy">Friendslop is an open-source starter for small multiplayer games. A shared world, physical objects and voices that live in the room.</p><p class="about-copy">This is the common room. The game you make from it is entirely up to you.</p><p class="debug-note">Three.js · Rapier · TypeScript<br>Original Blender characters & synthetic acoustics</p></aside><div id="toast" class="toast" hidden></div><div id="loading" class="loading">Opening the common room…</div>`;
const scene = new GameScene($("world"));
let sim: Simulation | undefined,
  local: Character | undefined,
  socket: Channel | undefined,
  id = 0,
  code = "",
  token = "",
  name = "Guest",
  seq = 0,
  baseline = 0,
  action = 0;
let connected = false,
  intentional = false;
let yaw = 0,
  pitch = 0,
  acc = 0,
  last = performance.now(),
  ping = 0,
  tickRate = 60,
  tickCost = 0,
  rx = 0,
  tx = 0,
  correction = 0,
  latestTick = 0;
let members: {
  id: number;
  color: number;
  name: string;
  connected: boolean;
  voiceReady: boolean;
}[] = [];
const keys = new Set<string>(),
  ballHeights = new Map<number, { y: number; dy: number }>(),
  pending: Input[] = [],
  outgoing: Input[] = [],
  baselines = new Map<number, PropState[]>(),
  snapshots: { s: Snapshot; time: number }[] = [];
const offset = new THREE.Vector3();
let noticeTimer: ReturnType<typeof setTimeout>,
  hitTimer: ReturnType<typeof setTimeout>,
  lastShot = 0;
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function send(data: unknown) {
  if (socket?.open) {
    socket.send(JSON.stringify(data));
    tx++;
  }
}
const voice = new Voice(
  send,
  (who, on) => {
    scene.speaking(who, on);
    if (who === id) $("speaking-light").classList.toggle("on", on);
  },
  () => {
    if (voice.enabled) {
      $("enable-voice").textContent = "Audio on";
      $("mute").hidden = false;
      $("mute").textContent = voice.muted
        ? "Mic muted"
        : voice.mode === "ptt"
          ? "Hold V to talk"
          : "Mic on";
      $("mute").classList.toggle("muted", voice.muted);
      $("mute").classList.toggle("active", voice.gate);
    }
    $("enable-voice").title = voice.status;
  },
);
const params = new URLSearchParams(location.search);
let network: NetworkConfig;
const networkReady = detect(params).then((config) => {
  network = config;
  voice.iceServers = config.iceServers;
  const server = config.mode === "server";
  const badge = $("net-mode");
  $("net-mode-text").textContent = server
    ? "LIVE SERVER"
    : "STATIC · BROWSER-HOSTED";
  badge.title = server
    ? "A server owns this room's physics, so anyone can join."
    : "No game server: whoever creates a room hosts it in their browser. Very strict networks may not be able to connect.";
  badge.dataset.mode = config.mode;
  badge.hidden = false;
  $("net-detail").innerHTML = server
    ? "Game /ws + voice /voice<br>One Node process. One HTTP port."
    : "Game + voice over WebRTC to the host<br>No server. The host's browser owns the room.";
});
$("join-code").setAttribute("value", params.get("room") ?? "");
if (localStorage.getItem("friendslop:name"))
  $("name").setAttribute("value", localStorage.getItem("friendslop:name")!);
if (params.get("name")) $("name").setAttribute("value", params.get("name")!);
if (params.has("fresh")) {
  sessionStorage.removeItem("friendslop:session");
  const clean = new URL(location.href);
  clean.searchParams.delete("fresh");
  history.replaceState(null, "", clean);
}
const movementSounds = new MovementSounds((position, kind) => voice.spatial?.effect(position, kind));
function setPlaying(value: boolean) {
  movementSounds.clear();
  for (const name of [
    "lobby",
    "shade",
    "footer",
    "scene-caption",
    "top-actions",
  ])
    $(name).hidden = value;
  $("hud").hidden = !value;
  scene.setPlaying(value);
  if (value) $("pause").hidden = false;
}
async function join(wanted: string) {
  if (connected) return;
  name = $<HTMLInputElement>("name").value.trim() || "Guest";
  localStorage.setItem("friendslop:name", name);
  $("entry-error").hidden = true;
  $<HTMLButtonElement>("create").disabled = true;
  intentional = false;
  code = wanted;
  token = "";
  const saved = JSON.parse(
    sessionStorage.getItem("friendslop:session") ?? "null",
  );
  if (saved?.code === code) token = saved.token;
  await connect();
}
let hosting: Hosting | undefined;
let rooms: RoomClient | undefined;
/** In p2p mode an empty code means "create a room", which means host it. */
async function openChannel(kind: "game" | "voice") {
  if (network.mode === "server")
    return openSocket(kind === "game" ? "/ws" : "/voice");
  if (kind === "game" && !code) {
    hosting?.dispose();
    hosting = await startHosting(network.broker);
    code = hosting.code;
  }
  if (hosting && code === hosting.code) return hosting.local(kind);
  return (rooms ??= new RoomClient(network.broker)).open(code, kind);
}
async function connect() {
  await networkReady;
  let channel: Channel;
  try {
    channel = await openChannel("game");
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Could not reach that room.";
    $("entry-error").textContent = message;
    $("entry-error").hidden = false;
    toast(message);
    $<HTMLButtonElement>("create").disabled = false;
    return;
  }
  socket = channel;
  voice.openTransport = () => openChannel("voice");
  send({ type: "join", code, name, token });
  channel.onmessage = (data) => {
    rx++;
    try {
      if (typeof data !== "string") {
        snapshot(decodeSnapshot(data));
        return;
      }
      const m = JSON.parse(data);
      if (m.type === "welcome") {
        id = m.id;
        code = m.code;
        token = m.token;
        seq = m.seq;
        pending.length = outgoing.length = snapshots.length = 0;
        baselines.clear();
        baseline = 0;
        sim?.dispose();
        sim = new Simulation(true);
        if (Array.isArray(m.doors)) sim.syncDoors(m.doors);
        local = sim.addPlayer(id);
        connected = true;
        sessionStorage.setItem(
          "friendslop:session",
          JSON.stringify({ code, token }),
        );
        $("room-code").textContent = code;
        setPlaying(true);
        voice.configure(id, code, m.ticket);
        $<HTMLButtonElement>("create").disabled = false;
        if (import.meta.env.DEV)
          (window as any).__friendslop = {
            get state() {
              return local?.state;
            },
            get members() {
              return members;
            },
            get voice() {
              return voice;
            },
            get scene() {
              return scene;
            },
            get sim() {
              return sim;
            },
            input: (key: string, down: boolean) =>
              down ? keys.add(key) : keys.delete(key),
            action: interact,
            shoot: fire,
            get doors() {
              return sim?.doorStates();
            },
            look: (y: number, p: number) => {
              yaw = y;
              pitch = p;
            },
            join,
            send,
          };
      }
      if (m.type === "members") {
        members = m.members;
        $("player-count").textContent =
          `${members.filter((m) => m.connected).length} / 8`;
        $("friend-number").textContent = String(members.length);
        for (const [pid] of scene.avatars)
          if (pid < 60000 && !members.some((m) => m.id === pid))
            scene.removePlayer(pid);
        voice.updateMembers(members);
        renderMembers();
      }
      if (m.type === "pong") {
        ping = Math.round(performance.now() - m.time);
        tickCost = Number.isFinite(m.cost) ? m.cost : 0;
        tickRate = Number.isFinite(m.rate) ? m.rate : 0;
      }
      if (m.type === "signal") voice.signal(m.peer, m.data);
      if (m.type === "route")
        voice.route(m.peer, m.relay, m.epoch, m.reason, m.forced);
      if (m.type === "speaking") voice.speakingFrom(m.id, m.active);
      if (m.type === "sound") {
        const s =
          m.id === id
            ? local?.state
            : snapshots.at(-1)?.s.players.find((p) => p.id === m.id);
        if (s) voice.spatial?.effect(s, m.kind);
      }
      if (m.type === "shot") {
        // Our own shot was drawn the moment we pulled the trigger.
        if (m.id !== id) {
          scene.tracer(m);
          voice.spatial?.effect(m, "shoot");
        }
        if (m.hit) {
          const struck =
            m.hit === id
              ? local?.state
              : snapshots.at(-1)?.s.players.find((p) => p.id === m.hit);
          if (struck) voice.spatial?.effect(sim!.eye(struck), "hit");
          if (m.hit === id) {
            $("hitflash").classList.add("on");
            clearTimeout(hitTimer);
            hitTimer = setTimeout(
              () => $("hitflash").classList.remove("on"),
              260,
            );
          }
        }
      }
      if (m.type === "door") {
        sim?.setDoor(m.id, m.open);
        const door = DOORS.find((d) => d.id === m.id);
        if (door)
          voice.spatial?.effect(
            { x: door.p[0], y: door.p[1], z: door.p[2] },
            "door",
          );
      }
      if (m.type === "action-result" && !m.accepted)
        toast(
          m.action === "shoot"
            ? "Nothing to fire. Pick up a gun first."
            : m.action === "door"
              ? "That door will not budge from here."
              : "That object is out of reach or already held.",
        );
      if (m.type === "error") {
        $("entry-error").textContent = m.message;
        $("entry-error").hidden = false;
        toast(m.message);
        $<HTMLButtonElement>("create").disabled = false;
        if (!connected) {
          intentional = true;
          sessionStorage.removeItem("friendslop:session");
          voice.disconnect();
          setPlaying(false);
          document.exitPointerLock();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };
  channel.onclose = () => {
    if (socket !== channel) return;
    connected = false;
    keys.clear();
    voice.disconnect();
    $<HTMLButtonElement>("create").disabled = false;
    if (intentional) return;
    toast("Connection interrupted. Rejoining your room…");
    setTimeout(() => {
      if (!intentional && socket === channel) void connect();
    }, 1500);
  };
}
function snapshot(s: Snapshot) {
  if (!sim || !local) return;
  latestTick = s.tick;
  let props: PropState[];
  if (s.full) {
    baselines.set(s.baseline, s.props);
    baseline = s.baseline;
    while (baselines.size > 5) baselines.delete(baselines.keys().next().value!);
    props = s.props;
  } else {
    const base = baselines.get(s.baseline);
    if (!base) {
      baseline = 0;
      return;
    }
    const changes = new Map(s.props.map((p) => [p.id, p]));
    props = base.map((p) => changes.get(p.id) ?? p);
  }
  // Balls announce themselves: a reversal in the authoritative height is a bounce.
  for (const p of props) {
    if (propKind(p.id) !== "ball") continue;
    const previous = ballHeights.get(p.id),
      dy = previous ? p.y - previous.y : 0;
    if (previous && !p.owner && previous.dy < -0.05 && dy > 0.015)
      voice.spatial?.effect(p, "bounce");
    ballHeights.set(p.id, { y: p.y, dy });
  }
  const full = { ...s, props };
  snapshots.push({ s: full, time: performance.now() });
  while (snapshots.length > 25) snapshots.shift();
  sim.syncProps(props);
  const own = s.players.find((p) => p.id === id);
  if (!own) return;
  const before = new THREE.Vector3(local.state.x, local.state.y, local.state.z);
  sim.restore(local, own);
  while (pending.length && pending[0].seq <= own.ack) pending.shift();
  for (const input of pending) {
    sim.motor(local, input);
    sim.step();
  }
  const after = new THREE.Vector3(local.state.x, local.state.y, local.state.z);
  correction = before.distanceTo(after);
  if (correction < 1) offset.add(before.sub(after));
  else offset.set(0, 0, 0);
}
function interact(throwing = false) {
  if (!local || !sim) return;
  const s = local.state;
  if (!s.held && !sim.target(s)) {
    const door = sim.doorTarget(s);
    if (door && !DOORS.find((d) => d.id === door)?.auto) {
      send({ type: "action", request: ++action, action: "door", object: door });
      return;
    }
  }
  send({
    type: "action",
    request: ++action,
    action: s.held ? (throwing ? "throw" : "drop") : "pickup",
    object: sim.target(s),
  });
}
/** Pull the trigger: predict the tracer locally, let the authority decide the hit. */
function fire() {
  if (!local || !sim || propKind(local.state.held) !== "gun") return;
  const now = performance.now();
  if (now - lastShot < WEAPON.cooldown * STEP * 1000) return;
  lastShot = now;
  send({ type: "action", request: ++action, action: "shoot" });
  const s = local.state,
    eye = sim.eye(s),
    d = sim.direction(s);
  scene.tracer({
    ...eye,
    dx: d.x,
    dy: d.y,
    dz: d.z,
    distance: sim.reach(s),
    hit: 0,
  });
  voice.spatial?.effect(eye, "shoot");
}
$("entry").addEventListener("submit", (e) => {
  e.preventDefault();
  void join("");
});
$("join").onclick = () => {
  const value = $<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (value.length !== 6) {
    $("entry-error").textContent = "Enter the six-character room code.";
    $("entry-error").hidden = false;
    return;
  }
  void join(value);
};
let previewControls = false;
const canvas = scene.renderer.domElement;
canvas.tabIndex = 0;
canvas.setAttribute("aria-label", "Game world — click to move, WASD and mouse");
function pauseControls() {
  previewControls = false;
  keys.clear();
  voice.setTalk(false);
  canvas.style.cursor = "";
  $("pause").hidden = false;
  document.exitPointerLock();
}
function previewFallback() {
  if (!connected) return;
  previewControls = true;
  canvas.focus({ preventScroll: true });
  canvas.style.cursor = "grab";
  $("pause").hidden = true;
  toast("Preview controls: WASD to move · drag to look · Esc to pause");
}
async function lock() {
  if (!connected) return;
  void voice.prepareAudio().catch(() => toast("Game audio could not start. Click the world to retry."));
  canvas.focus({ preventScroll: true });
  if (typeof canvas.requestPointerLock !== "function") {
    previewFallback();
    return;
  }
  try {
    await canvas.requestPointerLock();
  } catch {
    previewFallback();
  }
}
$("resume").onclick = () => void lock();
canvas.onclick = () => {
  if (connected && !document.pointerLockElement && !previewControls)
    void lock();
};
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) {
    previewControls = false;
    $("pause").hidden = true;
  } else if (!previewControls) {
    keys.clear();
    voice.setTalk(false);
    $("pause").hidden = false;
  }
});
addEventListener("mousemove", (e) => {
  if (document.pointerLockElement || (previewControls && e.buttons === 1)) {
    yaw -= e.movementX * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * 0.002));
  }
});
addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
  if (e.code === "Escape" && previewControls) {
    pauseControls();
    return;
  }
  if (e.code === "KeyV") voice.setTalk(true);
  if (e.code === "KeyM" && !e.repeat) voice.setMuted(!voice.muted);
  if (
    !document.pointerLockElement &&
    !previewControls &&
    !(import.meta.env.DEV && params.has("test"))
  )
    return;
  keys.add(e.code);
  if (["Space", "ControlLeft", "Tab"].includes(e.code)) e.preventDefault();
  if (!e.repeat && e.code === "KeyE") interact();
  if (!e.repeat && e.code === "KeyQ") interact(true);
  if (!e.repeat && e.code === "KeyF") fire();
});
addEventListener("mousedown", (e) => {
  if (e.button === 0 && connected && document.pointerLockElement) fire();
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "KeyV") voice.setTalk(false);
});
addEventListener("blur", () => {
  keys.clear();
  voice.setTalk(false);
});
$("enable-voice").onclick = () =>
  void voice.enable().then(() => {
    if (voice.status.startsWith("Audio unavailable")) toast(voice.status);
  });
$("mute").onclick = () => voice.setMuted(!voice.muted);
$("voice-mode").onchange = () =>
  voice.setMode($<HTMLSelectElement>("voice-mode").value as "open" | "ptt");
for (const name of ["friends", "debug", "help", "about"]) {
  $(`${name}-button`).onclick = () => {
    const open = $(name).hidden;
    for (const n of ["friends", "debug", "help", "about"]) $(n).hidden = true;
    $(name).hidden = !open;
    pauseControls();
  };
}
document
  .querySelectorAll<HTMLElement>("[data-close]")
  .forEach((b) => (b.onclick = () => ($(b.dataset.close!).hidden = true)));
$("copy-room").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      new URL(`?room=${code}`, document.baseURI).href,
    );
    toast("Invite link copied. Bring your people.");
  } catch {
    toast(`Your room code is ${code}`);
  }
};
$("solo-tab").onclick = () =>
  window.open(
    new URL(
      `?room=${code}&name=Guest%20${members.length + 1}&fresh=1`,
      document.baseURI,
    ).href,
    "_blank",
    "noopener",
  );
$("leave").onclick = () => {
  intentional = true;
  send({ type: "leave" });
  socket?.close();
  hosting?.dispose();
  hosting = undefined;
  rooms?.dispose();
  rooms = undefined;
  code = "";
  voice.disconnect();
  connected = false;
  sessionStorage.removeItem("friendslop:session");
  pauseControls();
  for (const [pid] of scene.avatars) if (pid < 60000) scene.removePlayer(pid);
  sim?.dispose();
  sim = undefined;
  local = undefined;
  setPlaying(false);
  $("friends").hidden = true;
};
function renderMembers() {
  const list = $("member-list");
  list.replaceChildren();
  for (const m of members) {
    const row = document.createElement("div");
    row.className = "member";
    const dot = document.createElement("i");
    dot.className = "member-dot";
    dot.style.background = PALETTE[m.color];
    const info = document.createElement("div"),
      label = document.createElement("div"),
      status = document.createElement("small");
    label.textContent = m.name + (m.id === id ? " (you)" : "");
    status.textContent = !m.connected
      ? "Reconnecting…"
      : m.voiceReady
        ? "Voice enabled"
        : "Exploring quietly";
    info.append(label, status);
    row.append(dot, info);
    list.append(row);
  }
}
/** Where you are, in the words the HUD uses. Mirrors the acoustics regions. */
function zone(s: { x: number; y: number; z: number }): [string, string] {
  if (s.z < -11)
    return s.x < -6.9 && s.z < -19.9
      ? ["The shed", "TIGHT AND DUSTY"]
      : ["The yard", "OUTDOORS · OPEN SKY"];
  if (s.x > 14)
    return s.x > 24 && s.z < -2
      ? ["The back room", "STORES · KEEP IT TIDY"]
      : ["The workshop", "BIG ROOM · HARD SURFACES"];
  if (s.x > 5)
    return s.y > 2.4
      ? ["The mezzanine", "ABOVE THE HALL · MIND THE EDGE"]
      : ["The hall", "LARGE HALL · LONG REFLECTIONS"];
  return ["The common room", "SMALL ROOM · SOFT REFLECTIONS"];
}
let debugTime = 0;
function debug(now: number) {
  if (now - debugTime < 500) return;
  debugTime = now;
  $("metrics").innerHTML =
    `<div>ROUND TRIP<strong>${ping} <small>ms</small></strong></div><div>SERVER TICK<strong>${tickRate.toFixed(0)} <small>Hz</small></strong></div><div>TICK WORK<strong>${tickCost.toFixed(1)} <small>ms</small></strong></div><div>CORRECTION<strong>${(correction * 100).toFixed(1)} <small>cm</small></strong></div><div>GAME PACKETS<strong>${tx} ↑ ${rx} ↓</strong></div><div>VOICE PACKETS<strong>${voice.sent} ↑ ${voice.received} ↓</strong></div>`;
  $("codec-status").textContent =
    `${voice.codec} · ${voice.dropped} expired frames · ${voice.status}`;
  const peers = $("peer-debug");
  peers.replaceChildren();
  for (const p of voice.peers.values()) {
    const row = document.createElement("div");
    row.className = "debug-peer";
    const title = document.createElement("b");
    title.textContent =
      members.find((m) => m.id === p.id)?.name ?? `Player ${p.id}`;
    const button = document.createElement("button");
    button.textContent = p.forced ? "Allow P2P" : "Force relay";
    button.onclick = () => voice.force(p.id, !p.forced);
    const text = document.createElement("div");
    text.textContent = `${p.relay ? "Relayed" : "P2P"} · ${p.state}`;
    const detail = document.createElement("small");
    detail.textContent = `${p.bufferMs.toFixed(0)} ms buffered · ${p.packets} RTP packets · ${p.reason}`;
    row.append(button, title, text, detail);
    peers.append(row);
  }
}
function frame(now: number) {
  const dt = Math.min(0.08, (now - last) / 1000);
  last = now;
  acc += dt;
  if (connected && sim && local) {
    let steps = 0;
    while (acc >= STEP && steps++ < 5) {
      acc -= STEP;
      const input: Input = {
        seq: ++seq,
        x: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
        z: Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
        yaw,
        pitch,
        buttons:
          (keys.has("Space") ? BUTTON.JUMP : 0) |
          (keys.has("ShiftLeft") || keys.has("ShiftRight")
            ? BUTTON.SPRINT
            : 0) |
          (keys.has("ControlLeft") || keys.has("KeyC") ? BUTTON.CROUCH : 0),
      };
      pending.push(input);
      outgoing.push(input);
      sim.motor(local, input);
      sim.step();
      if (pending.length > 120) pending.shift();
      if (outgoing.length >= 2 && socket?.open) {
        socket.send(encodeInputs(outgoing.splice(0), baseline));
        tx++;
      }
    }
    offset.multiplyScalar(Math.exp(-dt * 16));
    const s = local.state,
      eye = sim.eye(s);
    movementSounds.update(s, now);
    scene.camera.position.set(
      eye.x + offset.x,
      eye.y + offset.y,
      eye.z + offset.z,
    );
    scene.camera.rotation.set(-pitch, yaw, 0, "YXZ");
    const targetTime = now - 100;
    let a = snapshots[0],
      b = snapshots.at(-1);
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].time >= targetTime) {
        a = snapshots[i - 1];
        b = snapshots[i];
        break;
      }
    }
    if (a && b) {
      const t = Math.max(
        0,
        Math.min(1, (targetTime - a.time) / Math.max(1, b.time - a.time)),
      );
      for (const remote of b.s.players) {
        if (remote.id === id) continue;
        const prev = a.s.players.find((p) => p.id === remote.id) ?? remote;
        const r = {
          ...remote,
          x: THREE.MathUtils.lerp(prev.x, remote.x, t),
          y: THREE.MathUtils.lerp(prev.y, remote.y, t),
          z: THREE.MathUtils.lerp(prev.z, remote.z, t),
          yaw:
            prev.yaw +
            Math.atan2(
              Math.sin(remote.yaw - prev.yaw),
              Math.cos(remote.yaw - prev.yaw),
            ) *
              t,
          pitch: THREE.MathUtils.lerp(prev.pitch, remote.pitch, t),
        };
        scene.updatePlayer(
          r,
          members.find((m) => m.id === r.id)?.name ?? "Guest",
          dt,
          members.find((m) => m.id === r.id)?.color,
        );
        scene.setMouth(r.id, voice.loudness(r.id));
        voice.updatePosition(r.id, { x: r.x, y: r.y + 0.65, z: r.z });
        movementSounds.update(r, now);
      }
      const props = b.s.props.map((p) => {
        if (p.owner === id)
          return sim!.propStates().find((x) => x.id === p.id) ?? p;
        const prev = a.s.props.find((x) => x.id === p.id) ?? p;
        const q = new THREE.Quaternion(prev.qx, prev.qy, prev.qz, prev.qw)
          .normalize()
          .slerp(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw).normalize(), t);
        return {
          ...p,
          x: THREE.MathUtils.lerp(prev.x, p.x, t),
          y: THREE.MathUtils.lerp(prev.y, p.y, t),
          z: THREE.MathUtils.lerp(prev.z, p.z, t),
          qx: q.x,
          qy: q.y,
          qz: q.z,
          qw: q.w,
        };
      });
      scene.updateProps(props);
    }
    scene.updateDoors(sim.doorStates());
    const target = s.held ? 0 : sim.target(s);
    const door = s.held || target ? 0 : sim.doorTarget(s);
    scene.setHighlight(target);
    $("crosshair").classList.toggle("target", !!target || !!door);
    $("crosshair").classList.toggle("armed", propKind(s.held) === "gun");
    $("interact").hidden =
      (!target && !door && !s.held) ||
      (!document.pointerLockElement && !previewControls);
    $("interact").innerHTML = s.held
      ? `<kbd class="key">E</kbd> Drop <span style="margin-left:10px"><kbd class="key">Q</kbd> Throw</span>${
          propKind(s.held) === "gun"
            ? '<span style="margin-left:10px"><kbd class="key">Click</kbd> Fire</span>'
            : ""
        }`
      : door
        ? DOORS.find((d) => d.id === door)?.auto
          ? "Opens by itself"
          : `<kbd class="key">E</kbd> ${DOORS.find((d) => d.id === door)!.zone}`
        : `<kbd class="key">E</kbd> Pick up the ${propKind(target) ?? "thing"}`;
    const [zoneName, zoneDesc] = zone(s);
    $("zone-name").textContent = zoneName;
    $("zone-desc").textContent = zoneDesc;
    voice.spatial?.update(scene.camera.position, yaw, pitch);
  } else {
    acc = 0;
    scene.overview(now / 1000);
  }
  scene.render(dt);
  debug(now);
  requestAnimationFrame(frame);
}
try {
  await Promise.all([initPhysics(), scene.loaded, networkReady]);
  $("loading").hidden = true;
  requestAnimationFrame(frame);
} catch (e) {
  $("loading").textContent = `Could not open the room: ${String(e)}`;
  console.error(e);
}
setInterval(() => {
  if (connected) send({ type: "ping", time: performance.now() });
}, 1000);
addEventListener("beforeunload", () => voice.dispose());
