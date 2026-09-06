import type { Vec3 } from "./level.js";
export type ReverbRegion = {
  id: string;
  min: Vec3;
  max: Vec3;
  blendWidth: number;
  impulse: string;
  wet: number;
};
/** Axis-aligned listener volumes. Add a new volume and IR without changing the audio graph. */
export const REVERB_REGIONS: ReverbRegion[] = [
  {
    id: "room",
    min: { x: -14, y: -1, z: -11 },
    max: { x: 5, y: 7, z: 11 },
    blendWidth: 1,
    impulse: "/audio/room.wav",
    wet: 0.12,
  },
  {
    id: "hall",
    min: { x: 5, y: -1, z: -11 },
    max: { x: 14, y: 7, z: 11 },
    blendWidth: 1,
    impulse: "/audio/hall.wav",
    wet: 0.32,
  },
  {
    id: "workshop",
    min: { x: 14, y: -1, z: -9 },
    max: { x: 30, y: 7, z: 9 },
    blendWidth: 1,
    impulse: "/audio/hall.wav",
    wet: 0.36,
  },
  {
    id: "yard",
    min: { x: -13, y: -1, z: -26 },
    max: { x: 13, y: 9, z: -11 },
    blendWidth: 1,
    impulse: "/audio/yard.wav",
    wet: 0.07,
  },
];
export function regionWeights(position: Vec3, regions = REVERB_REGIONS) {
  const raw = regions.map((region) => {
    const inside = Math.min(
      position.x - region.min.x,
      region.max.x - position.x,
      position.y - region.min.y,
      region.max.y - position.y,
      position.z - region.min.z,
      region.max.z - position.z,
    );
    return Math.max(
      0,
      Math.min(1, 0.5 + inside / (2 * Math.max(0.01, region.blendWidth))),
    );
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return new Map(regions.map((r, i) => [r.id, total ? raw[i] / total : 0]));
}
