import { test } from "node:test";
import assert from "node:assert/strict";
import { MovementSounds } from "../src/client/audio/movement.js";
import type { PlayerState } from "../src/shared/protocol.js";
test("steps follow grounded travel; jumping sounds once, never from falling or teleporting", () => {
  const sounds: string[] = [];
  const movement = new MovementSounds((_p, kind) => sounds.push(kind));
  const s: PlayerState = {
    id: 1,
    x: 0,
    y: 0.85,
    z: 0,
    vx: 3.6,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    flags: 1,
    held: 0,
    stagger: 0,
    ack: 0,
  };
  movement.update(s, 0);
  for (let i = 1; i <= 20; i++) movement.update({ ...s, x: i * 0.1 }, i * 28);
  assert.deepEqual(sounds, ["step"]);
  movement.update({ ...s, x: 2, flags: 0, vy: 6.2 }, 600);
  movement.update({ ...s, x: 2.4, flags: 0, vy: 5 }, 650);
  movement.update({ ...s, x: 2.7, flags: 0, vy: -2 }, 700);
  assert.deepEqual(sounds, ["step", "jump"]);
  movement.update({ ...s, x: 3 }, 900);
  movement.update({ ...s, x: 3, flags: 0, vy: -2 }, 1000);
  movement.update({ ...s, x: 20 }, 1200);
  assert.deepEqual(sounds, ["step", "jump"]);
});
