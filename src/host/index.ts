import { type Channel, type ChannelKind, safeToken, randomHex, roomCode } from "../net/channel.js";
import { initPhysics, Simulation } from "../shared/simulation.js";
import {
  decodeInputs,
  encodeSnapshot,
  changedProp,
  readVoice,
  type Input,
  type PropState,
} from "../shared/protocol.js";
import { MAX_PLAYERS, STEP } from "../shared/level.js";
type Member = {
  id: number;
  name: string;
  color: number;
  token: string;
  ticket: string;
  ws: Channel | null;
  voice: Channel | null;
  queue: Input[];
  last: Input;
  lastInput: number;
  expires: number;
  baseline: number;
  voiceReady: boolean;
  actions: Set<number>;
  speaking: boolean;
};
type Pair = {
  a: number;
  b: number;
  relay: boolean;
  epoch: number;
  ready: Set<number>;
  reason: string;
  linger: number;
  forced: boolean;
};
type Room = {
  code: string;
  sim: Simulation;
  members: Map<number, Member>;
  nextId: number;
  host: number;
  tick: number;
  keyframes: Map<number, PropState[]>;
  pairs: Map<string, Pair>;
  emptySince: number;
};
const key = (a: number, b: number) => [a, b].sort((x, y) => x - y).join(":");
const send = (ws: Channel | null, data: unknown) => {
  if (ws?.open && ws.bufferedAmount < 128 * 1024)
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
};
export async function createHost(options: { maxRooms?: number } = {}) {
  await initPhysics();
  const rooms = new Map<string, Room>();
  const channels = new Set<Channel>();
  const lastMessages = new Map<Channel, number>();
  let disposed = false;
  function accept(ws: Channel, kind: ChannelKind) {
    if (disposed) { ws.close(1012, "Host closed"); return; }
    channels.add(ws);
    if (kind === "game") acceptGame(ws);
    else acceptVoice(ws);
  }
  function broadcast(r: Room, data: unknown) {
    for (const m of r.members.values()) send(m.ws, data);
  }
  function membership(r: Room) {
    broadcast(r, {
      type: "members",
      host: r.host,
      members: [...r.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        connected: !!m.ws,
        voiceReady: m.voiceReady,
      })),
    });
  }
  function pair(r: Room, a: number, b: number) {
    const k = key(a, b);
    let p = r.pairs.get(k);
    if (!p) {
      p = {
        a: Math.min(a, b),
        b: Math.max(a, b),
        relay: false,
        epoch: 0,
        ready: new Set(),
        reason: "Connecting",
        linger: 0,
        forced: false,
      };
      r.pairs.set(k, p);
    }
    return p;
  }
  function route(r: Room, p: Pair, relay: boolean, reason: string) {
    p.epoch++;
    p.relay = relay;
    p.reason = reason;
    p.ready.clear();
    p.linger = relay ? 0 : Date.now() + 1000;
    for (const id of [p.a, p.b])
      send(r.members.get(id)?.ws ?? null, {
        type: "route",
        peer: id === p.a ? p.b : p.a,
        relay,
        epoch: p.epoch,
        reason,
        forced: p.forced,
      });
  }
  function retire(r: Room, m: Member, remove = false) {
    m.ws = null;
    m.voice?.close();
    m.voice = null;
    m.voiceReady = false;
    m.queue = [];
    m.last = { ...m.last, x: 0, z: 0, buttons: 0 };
    m.expires = Date.now() + (remove ? 0 : 30000);
    r.sim.release(m.id);
    for (const [k, p] of r.pairs) {
      if (p.a === m.id || p.b === m.id) r.pairs.delete(k);
    }
    if (r.host === m.id)
      r.host = [...r.members.values()].find((x) => x.ws)?.id ?? m.id;
    membership(r);
  }
  /** Create a room under a known code, or return the existing one. A browser
   *  host needs this because the broker decides the code before anyone joins. */
  function ensureRoom(code: string) {
    let room = rooms.get(code);
    if (!room) {
      room = {
        code,
        sim: new Simulation(),
        members: new Map(),
        nextId: 1,
        host: 1,
        tick: 0,
        keyframes: new Map(),
        pairs: new Map(),
        emptySince: 0,
      };
      rooms.set(code, room);
    }
    return room;
  }
  function acceptGame(ws: Channel) {
    lastMessages.set(ws, Date.now());
    let room: Room | undefined, member: Member | undefined;
    let rate = 0,
      rateTime = Date.now();
    const deadline = setTimeout(() => {
      if (!member) ws.close(1008, "Join required");
    }, 10000);
    ws.onmessage = (raw) => {
      lastMessages.set(ws, Date.now());
      const isBinary = typeof raw !== "string";
      try {
        if (Date.now() - rateTime > 1000) {
          rateTime = Date.now();
          rate = 0;
        }
        if (++rate > 160) throw Error("Rate limit");
        if (isBinary) {
          if (!room || !member) throw Error("Join first");
          const { inputs, baseline } = decodeInputs(
            raw as ArrayBuffer,
          );
          member.baseline = room.keyframes.has(baseline) ? baseline : 0;
          for (const input of inputs) {
            if (
              input.seq <= member.last.seq ||
              member.queue.some((i) => i.seq === input.seq)
            )
              continue;
            if (input.seq > member.last.seq + 240)
              throw Error("Input sequence too far ahead");
            if (member.queue.length < 12) member.queue.push(input);
          }
          member.lastInput = Date.now();
          return;
        }
        const msg = JSON.parse(raw as string);
        if (!msg || typeof msg.type !== "string") throw Error("Bad message");
        if (!member) {
          if (msg.type !== "join") throw Error("Join first");
          if (rooms.size >= (options.maxRooms ?? 16) && !msg.code)
            throw Error("Server full");
          const code =
            typeof msg.code === "string"
              ? msg.code
                  .toUpperCase()
                  .replace(/[^A-Z2-9]/g, "")
                  .slice(0, 6)
              : "";
          room = rooms.get(code);
          if (code && !room)
            throw Error("Room not found. Create a fresh room.");
          if (!room) {
            let next = "";
            do {
              next = roomCode();
            } while (rooms.has(next));
            room = ensureRoom(next);
          }
          if (typeof msg.token === "string" && msg.token.length < 128)
            member = [...room.members.values()].find((m) =>
              safeToken(m.token, msg.token),
            );
          if (member) {
            const old = member.ws;
            member.ws = ws;
            old?.close(4001, "Reconnected elsewhere");
            member.voice?.close();
            member.voice = null;
            member.voiceReady = false;
            member.queue = [];
            member.baseline = 0;
          } else {
            if (room.members.size >= MAX_PLAYERS)
              throw Error("This room is full");
            const id = room.nextId++;
            if (id > 65000) throw Error("Room lifetime exceeded");
            member = {
              id,
              color: Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((color) => ![...room!.members.values()].some((m) => m.color === color))!,
              name:
                String(msg.name || "Guest")
                  .replace(/[\x00-\x1f]/g, "")
                  .trim()
                  .slice(0, 20) || "Guest",
              token: randomHex(24),
              ticket: "",
              ws,
              voice: null,
              queue: [],
              last: { seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
              lastInput: Date.now(),
              expires: 0,
              baseline: 0,
              voiceReady: false,
              actions: new Set(),
              speaking: false,
            };
            room.members.set(id, member);
            room.sim.addPlayer(id);
          }
          member.ticket = randomHex(24);
          member.expires = 0;
          room.emptySince = 0;
          if (!room.members.get(room.host)?.ws) room.host = member.id;
          send(ws, {
            type: "welcome",
            id: member.id,
            code: room.code,
            token: member.token,
            ticket: member.ticket,
            seq: member.last.seq,
            doors: room.sim.doorStates(),
          });
          membership(room);
          return;
        }
        if (!room) return;
        if (msg.type === "ping") {
          send(ws, {
            type: "pong",
            time: msg.time,
            tick: room.tick,
            cost: tickCost,
            rate: tickRate,
          });
          return;
        }
        if (msg.type === "leave") {
          retire(room, member, true);
          ws.close();
          return;
        }
        if (msg.type === "action") {
          if (
            !Number.isSafeInteger(msg.request) ||
            !["pickup", "drop", "throw", "shoot", "door"].includes(msg.action)
          )
            throw Error("Invalid action");
          if (member.actions.has(msg.request)) return;
          member.actions.add(msg.request);
          if (member.actions.size > 64)
            member.actions.delete(member.actions.values().next().value!);
          // Every one of these is decided here: the ray, the owner, the leaf.
          const shot =
            msg.action === "shoot" ? room.sim.shoot(member.id) : null;
          const opened =
            msg.action === "door"
              ? room.sim.toggleDoor(member.id, Number(msg.object))
              : null;
          const accepted =
            msg.action === "shoot"
              ? !!shot
              : msg.action === "door"
                ? opened !== null
                : msg.action === "pickup"
                  ? room.sim.pickup(member.id, Number(msg.object))
                  : room.sim.release(member.id, msg.action === "throw");
          send(ws, {
            type: "action-result",
            request: msg.request,
            action: msg.action,
            accepted,
          });
          if (shot) broadcast(room, { type: "shot", ...shot });
          else if (accepted && msg.action !== "door")
            broadcast(room, { type: "sound", id: member.id, kind: msg.action });
          return;
        }
        if (msg.type === "voice-ready") {
          member.voiceReady = !!msg.ready;
          membership(room);
          return;
        }
        if (msg.type === "speaking") {
          member.speaking = !!msg.active;
          broadcast(room, {
            type: "speaking",
            id: member.id,
            active: member.speaking,
          });
          return;
        }
        const target = room.members.get(Number(msg.peer));
        if (!target || target.id === member.id || !target.ws) return;
        if (msg.type === "signal") {
          if (JSON.stringify(msg.data).length > 20000)
            throw Error("Signal too large");
          send(target.ws, { type: "signal", peer: member.id, data: msg.data });
          return;
        }
        if (msg.type === "route-request") {
          const p = pair(room, member.id, target.id);
          if (msg.force === true) p.forced = true;
          if (msg.force === false) p.forced = false;
          if (msg.relay) {
            if (!p.relay || msg.force !== undefined)
              route(
                room,
                p,
                true,
                String(msg.reason ?? "Direct unavailable").slice(0, 80),
              );
          } else {
            if (p.forced) return;
            p.ready.add(member.id);
            if (p.ready.has(target.id))
              route(room, p, false, "Direct connection verified");
          }
          return;
        }
      } catch (err) {
        send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : "Invalid message",
        });
        if (!member) ws.close(1008, "Invalid join");
      }
    };
    ws.onclose = () => {
      channels.delete(ws);
      lastMessages.delete(ws);
      clearTimeout(deadline);
      if (!disposed && room && member?.ws === ws) retire(room, member);
    };
  }
  function acceptVoice(ws: Channel) {
    let room: Room | undefined,
      member: Member | undefined,
      tokens = 100,
      last = performance.now();
    const deadline = setTimeout(() => {
      if (!member) ws.close(1008, "Authenticate");
    }, 5000);
    ws.onmessage = (raw) => {
      const binary = typeof raw !== "string";
      try {
        // 50 frames/s normally. Allow bounded delivery bursts after scheduling/TCP stalls.
        const now = performance.now();
        tokens = Math.min(100, tokens + ((now - last) / 1000) * 60);
        last = now;
        if (tokens < 1) throw Error("Voice rate");
        tokens--;
        if (!member) {
          // The voice channel is unordered in p2p mode, so a frame can outrun
          // the auth message. Dropping it is harmless — losing one 20 ms Opus
          // packet is what the jitter buffer is for — and the 5 s deadline
          // still closes a channel that never authenticates. The rate limiter
          // above still closes a pre-auth flood.
          if (binary) return;
          const auth = JSON.parse(raw as string);
          room = rooms.get(String(auth.code));
          member = room?.members.get(Number(auth.id));
          if (
            !member?.ws ||
            typeof auth.ticket !== "string" ||
            !safeToken(member.ticket, auth.ticket)
          )
            throw Error("Authentication failed");
          member.voice?.close(4001);
          member.voice = ws;
          send(ws, { type: "ready" });
          return;
        }
        if (!binary || !room) return;
        const b = (raw as ArrayBuffer).slice(0);
        readVoice(b);
        new DataView(b).setUint16(2, member.id, true);
        for (const p of room.pairs.values()) {
          if (
            !(p.relay || p.linger > Date.now()) ||
            (p.a !== member.id && p.b !== member.id)
          )
            continue;
          const recipient = room.members.get(
            p.a === member.id ? p.b : p.a,
          )?.voice;
          if (
            recipient?.open &&
            recipient.bufferedAmount < 12000
          )
            recipient.send(b);
        }
      } catch {
        ws.close(1008, "Invalid voice message");
      }
    };
    ws.onclose = () => {
      channels.delete(ws);
      lastMessages.delete(ws);
      clearTimeout(deadline);
      if (member?.voice === ws) member.voice = null;
    };
  }
  let previous = performance.now(),
    acc = 0,
    tickCost = 0,
    tickRate = 60,
    rateStart = performance.now(),
    rateTicks = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min((now - previous) / 1000, 0.1);
    previous = now;
    const begin = performance.now();
    let steps = 0;
    while (acc >= STEP && steps++ < 5) {
      acc -= STEP;
      rateTicks++;
      for (const room of rooms.values()) {
        room.tick++;
        for (const m of room.members.values()) {
          const c = room.sim.players.get(m.id)!;
          if (m.queue.length) {
            m.last = m.queue.shift()!;
          } else m.last = { ...m.last, buttons: m.last.buttons & ~1 };
          if (!m.ws || Date.now() - m.lastInput > 250)
            m.last = { ...m.last, x: 0, z: 0, buttons: 0 };
          room.sim.motor(c, m.last);
        }
        room.sim.step();
        // Automatic leaves open on their own, so the tick is where doors are told.
        if (room.sim.doorEvents.length) {
          const doors = new Map(
            room.sim.doorStates().map((d) => [d.id, d.open]),
          );
          for (const id of room.sim.doorEvents.splice(0))
            broadcast(room, { type: "door", id, open: !!doors.get(id) });
        }
        if (room.tick % 3 === 0) {
          const props = room.sim.propStates();
          if (room.tick % 120 === 0 || room.keyframes.size === 0) {
            room.keyframes.set(room.tick, props);
            while (room.keyframes.size > 4)
              room.keyframes.delete(room.keyframes.keys().next().value!);
          }
          for (const m of room.members.values()) {
            if (!m.ws || m.ws.bufferedAmount > 24000) continue;
            const latest = [...room.keyframes.keys()].at(-1)!;
            const full =
              !m.baseline ||
              room.tick % 120 === 0 ||
              !room.keyframes.has(m.baseline);
            const baseline = full ? room.tick : m.baseline;
            if (full) {
              room.keyframes.set(room.tick, props);
            }
            const base = room.keyframes.get(baseline)!;
            m.ws.send(
              encodeSnapshot({
                tick: room.tick,
                full,
                baseline,
                players: [...room.sim.players.values()].map((c) => c.state),
                props: full
                  ? props
                  : props.filter((p) => {
                      const old = base.find((b) => b.id === p.id);
                      return !old || changedProp(p, old);
                    }),
              }),
            );
          }
        }
      }
    }
    if (steps >= 5) acc = 0;
    tickCost = performance.now() - begin;
    if (now - rateStart >= 1000) {
      tickRate = (rateTicks * 1000) / (now - rateStart);
      rateTicks = 0;
      rateStart = now;
    }
  }, 4);
  const maintenance = setInterval(() => {
    for (const [ws, lastMessage] of lastMessages)
      if (Date.now() - lastMessage > 30000)
        ws.close(1001, "Heartbeat expired");
    for (const [code, r] of rooms) {
      for (const [id, m] of r.members) {
        if (!m.ws && m.expires < Date.now()) {
          r.sim.removePlayer(id);
          r.members.delete(id);
          membership(r);
        }
      }
      if (!r.members.size) {
        r.emptySince ||= Date.now();
        if (Date.now() - r.emptySince > 30000) {
          r.sim.dispose();
          rooms.delete(code);
        }
      }
      while (r.keyframes.size > 8)
        r.keyframes.delete(r.keyframes.keys().next().value!);
    }
  }, 5000);
  return {
    accept,
    ensureRoom,
    rooms,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      clearInterval(maintenance);
      for (const ws of channels) ws.close(1012, "Server restarted");
      channels.clear();
      lastMessages.clear();
      for (const r of rooms.values()) r.sim.dispose();
      rooms.clear();
    },
  };
}
