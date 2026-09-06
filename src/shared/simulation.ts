import RAPIER from "@dimforge/rapier3d-compat";
import {
  AUTO_RANGE,
  DOOR_TRAVEL,
  DOORS,
  LEVEL,
  HORN,
  MELEE,
  PROPS,
  propKind,
  SPAWNS,
  STEP,
  WEAPON,
  type Door,
  type PropKind,
} from "./level.js";
import {
  BUTTON,
  type Input,
  type PlayerState,
  type PropState,
} from "./protocol.js";
export { RAPIER };
// Keep WASM initialization stable across in-process development module reloads.
const runtime = globalThis as typeof globalThis & {
  __friendslopPhysicsReady?: Promise<void>;
};
export function initPhysics() {
  return (runtime.__friendslopPhysicsReady ??= RAPIER.init());
}
export type Character = {
  state: PlayerState;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
};
/** A leaf slides between `def.p` (shut) and `def.p + def.slide` (open). */
export type DoorRuntime = {
  def: Door;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** What the authority last said. Automatic doors add local proximity on top. */
  remote: boolean;
  open: boolean;
  progress: number;
};
export type DoorState = { id: number; open: boolean; progress: number };
export type Shot = {
  id: number;
  object: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  distance: number;
  hit: number;
};
export type Swing = { id: number; object: number; hit: number };
/** Each prop kind is a different thing to throw: a crate thuds, a ball bounces. */
function shape(kind: PropKind) {
  if (kind === "ball")
    return RAPIER.ColliderDesc.ball(0.3)
      .setMass(0.9)
      .setFriction(0.45)
      .setRestitution(0.86)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  if (kind === "gun")
    return RAPIER.ColliderDesc.cuboid(0.1, 0.11, 0.3)
      .setMass(1.1)
      .setFriction(0.7)
      .setRestitution(0.1);
  if (kind === "bat")
    return RAPIER.ColliderDesc.cuboid(0.09, 0.09, 0.55)
      .setMass(0.95)
      .setFriction(0.72)
      .setRestitution(0.2);
  if (kind === "horn")
    return RAPIER.ColliderDesc.cuboid(0.16, 0.13, 0.32)
      .setMass(0.7)
      .setFriction(0.68)
      .setRestitution(0.14);
  return RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3)
    .setMass(1.5)
    .setFriction(0.8)
    .setRestitution(0.18);
}
export class Simulation {
  world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  players = new Map<number, Character>();
  props = new Map<number, RAPIER.RigidBody>();
  owners = new Map<number, number>();
  doors = new Map<number, DoorRuntime>();
  /** Door ids whose open state changed since the authority last drained them. */
  doorEvents: number[] = [];
  private cooldowns = new Map<number, number>();
  private meleeCooldowns = new Map<number, number>();
  private hornCooldowns = new Map<number, number>();
  private frame = 0;
  constructor(public prediction = false) {
    this.world.timestep = STEP;
    for (const b of LEVEL)
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2)
          .setTranslation(...b.p)
          .setFriction(0.8),
      );
    for (const def of DOORS) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...def.p),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          def.s[0] / 2,
          def.s[1] / 2,
          def.s[2] / 2,
        ).setFriction(0.6),
        body,
      );
      this.doors.set(def.id, {
        def,
        body,
        collider,
        remote: false,
        open: false,
        progress: 0,
      });
    }
    PROPS.forEach((prop, i) => {
      const bouncy = prop.kind === "ball";
      const body = this.world.createRigidBody(
        (prediction
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic()
        )
          .setTranslation(...prop.p)
          .setLinearDamping(bouncy ? 0.08 : 0.6)
          .setAngularDamping(bouncy ? 0.12 : 0.8)
          .setCcdEnabled(true),
      );
      this.world.createCollider(shape(prop.kind), body);
      this.props.set(i + 1, body);
      this.owners.set(i + 1, 0);
    });
    this.world.step();
  }
  addPlayer(id: number) {
    const spawn = SPAWNS[(id - 1) % 8];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn[0],
        spawn[1],
        spawn[2],
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3),
      body,
    );
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.32, 0.2, false);
    controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(Math.PI / 3);
    controller.setApplyImpulsesToDynamicBodies(false);
    const state: PlayerState = {
      id,
      x: spawn[0],
      y: spawn[1],
      z: spawn[2],
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      flags: 0,
      held: 0,
      stagger: 0,
      ack: 0,
    };
    const c = { state, body, collider, controller };
    this.players.set(id, c);
    return c;
  }
  removePlayer(id: number) {
    const c = this.players.get(id);
    if (!c) return;
    this.release(id);
    this.world.removeCharacterController(c.controller);
    this.world.removeRigidBody(c.body);
    this.players.delete(id);
    this.cooldowns.delete(id);
    this.meleeCooldowns.delete(id);
    this.hornCooldowns.delete(id);
  }
  motor(c: Character, input: Input) {
    const s = c.state,
      wasCrouched = !!(s.flags & 2);
    let crouched = !!(input.buttons & BUTTON.CROUCH);
    // Never call Rapier again from a query predicate: its Rust world is borrowed.
    // Resolve every handle before entering the WASM query.
    const excluded = new Set(
      [...this.players.values()].map((p) => p.collider.handle),
    );
    const heldCollider = s.held
      ? this.props.get(s.held)?.collider(0).handle
      : undefined;
    if (heldCollider !== undefined) excluded.add(heldCollider);
    const filter = (col: RAPIER.Collider) => !excluded.has(col.handle);
    if (wasCrouched && !crouched) {
      const p = c.body.translation();
      const hit = this.world.castShape(
        p,
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: 1, z: 0 },
        new RAPIER.Capsule(0.2, 0.3),
        0.01,
        0.7,
        true,
        undefined,
        undefined,
        c.collider,
        c.body,
        filter,
      );
      if (hit) crouched = true;
    }
    if (crouched !== wasCrouched) {
      c.collider.setShape(new RAPIER.Capsule(crouched ? 0.2 : 0.55, 0.3));
      s.y += crouched ? -0.35 : 0.35;
      c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    }
    const length = Math.max(1, Math.hypot(input.x, input.z)),
      speed = crouched ? 2 : input.buttons & BUTTON.SPRINT ? 6 : 3.6;
    const dx =
        ((input.x * Math.cos(input.yaw) - input.z * Math.sin(input.yaw)) /
          length) *
        speed,
      dz =
        ((-input.x * Math.sin(input.yaw) - input.z * Math.cos(input.yaw)) /
          length) *
        speed;
    // A shove wins the argument with your own legs until the stagger runs out.
    const control = s.stagger > 0 ? WEAPON.control : 1;
    s.vx += (dx - s.vx) * Math.min(1, STEP * 18) * control;
    s.vz += (dz - s.vz) * Math.min(1, STEP * 18) * control;
    if (s.stagger > 0) s.stagger--;
    if (
      input.buttons & BUTTON.JUMP &&
      !(s.flags & 8) &&
      s.flags & 1 &&
      !crouched
    )
      s.vy = 6.5;
    s.vy = Math.max(-30, s.vy - 18 * STEP);
    c.controller.computeColliderMovement(
      c.collider,
      { x: s.vx * STEP, y: s.vy * STEP, z: s.vz * STEP },
      undefined,
      undefined,
      filter,
    );
    const m = c.controller.computedMovement();
    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    if (c.controller.computedGrounded() || Math.abs(m.y - s.vy * STEP) > 0.001)
      s.vy = 0;
    s.yaw =
      ((((input.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI)) -
      Math.PI;
    s.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));
    s.flags =
      (c.controller.computedGrounded() ? 1 : 0) |
      (crouched ? 2 : 0) |
      (input.buttons & BUTTON.SPRINT ? 4 : 0) |
      (input.buttons & BUTTON.JUMP ? 8 : 0);
    s.ack = input.seq;
    if (s.y < -10) {
      s.x = 0;
      s.y = 2;
      s.z = 5;
      s.vy = 0;
      s.stagger = 0;
    }
    c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  restore(c: Character, s: PlayerState) {
    c.state = { ...s };
    c.collider.setShape(new RAPIER.Capsule(s.flags & 2 ? 0.2 : 0.55, 0.3));
    c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    c.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  eye(s: PlayerState) {
    return { x: s.x, y: s.y + (s.flags & 2 ? 0.3 : 0.65), z: s.z };
  }
  direction(s: PlayerState) {
    return {
      x: -Math.sin(s.yaw) * Math.cos(s.pitch),
      y: -Math.sin(s.pitch),
      z: -Math.cos(s.yaw) * Math.cos(s.pitch),
    };
  }
  /** Stable hand pose shared by physics and shot visuals for compact tools. */
  heldPose(s: PlayerState, kind = propKind(s.held)) {
    const eye = this.eye(s),
      d = this.direction(s),
      span = Math.max(0.001, Math.hypot(d.x, d.z)),
      right = { x: -d.z / span, z: d.x / span },
      forward = kind === "gun" ? 0.82 : kind === "bat" ? 0.76 : 0.72,
      sideways = kind === "gun" ? 0.27 : kind === "bat" ? 0.34 : 0.29,
      lowered = kind === "gun" ? 0.19 : kind === "bat" ? 0.27 : 0.16;
    const cy = Math.cos(s.yaw / 2),
      sy = Math.sin(s.yaw / 2),
      cx = Math.cos(s.pitch / 2),
      sx = Math.sin(-s.pitch / 2);
    return {
      position: {
        x: eye.x + d.x * forward + right.x * sideways,
        y: eye.y + d.y * forward - lowered,
        z: eye.z + d.z * forward + right.z * sideways,
      },
      rotation: { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx },
    };
  }
  /** World-space tip of the gun barrel, matching its visual model. */
  muzzle(s: PlayerState) {
    const pose = this.heldPose(s, "gun"),
      d = this.direction(s);
    return {
      x: pose.position.x + d.x * 0.64,
      y: pose.position.y + d.y * 0.64,
      z: pose.position.z + d.z * 0.64,
    };
  }
  /** Closest collider along the look ray, players included. Nothing is mutated. */
  private look(s: PlayerState, max: number, skipPlayers: boolean) {
    const c = this.players.get(s.id);
    if (!c) return null;
    const players = new Set(
      [...this.players.values()].map((p) => p.collider.handle),
    );
    const held = s.held ? this.props.get(s.held)?.collider(0).handle : undefined;
    const hit = this.world.castRay(
      new RAPIER.Ray(this.eye(s), this.direction(s)),
      max,
      true,
      undefined,
      undefined,
      c.collider,
      c.body,
      (col: RAPIER.Collider) =>
        col.handle !== held && !(skipPlayers && players.has(col.handle)),
    );
    return hit;
  }
  target(s: PlayerState, max = 2.8) {
    const hit = this.look(s, max, true);
    if (!hit) return 0;
    return (
      [...this.props].find(
        ([, b]) => b.collider(0).handle === hit.collider.handle,
      )?.[0] ?? 0
    );
  }
  /** The door leaf under the crosshair, or 0. Anything nearer blocks the reach. */
  doorTarget(s: PlayerState, max = 3.2) {
    const hit = this.look(s, max, true);
    if (!hit) return 0;
    return (
      [...this.doors].find(
        ([, d]) => d.collider.handle === hit.collider.handle,
      )?.[0] ?? 0
    );
  }
  /** How far the crosshair reaches before something stops it, for local tracers. */
  reach(s: PlayerState, max = WEAPON.range) {
    const hit = this.look(s, max, false);
    return hit ? hit.timeOfImpact : max;
  }
  setDoor(id: number, open: boolean) {
    const door = this.doors.get(id);
    if (door) door.remote = open;
  }
  /** Toggle a hand-operated leaf the player is actually looking at. */
  toggleDoor(playerId: number, id: number) {
    const c = this.players.get(playerId),
      door = this.doors.get(id);
    if (!c || !door || door.def.auto || this.doorTarget(c.state) !== id)
      return null;
    door.remote = !door.remote;
    return door.remote;
  }
  doorStates(): DoorState[] {
    return [...this.doors].map(([id, d]) => ({
      id,
      open: d.open,
      progress: d.progress,
    }));
  }
  syncDoors(states: DoorState[]) {
    for (const s of states) {
      const door = this.doors.get(s.id);
      if (!door) continue;
      door.remote = s.open;
      door.open = s.open;
      door.progress = s.progress;
    }
  }
  /**
   * Fire the held gun. Server-authoritative: the ray decides, and a hit is a
   * shove plus a stagger — there is no health here and nobody falls over.
   */
  shoot(playerId: number): Shot | null {
    const c = this.players.get(playerId);
    if (!c || PROPS[c.state.held - 1]?.kind !== "gun") return null;
    if (this.frame < (this.cooldowns.get(playerId) ?? 0)) return null;
    this.cooldowns.set(playerId, this.frame + WEAPON.cooldown);
    const s = c.state,
      eye = this.eye(s),
      muzzle = this.muzzle(s),
      d = this.direction(s);
    const targets = new Map(
      [...this.players].map(([id, p]) => [p.collider.handle, id]),
    );
    const hit = this.look(s, WEAPON.range, false);
    const victim = hit ? (targets.get(hit.collider.handle) ?? 0) : 0;
    const struck = this.players.get(victim);
    if (struck) {
      struck.state.vx += d.x * WEAPON.knock;
      struck.state.vz += d.z * WEAPON.knock;
      struck.state.vy = Math.max(struck.state.vy, 0) + WEAPON.lift;
      struck.state.stagger = WEAPON.stagger;
    }
    s.vx -= d.x * WEAPON.recoil;
    s.vz -= d.z * WEAPON.recoil;
    const end = {
        x: eye.x + d.x * (hit ? hit.timeOfImpact : WEAPON.range),
        y: eye.y + d.y * (hit ? hit.timeOfImpact : WEAPON.range),
        z: eye.z + d.z * (hit ? hit.timeOfImpact : WEAPON.range),
      },
      distance = Math.hypot(end.x - muzzle.x, end.y - muzzle.y, end.z - muzzle.z);
    return {
      id: playerId,
      object: s.held,
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z,
      dx: (end.x - muzzle.x) / distance,
      dy: (end.y - muzzle.y) / distance,
      dz: (end.z - muzzle.z) / distance,
      distance,
      hit: victim,
    };
  }
  /** Swing the held bat through a forgiving capsule-sized lane in front. */
  swing(playerId: number): Swing | null {
    const c = this.players.get(playerId);
    if (!c || propKind(c.state.held) !== "bat") return null;
    if (this.frame < (this.meleeCooldowns.get(playerId) ?? 0)) return null;
    this.meleeCooldowns.set(playerId, this.frame + MELEE.cooldown);
    const s = c.state,
      d = this.direction(s),
      targets = new Map(
        [...this.players].map(([id, p]) => [p.collider.handle, id]),
      ),
      held = this.props.get(s.held)!;
    const hit = this.world.castShape(
      this.eye(s),
      { x: 0, y: 0, z: 0, w: 1 },
      d,
      new RAPIER.Ball(MELEE.radius),
      0.01,
      MELEE.range,
      true,
      undefined,
      undefined,
      c.collider,
      c.body,
      (col: RAPIER.Collider) => col.handle !== held.collider(0).handle,
    );
    const victim = hit ? (targets.get(hit.collider.handle) ?? 0) : 0,
      struck = this.players.get(victim);
    if (struck) {
      struck.state.vx += d.x * MELEE.knock;
      struck.state.vz += d.z * MELEE.knock;
      struck.state.vy = Math.max(struck.state.vy, 0) + MELEE.lift;
      struck.state.stagger = MELEE.stagger;
    }
    s.vx -= d.x * MELEE.recoil;
    s.vz -= d.z * MELEE.recoil;
    return { id: playerId, object: s.held, hit: victim };
  }
  honk(playerId: number) {
    const c = this.players.get(playerId);
    if (!c || propKind(c.state.held) !== "horn") return false;
    if (this.frame < (this.hornCooldowns.get(playerId) ?? 0)) return false;
    this.hornCooldowns.set(playerId, this.frame + HORN.cooldown);
    return true;
  }
  pickup(playerId: number, objectId: number) {
    const c = this.players.get(playerId),
      body = this.props.get(objectId);
    if (
      !c ||
      !body ||
      c.state.held ||
      this.owners.get(objectId) ||
      this.target(c.state) !== objectId
    )
      return false;
    c.state.held = objectId;
    this.owners.set(objectId, playerId);
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return true;
  }
  release(playerId: number, throwing = false) {
    const c = this.players.get(playerId);
    if (!c || !c.state.held) return false;
    const id = c.state.held,
      body = this.props.get(id)!;
    c.state.held = 0;
    this.owners.set(id, 0);
    body.setBodyType(
      this.prediction
        ? RAPIER.RigidBodyType.KinematicPositionBased
        : RAPIER.RigidBodyType.Dynamic,
      true,
    );
    const d = this.direction(c.state),
      k = throwing ? 10 : 1;
    body.setLinvel(
      {
        x: c.state.vx + d.x * k,
        y: Math.max(0, c.state.vy) + d.y * k + (throwing ? 2 : 0),
        z: c.state.vz + d.z * k,
      },
      true,
    );
    body.setAngvel({ x: throwing ? 2 : 0, y: throwing ? 1 : 0, z: 0 }, true);
    return true;
  }
  /** Slide every leaf toward its target; automatic ones watch for company. */
  private moveDoors() {
    const rate = STEP / DOOR_TRAVEL;
    for (const [id, door] of this.doors) {
      const near =
        !!door.def.auto &&
        [...this.players.values()].some(
          (p) =>
            Math.hypot(
              p.state.x - door.def.p[0],
              p.state.z - door.def.p[2],
            ) < AUTO_RANGE && Math.abs(p.state.y - door.def.p[1]) < 3,
        );
      const open = door.remote || near;
      if (open !== door.open) {
        door.open = open;
        if (this.doorEvents.length < 64) this.doorEvents.push(id);
      }
      const goal = open ? 1 : 0;
      if (door.progress === goal) continue;
      door.progress =
        goal > door.progress
          ? Math.min(1, door.progress + rate)
          : Math.max(0, door.progress - rate);
      const e = door.progress * door.progress * (3 - 2 * door.progress);
      door.body.setNextKinematicTranslation({
        x: door.def.p[0] + door.def.slide[0] * e,
        y: door.def.p[1] + door.def.slide[1] * e,
        z: door.def.p[2] + door.def.slide[2] * e,
      });
    }
  }
  step() {
    this.frame++;
    this.moveDoors();
    for (const c of this.players.values()) {
      if (!c.state.held) continue;
      // Compact tools stay locked to one stable hand pose. Bulky throwable
      // props still pull back when a wall would clip them.
      const kind = propKind(c.state.held),
        tool = kind === "gun" || kind === "bat" || kind === "horn",
        gun = kind === "gun",
        reach = gun ? 1.5 : 2.25,
        lowered = gun ? 0.18 : 0,
        sideways = gun ? 0.28 : 0;
      const body = this.props.get(c.state.held)!,
        eye = this.eye(c.state),
        d = this.direction(c.state),
        origin = {
          x: eye.x - d.x * 0.65,
          y: eye.y - d.y * 0.65,
          z: eye.z - d.z * 0.65,
        };
      if (tool) {
        const pose = this.heldPose(c.state, kind);
        body.setNextKinematicTranslation(pose.position);
        body.setNextKinematicRotation(pose.rotation);
        continue;
      }
      const hit = this.world.castShape(
        origin,
        { x: 0, y: 0, z: 0, w: 1 },
        d,
        new RAPIER.Ball(0.54),
        0.03,
        2.25,
        true,
        undefined,
        undefined,
        body.collider(0),
        body,
        (col: RAPIER.Collider) =>
          ![...this.players.values()].some(
            (p) => p.collider.handle === col.handle,
          ),
      );
      // Keep it in front of the face: a cast that starts already touching
      // something reports no distance at all, which used to park the object
      // behind the eye where its owner could not see it.
      const distance = Math.max(
        gun ? 1.05 : 0.95,
        Math.min(reach, (hit?.time_of_impact ?? reach) - 0.05),
      );
      const span = Math.max(0.001, Math.hypot(d.x, d.z)),
        right = { x: -d.z / span, z: d.x / span };
      body.setNextKinematicTranslation({
        x: origin.x + d.x * distance + right.x * sideways,
        y: origin.y + d.y * distance - lowered,
        z: origin.z + d.z * distance + right.z * sideways,
      });
      // Guns are modelled pointing down -z, so they take the look pitch too.
      const cy = Math.cos(c.state.yaw / 2),
        sy = Math.sin(c.state.yaw / 2),
        cx = gun ? Math.cos(c.state.pitch / 2) : 1,
        sx = gun ? Math.sin(-c.state.pitch / 2) : 0;
      body.setNextKinematicRotation({
        x: cy * sx,
        y: sy * cx,
        z: -sy * sx,
        w: cy * cx,
      });
    }
    this.world.step();
    if (!this.prediction)
      for (const [id, body] of this.props) {
        if (body.translation().y < -8) {
          const p = PROPS[id - 1].p;
          body.setTranslation({ x: p[0], y: p[1] + 1.5, z: p[2] }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
  }
  propStates(): PropState[] {
    return [...this.props].map(([id, b]) => {
      const p = b.translation(),
        q = b.rotation();
      return {
        id,
        ...p,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
        owner: this.owners.get(id) ?? 0,
      };
    });
  }
  syncProps(props: PropState[]) {
    for (const p of props) {
      const b = this.props.get(p.id);
      if (!b) continue;
      this.owners.set(p.id, p.owner);
      b.setTranslation(p, true);
      b.setNextKinematicTranslation(p);
      b.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
      b.setNextKinematicRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw });
    }
  }
  dispose() {
    this.world.free();
  }
}
