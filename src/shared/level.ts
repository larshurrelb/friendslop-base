export type Vec3 = { x: number; y: number; z: number };
export type Box = {
  p: [number, number, number];
  s: [number, number, number];
  color: string;
  kind?: string;
  /** Near-side geometry, hidden while the lobby camera looks into the world. */
  hide?: boolean;
};
export type PropKind = "crate" | "ball" | "gun";
export type Prop = { p: [number, number, number]; kind: PropKind };
/** A sliding leaf. Closed at `p`, open at `p + slide`; ids are their own namespace. */
export type Door = {
  id: number;
  p: [number, number, number];
  s: [number, number, number];
  slide: [number, number, number];
  color: string;
  /** Opens by itself for anyone within `AUTO_RANGE`, instead of on a keypress. */
  auto?: boolean;
  zone: string;
};
export const LEVEL: Box[] = [
  // The common room and the hall: one floor, walls with a doorway north and east.
  { p: [0, -0.25, 0], s: [28, 0.5, 22], color: "#b7a892", kind: "floor" },
  { p: [-6, 2.8, -11], s: [16, 5.6, 0.4], color: "#ded7c5" },
  { p: [9.25, 2.8, -11], s: [9.5, 5.6, 0.4], color: "#ded7c5" },
  { p: [3.25, 4.1, -11], s: [2.5, 3, 0.4], color: "#ded7c5" },
  { p: [0, 2.8, 11], s: [28, 5.6, 0.4], color: "#d7cfbc", hide: true },
  { p: [-14, 2.8, 0], s: [0.4, 5.6, 22], color: "#d9d0bb" },
  { p: [14, 2.8, -6.3], s: [0.4, 5.6, 9.4], color: "#d9d0bb", hide: true },
  { p: [14, 2.8, 6.3], s: [0.4, 5.6, 9.4], color: "#d9d0bb", hide: true },
  { p: [14, 4.3, 0], s: [0.4, 2.6, 3.2], color: "#d9d0bb", hide: true },
  { p: [5, 2.8, -7], s: [0.35, 5.6, 8], color: "#678276" },
  { p: [5, 2.8, 7], s: [0.35, 5.6, 8], color: "#678276" },
  { p: [5, 4.6, 0], s: [0.35, 2, 6], color: "#678276" },
  { p: [-9, 0.45, -7.8], s: [5, 0.9, 1.8], color: "#71806c", kind: "couch" },
  { p: [-9, 1.12, -8.5], s: [5, 0.7, 0.4], color: "#71806c" },
  { p: [-11.55, 0.9, -7.8], s: [0.35, 1.5, 1.8], color: "#71806c" },
  { p: [-6.45, 0.9, -7.8], s: [0.35, 1.5, 1.8], color: "#71806c" },
  { p: [-9, 0.28, -4.8], s: [3.3, 0.56, 1.5], color: "#705844", kind: "table" },
  { p: [-10, 1.2, 7.8], s: [6, 0.2, 1.6], color: "#997b58" },
  { p: [-12.7, 0.6, 7.8], s: [0.18, 1.2, 1.4], color: "#424d45" },
  { p: [-7.3, 0.6, 7.8], s: [0.18, 1.2, 1.4], color: "#424d45" },
  // The hall stair: four steps north, four more east, up to the mezzanine deck.
  { p: [9, 0.15, -6], s: [3, 0.3, 1], color: "#a89b84" },
  { p: [9, 0.3, -7], s: [3, 0.6, 1], color: "#a89b84" },
  { p: [9, 0.45, -8], s: [3, 0.9, 1], color: "#a89b84" },
  { p: [9, 0.6, -9], s: [3, 1.2, 1], color: "#a89b84" },
  { p: [10.86, 0.75, -9.4], s: [0.72, 1.5, 2.4], color: "#a89b84" },
  { p: [11.58, 0.9, -9.4], s: [0.72, 1.8, 2.4], color: "#a89b84" },
  { p: [12.3, 1.05, -9.4], s: [0.72, 2.1, 2.4], color: "#a89b84" },
  { p: [13.02, 1.2, -9.4], s: [0.72, 2.4, 2.4], color: "#a89b84" },
  { p: [11.9, 2.575, -5.7], s: [4.2, 0.25, 5], color: "#8b7d64", kind: "deck" },
  { p: [9.8, 3.15, -5.7], s: [0.12, 0.9, 5], color: "#5c6b58" },
  { p: [11.9, 3.15, -3.2], s: [4.2, 0.9, 0.12], color: "#5c6b58" },
  { p: [10.9, 3.15, -8.2], s: [2.2, 0.9, 0.12], color: "#5c6b58" },
  // The workshop, east through the sliding doors.
  { p: [22, -0.25, 0], s: [16, 0.5, 18], color: "#a89e8b", kind: "floor" },
  { p: [30, 2.8, 0], s: [0.4, 5.6, 18.4], color: "#cdc4ae" },
  { p: [22, 2.8, -9], s: [16, 5.6, 0.4], color: "#cdc4ae" },
  { p: [22, 2.8, 9], s: [16, 5.6, 0.4], color: "#cdc4ae", hide: true },
  { p: [24, 2.8, -7.75], s: [0.4, 5.6, 2.5], color: "#c3b9a2" },
  { p: [24, 2.8, -3.45], s: [0.4, 5.6, 2.9], color: "#c3b9a2" },
  { p: [24, 4.4, -5.7], s: [0.4, 2.4, 1.6], color: "#c3b9a2" },
  { p: [27, 2.8, -2], s: [6.4, 5.6, 0.4], color: "#c3b9a2" },
  { p: [18, 0.45, -6], s: [6, 0.9, 1.6], color: "#7a6a52", kind: "table" },
  { p: [16.4, 1.6, 5], s: [1.2, 3.2, 5], color: "#8a7c63" },
  { p: [21, 0.3, 5.5], s: [3.4, 0.6, 2.2], color: "#6f6350", kind: "table" },
  { p: [27, 0.5, 5], s: [1, 1, 1], color: "#9c8f76" },
  { p: [27, 1.5, 5], s: [0.9, 0.9, 0.9], color: "#8d8168" },
  { p: [28.9, 0.7, -6], s: [1.4, 0.16, 4], color: "#6d6552", kind: "rack" },
  { p: [28.9, 1.35, -6], s: [1.4, 0.16, 4], color: "#6d6552", kind: "rack" },
  // The yard, north through the barn doors.
  { p: [0, -0.25, -18.5], s: [26, 0.5, 15], color: "#8fa27d", kind: "floor" },
  { p: [-13, 1.2, -18.5], s: [0.4, 2.4, 15], color: "#cfc7b2" },
  { p: [13, 1.2, -18.5], s: [0.4, 2.4, 15], color: "#cfc7b2" },
  { p: [0, 1.2, -26], s: [26.4, 2.4, 0.4], color: "#cfc7b2" },
  { p: [5, 0.03, -18], s: [12, 0.06, 11], color: "#c3b79c", kind: "court" },
  { p: [-6, 0.3, -13.4], s: [9, 0.6, 3.4], color: "#8d7a5e", kind: "deck" },
  { p: [-6, 0.15, -15.4], s: [9, 0.3, 0.6], color: "#8d7a5e" },
  // A shed at the back of the yard, with its own door.
  { p: [-12, 1.3, -22], s: [0.3, 2.6, 4], color: "#7d7361" },
  { p: [-9.5, 1.3, -24], s: [5.3, 2.6, 0.3], color: "#7d7361" },
  { p: [-7, 1.3, -22], s: [0.3, 2.6, 4], color: "#7d7361" },
  { p: [-11.3, 1.3, -20], s: [1.7, 2.6, 0.3], color: "#7d7361" },
  { p: [-7.85, 1.3, -20], s: [2.2, 2.6, 0.3], color: "#7d7361" },
  { p: [-9.7, 2.4, -20], s: [1.6, 0.4, 0.3], color: "#7d7361" },
  { p: [-9.5, 2.75, -22], s: [5.6, 0.3, 4.6], color: "#6a6152" },
  // A hoop worth throwing a ball at: backboard, posts, and a ring you can rattle.
  { p: [5, 3.3, -24.2], s: [3, 1.8, 0.16], color: "#e7dfc8" },
  { p: [3.6, 1.65, -24.45], s: [0.2, 3.3, 0.2], color: "#5d6a5a" },
  { p: [6.4, 1.65, -24.45], s: [0.2, 3.3, 0.2], color: "#5d6a5a" },
  ...Array.from({ length: 10 }, (_, i): Box => {
    const a = (i / 10) * Math.PI * 2;
    return {
      p: [5 + Math.cos(a) * 0.46, 2.6, -23.45 + Math.sin(a) * 0.46],
      s: [0.2, 0.1, 0.2],
      color: "#d0603f",
      kind: "hoop",
    };
  }),
];
/** Sliding leaves. Ids are independent of prop ids; both are validated server-side. */
export const DOORS: Door[] = [
  {
    id: 1,
    p: [13.65, 1.5, -0.8],
    s: [0.24, 3, 1.6],
    slide: [0, 0, -1.62],
    color: "#93a898",
    auto: true,
    zone: "The workshop",
  },
  {
    id: 2,
    p: [13.65, 1.5, 0.8],
    s: [0.24, 3, 1.6],
    slide: [0, 0, 1.62],
    color: "#93a898",
    auto: true,
    zone: "The workshop",
  },
  {
    id: 3,
    p: [2.63, 1.3, -10.65],
    s: [1.25, 2.6, 0.22],
    slide: [-1.3, 0, 0],
    color: "#a2704e",
    zone: "The yard",
  },
  {
    id: 4,
    p: [3.88, 1.3, -10.65],
    s: [1.25, 2.6, 0.22],
    slide: [1.3, 0, 0],
    color: "#a2704e",
    zone: "The yard",
  },
  {
    id: 5,
    p: [-9.7, 1.1, -19.8],
    s: [1.6, 2.2, 0.18],
    slide: [-1.68, 0, 0],
    color: "#8a5f42",
    zone: "The shed",
  },
  {
    id: 6,
    p: [23.65, 1.6, -5.7],
    s: [0.2, 3.2, 1.6],
    slide: [0, 0, 1.68],
    color: "#8d9aa6",
    zone: "The back room",
  },
];
export const SPAWNS = [
  [0, 1, 5],
  [-2, 1, 5],
  [2, 1, 5],
  [0, 1, 7],
  [-3, 1, 3],
  [3, 1, 3],
  [-4, 1, 5],
  [2, 1, 7],
];
export const PROPS: Prop[] = [
  { p: [-2, 0.5, -1], kind: "crate" },
  { p: [0, 0.5, -2], kind: "crate" },
  { p: [2, 0.5, -1], kind: "crate" },
  { p: [-1, 0.5, 1], kind: "crate" },
  { p: [9, 1.8, -9], kind: "crate" },
  { p: [12, 0.5, 2], kind: "crate" },
  { p: [10, 0.5, 3], kind: "ball" },
  { p: [0, 0.5, -6], kind: "crate" },
  { p: [18, 1.2, -6], kind: "gun" },
  { p: [28.9, 1.7, -6], kind: "gun" },
  { p: [11.9, 3.1, -5.5], kind: "gun" },
  { p: [5, 0.6, -18], kind: "ball" },
  { p: [7.5, 0.6, -21], kind: "ball" },
  { p: [21, 0.9, 5.5], kind: "crate" },
  { p: [-9.5, 0.5, -22], kind: "crate" },
  { p: [-6, 1, -13.4], kind: "gun" },
];
export const PROP_STARTS = PROPS.map((p) => p.p);
export const propKind = (id: number): PropKind | undefined =>
  PROPS[id - 1]?.kind;
export const PALETTE = [
  "#d9a261",
  "#7c9e89",
  "#c87e66",
  "#91a9b3",
  "#b3a0be",
  "#d3c170",
  "#82a8a2",
  "#c78fa0",
];
export const STEP = 1 / 60;
export const MAX_PLAYERS = 8;
/** Seconds for a leaf to travel, and how close an automatic door watches for. */
export const DOOR_TRAVEL = 0.9;
export const AUTO_RANGE = 3.4;
/** No health and no death: a hit is a shove and a moment of lost footing. */
export const WEAPON = {
  range: 42,
  cooldown: 20,
  knock: 9.5,
  lift: 5,
  recoil: 1.8,
  stagger: 26,
  /** How much of your own steering survives while staggered. */
  control: 0.12,
};
export const VOICE = {
  refDistance: 2,
  maxDistance: 22,
  rolloff: 1.25,
  distanceModel: "inverse" as const,
};
