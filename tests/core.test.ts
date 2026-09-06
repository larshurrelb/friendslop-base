import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeInputs,
  decodeInputs,
  encodeSnapshot,
  decodeSnapshot,
  voicePacket,
  readVoice,
  BUTTON,
  changedProp,
} from "../src/shared/protocol.js";
import { initPhysics, Simulation } from "../src/shared/simulation.js";
import { PROPS, WEAPON } from "../src/shared/level.js";
import { createEncoder, createDecoder } from "libopus-wasm";
await initPhysics();
test("binary input round trip and malformed packet rejection", () => {
  const input = { seq: 51, x: -1, z: 0.5, yaw: 1.2, pitch: -0.4, buttons: 5 };
  const result = decodeInputs(encodeInputs([input], 30));
  assert.equal(result.baseline, 30);
  assert.equal(result.inputs[0].seq, 51);
  assert.ok(Math.abs(result.inputs[0].z - 0.5) < 0.0001);
  assert.throws(() => decodeInputs(new ArrayBuffer(2)));
  const bad = encodeInputs([input], 0);
  new DataView(bad).setFloat32(15, NaN, true);
  assert.throws(() => decodeInputs(bad));
});
test("snapshot and voice packets preserve identity and reject truncated audio", () => {
  const sim = new Simulation();
  sim.addPlayer(1);
  const s = {
    tick: 20,
    baseline: 20,
    full: true,
    players: [sim.players.get(1)!.state],
    props: sim.propStates(),
  };
  const round = decodeSnapshot(encodeSnapshot(s));
  assert.equal(round.players[0].id, 1);
  assert.equal(round.props.length, PROPS.length);
  assert.ok(Math.abs(round.props[0].x - s.props[0].x) < 0.011);
  assert.equal(round.players[0].stagger, 0);
  const b = voicePacket(22, 3, 960, new Uint8Array([1, 2, 3]));
  const f = readVoice(b);
  assert.equal(f.epoch, 22);
  assert.deepEqual([...f.payload], [1, 2, 3]);
  assert.throws(() => readVoice(b.slice(0, -1)));
  sim.dispose();
});
test("motor settles, walks at fixed speed, jumps and blocks level walls", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  let seq = 0;
  const step = (buttons = 0, x = 0, z = 0) => {
    sim.motor(c, { seq: ++seq, x, z, yaw: 0, pitch: 0, buttons });
    sim.step();
  };
  for (let i = 0; i < 120; i++) step();
  assert.ok(c.state.flags & 1);
  assert.ok(Math.abs(c.state.y - 0.87) < 0.08);
  const start = c.state.z;
  for (let i = 0; i < 60; i++) step(0, 0, 1);
  assert.ok(start - c.state.z > 3 && start - c.state.z < 4);
  step(BUTTON.JUMP);
  for (let i = 0; i < 12; i++) step();
  assert.ok(c.state.y > 1.5);
  for (let i = 0; i < 500; i++) step(0, -1, 0);
  assert.ok(c.state.x > -13.6);
  sim.dispose();
});
test("pickup validation, single ownership and disconnect release", () => {
  const sim = new Simulation(),
    a = sim.addPlayer(1),
    b = sim.addPlayer(2);
  for (let i = 0; i < 90; i++) sim.step();
  const prop = sim.props.get(1)!.translation();
  for (const c of [a, b]) {
    sim.restore(c, {
      ...c.state,
      x: prop.x,
      y: 0.87,
      z: prop.z + 1.5,
      pitch: 0.7,
    });
  }
  sim.step();
  assert.equal(sim.pickup(1, 8), false);
  assert.equal(sim.pickup(1, 1), true);
  assert.equal(sim.pickup(2, 1), false);
  sim.removePlayer(1);
  assert.equal(sim.owners.get(1), 0);
  sim.dispose();
});
test("replaying acknowledged state reproduces static movement", () => {
  const a = new Simulation(true),
    b = new Simulation(true),
    ca = a.addPlayer(1),
    cb = b.addPlayer(1);
  const inputs = Array.from({ length: 60 }, (_, i) => ({
    seq: i + 1,
    x: 1,
    z: 1,
    yaw: 0.2,
    pitch: 0,
    buttons: 0,
  }));
  let saved = { ...ca.state };
  for (const i of inputs) {
    a.motor(ca, i);
    a.step();
    if (i.seq === 30) saved = { ...ca.state };
  }
  b.restore(cb, saved);
  for (const i of inputs.slice(30)) {
    b.motor(cb, i);
    b.step();
  }
  assert.ok(
    Math.hypot(
      ca.state.x - cb.state.x,
      ca.state.y - cb.state.y,
      ca.state.z - cb.state.z,
    ) < 0.05,
  );
  a.dispose();
  b.dispose();
});
test("raw Opus WASM round trip and loss concealment", async () => {
  const e = await createEncoder({ channels: 1, bitrate: 24000 }),
    d = await createDecoder({ channels: 1 });
  const wave = Float32Array.from(
    { length: 960 },
    (_, i) => Math.sin((i * 2 * Math.PI * 440) / 48000) * 0.2,
  );
  let decoded: Float32Array = new Float32Array();
  for (let i = 0; i < 5; i++) decoded = d.decodeFloat(e.encodeFloat(wave));
  assert.equal(decoded.length, 960);
  assert.ok(decoded.some((v) => Math.abs(v) > 0.05));
  assert.equal(d.decodePacketLossFloat(960).length, 960);
  e.free();
  d.free();
});
test("delta comparison matches wire quantization", () => {
  const p = { id: 1, x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1, owner: 0 };
  assert.equal(changedProp(p, { ...p, x: 1.001 }), false);
  assert.equal(changedProp(p, { ...p, owner: 2 }), true);
});
test("holding across motor queries keeps Rapier borrow state valid through cleanup", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  for (let i = 0; i < 90; i++) sim.step();
  const prop = sim.props.get(1)!.translation();
  sim.restore(c, {
    ...c.state,
    x: prop.x,
    y: 0.87,
    z: prop.z + 1.5,
    pitch: 0.7,
  });
  sim.step();
  assert.equal(sim.pickup(1, 1), true);
  for (let i = 0; i < 180; i++) {
    sim.motor(c, { seq: i + 1, x: 1, z: 0, yaw: 0, pitch: 0.7, buttons: 0 });
    sim.step();
  }
  sim.removePlayer(1);
  sim.dispose();
});
test("reverb volumes blend at the doorway and keep distant outside positions dry", async () => {
  const { regionWeights } = await import("../src/shared/acoustics.js");
  assert.equal(regionWeights({ x: 0, y: 1.5, z: 0 }).get("room"), 1);
  const doorway = regionWeights({ x: 5, y: 1.5, z: 0 });
  assert.equal(doorway.get("room"), 0.5);
  assert.equal(doorway.get("hall"), 0.5);
  assert.equal(regionWeights({ x: 9, y: 1.5, z: 0 }).get("hall"), 1);
  assert.equal(regionWeights({ x: 50, y: 1.5, z: 0 }).get("hall"), 0);
});

