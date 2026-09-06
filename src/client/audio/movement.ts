import type { PlayerState } from "../../shared/protocol";
import type { Vec3 } from "../../shared/level";

/** Distance-driven steps; replicated transforms give remote players the same sounds. */
export class MovementSounds {
  private players = new Map<
    number,
    {
      x: number;
      z: number;
      grounded: boolean;
      distance: number;
      lastJump: number;
    }
  >();
  constructor(private play: (position: Vec3, kind: string) => void) {}
  update(s: PlayerState, now: number) {
    const grounded = !!(s.flags & 1);
    const previous = this.players.get(s.id);
    const next = {
      x: s.x,
      z: s.z,
      grounded,
      distance: previous?.distance ?? 0,
      lastJump: previous?.lastJump ?? -Infinity,
    };
    this.players.set(s.id, next);
    if (!previous) return;
    const position = { x: s.x, y: s.y - (s.flags & 2 ? 0.45 : 0.8), z: s.z };
    if (
      previous.grounded &&
      !grounded &&
      s.vy > 1 &&
      now - previous.lastJump > 350
    ) {
      this.play(position, "jump");
      next.lastJump = now;
    }
    const distance = Math.hypot(s.x - previous.x, s.z - previous.z);
    if (!grounded || !previous.grounded || distance > 1) {
      next.distance = 0;
      return;
    }
    if (Math.hypot(s.vx, s.vz) < 0.15) {
      next.distance = 0;
      return;
    }
    next.distance += distance;
    const stride = s.flags & 2 ? 0.9 : s.flags & 4 ? 1.65 : 1.45;
    if (next.distance >= stride) {
      next.distance %= stride;
      this.play(position, s.flags & 2 ? "step-soft" : "step");
    }
  }
  clear() {
    this.players.clear();
  }
}