test("a gun shoves whoever it hits, staggers them, and never removes them", () => {
  const sim = new Simulation(),
    shooter = sim.addPlayer(1),
    victim = sim.addPlayer(2);
  const gun = PROPS.findIndex((p) => p.kind === "gun") + 1;
  // Put a gun on open floor rather than fighting the workbench it starts on.
  sim.props.get(gun)!.setTranslation({ x: 3.5, y: 0.5, z: 1.5 }, true);
  for (let i = 0; i < 60; i++) sim.step();
  const rest = sim.props.get(gun)!.translation();
  sim.restore(shooter, {
    ...shooter.state,
    x: rest.x,
    y: 0.87,
    z: rest.z + 1.5,
    yaw: 0,
    pitch: Math.atan2(0.87 + 0.65 - rest.y, 1.5),
  });
  sim.restore(victim, { ...victim.state, x: rest.x, y: 0.87, z: rest.z - 4.5 });
  sim.step();
  assert.equal(sim.pickup(1, gun), true);
  // Level the crosshair on the other player and pull the trigger.
  sim.restore(shooter, { ...shooter.state, pitch: 0, held: gun });
  sim.step();
  const before = { ...victim.state };
  const shot = sim.shoot(1);
  assert.equal(shot?.hit, 2);
  assert.equal(sim.shoot(1), null, "the gun has a cooldown");
  assert.equal(victim.state.stagger, WEAPON.stagger);
  assert.ok(victim.state.vz < -5, "the shove points down the barrel");
  const still = { seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 };
  for (let i = 0; i < 45; i++) {
    sim.motor(shooter, { ...still, seq: i + 1, pitch: 0 });
    sim.motor(victim, { ...still, seq: i + 1 });
    sim.step();
  }
  assert.ok(before.z - victim.state.z > 1.5, "pushed back a good way");
  assert.equal(victim.state.stagger, 0, "and back on their feet after");
  assert.ok(sim.players.has(2) && victim.state.y > -1, "nobody dies in here");
  for (let i = 0; i < WEAPON.cooldown; i++) sim.step();
  assert.ok(sim.shoot(1), "the gun is ready again");
  sim.dispose();
});
test("staggered players keep only a fraction of their own steering", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  for (let i = 0; i < 30; i++) sim.step();
  // Measured inside the stagger window, where the damping actually applies.
  const run = (stagger: number) => {
    sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 5, vx: 0, vz: 0, stagger });
    for (let i = 0; i < WEAPON.stagger - 2; i++) {
      sim.motor(c, { seq: i + 1, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
    return 5 - c.state.z;
  };
  const free = run(0),
    shoved = run(WEAPON.stagger);
  assert.ok(free > 1.1, `walked ${free}`);
  assert.ok(shoved < free * 0.45, `staggered ${shoved} against ${free}`);
  sim.dispose();
});
test("a dropped ball bounces back up where a crate lands flat", () => {
  const sim = new Simulation();
  const drop = (id: number) => {
    const body = sim.props.get(id)!;
    body.setTranslation({ x: -5, y: 3, z: 2 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let landed = false,
      rebound = 0;
    for (let i = 0; i < 150; i++) {
      sim.step();
      const y = body.translation().y;
      if (y < 0.45) landed = true;
      if (landed) rebound = Math.max(rebound, y);
    }
    return rebound;
  };
  const ball = PROPS.findIndex((p) => p.kind === "ball") + 1,
    crate = PROPS.findIndex((p) => p.kind === "crate") + 1;
  assert.ok(drop(ball) > 0.9, "a ball comes back to you");
  assert.ok(drop(crate) < 0.55, "a crate stays where it fell");
  sim.dispose();
});
test("a shut door blocks the yard, and opening it lets a player through", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  const walk = (steps: number) => {
    for (let i = 0; i < steps; i++) {
      sim.motor(c, { seq: i + 1, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 });
      sim.step();
    }
  };
  sim.restore(c, { ...c.state, x: 3.25, y: 0.87, z: -8 });
  walk(90);
  assert.ok(c.state.z > -10.6, "the shut leaves hold");
  const across = sim.addPlayer(2);
  sim.restore(across, { ...across.state, x: 0, y: 0.87, z: 5 });
  sim.step();
  assert.equal(sim.toggleDoor(2, 3), null, "not from across the room");
  assert.equal(sim.toggleDoor(1, 3), true, "but yes from the doorstep");
  sim.setDoor(4, true);
  for (let i = 0; i < 70; i++) sim.step();
  assert.equal(sim.doorStates().find((d) => d.id === 3)?.progress, 1);
  walk(120);
  assert.ok(c.state.z < -12, "the yard is open");
  sim.dispose();
});
test("automatic doors open for whoever walks up and shut again behind them", () => {
  const sim = new Simulation(),
    c = sim.addPlayer(1);
  sim.step();
  sim.doorEvents.length = 0;
  sim.restore(c, { ...c.state, x: 12, y: 0.87, z: 0 });
  sim.step();
  assert.deepEqual([...sim.doorEvents].sort(), [1, 2]);
  assert.equal(sim.doors.get(1)!.open, true);
  sim.doorEvents.length = 0;
  sim.restore(c, { ...c.state, x: 0, y: 0.87, z: 5 });
  sim.step();
  assert.deepEqual([...sim.doorEvents].sort(), [1, 2]);
  assert.equal(sim.doors.get(1)!.open, false);
  // A client told about a remote player keeps the leaf open on its own.
  sim.setDoor(1, true);
  sim.step();
  assert.equal(sim.doors.get(1)!.open, true);
  sim.dispose();
});
