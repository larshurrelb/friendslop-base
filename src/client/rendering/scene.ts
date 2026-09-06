import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { DOORS, LEVEL, PALETTE, PROPS } from "../../shared/level";
import type { DoorState } from "../../shared/simulation";
import type { PlayerState, PropState } from "../../shared/protocol";
type Avatar = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  label: HTMLDivElement;
  driven: Driven[];
  armL?: Driven;
  armR?: Driven;
  head?: Driven;
  jaw?: Driven;
  loudness: number;
  speaking: boolean;
  mouth: number;
};
/** A bone the runtime aims by hand, plus the pose the mixer last gave it. */
type Driven = { bone: THREE.Object3D; posed: THREE.Quaternion };
const MOUTH_OPEN = 0.5;
const HEAD_TILT = 0.55;
const HOLD_LIFT = -1.1;
const HINGE_AXIS = new THREE.Vector3(1, 0, 0);
const spin = new THREE.Quaternion();
function driven(character: THREE.Object3D, name: string): Driven | undefined {
  const bone = character.getObjectByName(name);
  return bone && { bone, posed: bone.quaternion.clone() };
}
/**
 * Hand off to the mixer and take the result back. The mixer skips writing a track whose
 * value has not changed since the last frame, so a bone we aimed ourselves would come back
 * still carrying our offset; putting its last mixer pose back first keeps offsets from
 * compounding into an endless spin.
 */
function repose(a: Avatar, dt: number) {
  for (const d of a.driven) d.bone.quaternion.copy(d.posed);
  a.mixer.update(dt);
  for (const d of a.driven) d.posed.copy(d.bone.quaternion);
}
/**
 * Turn a bone about its own X axis, on top of the pose the mixer gave it. These bones have
 * non-identity rest rotations, so assigning `rotation.x` would compose the offset against a
 * stale Euler decomposition and swing the limb the wrong way.
 */
function hinge(d: Driven | undefined, angle: number) {
  d?.bone.quaternion
    .copy(d.posed)
    .multiply(spin.setFromAxisAngle(HINGE_AXIS, angle));
}
/** Jittery 0..1 babble, used when a speaker's level cannot be metered locally. */
function chatter(t: number, seed: number) {
  return Math.min(
    1,
    Math.abs(
      Math.sin(t * 13.1 + seed) *
        Math.sin(t * 7.7 + seed * 1.7) *
        Math.sin(t * 3.3 + seed * 0.4),
    ) * 1.9,
  );
}
export class GameScene {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(68, 1, 0.04, 100);
  props = new Map<number, THREE.Group>();
  doors = new Map<number, THREE.Group>();
  /** Muzzle flashes, tracers and impact sparks; they fade out and delete themselves. */
  effects: { mesh: THREE.Mesh; life: number; ttl: number; shrink: boolean }[] = [];
  avatars = new Map<number, Avatar>();
  asset?: GLTF;
  playing = false;
  front: THREE.Object3D[] = [];
  highlight = 0;
  labels: HTMLDivElement;
  clock = 0;
  loaded: Promise<void>;
  preview: THREE.Group[] = [];
  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor("#f0f4ee");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "world-labels";
    container.append(this.labels);
    this.scene.fog = new THREE.Fog("#f0f4ee", 25, 65);
    this.scene.add(new THREE.HemisphereLight("#f6eedb", "#728078", 2.3));
    const sun = new THREE.DirectionalLight("#fff1c8", 3.2);
    sun.position.set(-3, 19, -13);
    sun.target.position.set(6, 0, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // The room, the hall, the workshop and the yard all sit under one shadow camera.
    sun.shadow.camera.left = -32;
    sun.shadow.camera.right = 32;
    sun.shadow.camera.top = 32;
    sun.shadow.camera.bottom = -32;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    for (const b of LEVEL) {
      const mesh = this.box(b.p, b.s, b.color);
      if (b.hide) this.front.push(mesh);
    }
    // Floorboard seams, room divider, and practical fixtures are inexpensive geometry.
    for (let x = -13.5; x < 14; x += 0.7)
      this.box([x, 0.008, 0], [0.013, 0.012, 21.6], "#9f927d");
    const rug = this.box([-8.5, 0.02, -5.8], [7, 0.025, 5.2], "#b45c41");
    for (let i = 0; i < 5; i++)
      this.box([-8.5, 0.04, -7.5 + i * 0.8], [6.5, 0.01, 0.035], "#dbb087");
    for (const x of [-10, -4, 2, 8]) {
      this.box([x, 5.55, 0], [0.18, 0.24, 22], "#756c57");
      const lamp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.55, 0.25, 12),
        new THREE.MeshStandardMaterial({
          color: "#d4d5b7",
          emissive: "#a5a97e",
          emissiveIntensity: 0.35,
        }),
      );
      lamp.position.set(x, 4.7, -1);
      this.scene.add(lamp);
      this.box([x, 5.1, -1], [0.035, 0.7, 0.035], "#3a4840");
    }
    for (const x of [-10, -5, 0]) {
      this.box([x, 3.05, -10.75], [3.8, 2.5, 0.08], "#93ada1");
      this.box([x, 3.05, -10.65], [0.08, 2.6, 0.14], "#e9e2cc");
      this.box([x, 3.05, -10.65], [3.9, 0.08, 0.14], "#e9e2cc");
      this.box([x, 1.75, -10.5], [4, 0.15, 0.45], "#e6ddc5");
    }
    this.sign(
      "THE COMMON ROOM",
      [-4, 2.3, -10.46],
      4.1,
      0.5,
      "#405b4d",
      "#e5deca",
    );
    this.sign(
      "01  /  GATHER",
      [-9, 3.2, 10.76],
      4,
      0.7,
      "#4b6152",
      "#d7cfbc",
      Math.PI,
    );
    this.sign(
      "02  /  THE HALL",
      [5.23, 3.9, 0],
      3,
      0.45,
      "#edebd7",
      "#678276",
      Math.PI / 2,
    );
    this.sign(
      "MAKE SOMETHING\nWITH YOUR FRIENDS.",
      [-13.76, 2.6, -2],
      3.6,
      1.5,
      "#455a4b",
      "#c2b18c",
      Math.PI / 2,
    );
    for (const p of [
      [-12.3, 0, -9.2],
      [-12.4, 0, 5],
      [3.7, 0, -9],
      [12.5, 0, 8],
    ])
      this.plant(p[0], p[2]);
    this.box([-0.3, 0.04, 3.8], [4, 0.035, 0.06], "#e6dcc7");
    this.box([-2.3, 0.04, 4.8], [0.06, 0.035, 2], "#e6dcc7");
    this.box([1.7, 0.04, 4.8], [0.06, 0.035, 2], "#e6dcc7");
    const board = this.box([-3, 1.65, 8.5], [2.4, 2.8, 0.15], "#556c5b");
    this.box([-4, 0.7, 8.5], [0.09, 1.4, 0.3], "#6c5c46");
    this.box([-2, 0.7, 8.5], [0.09, 1.4, 0.3], "#6c5c46");
    this.sign(
      "A LITTLE SPACE\nFOR BIG NONSENSE",
      [-3, 1.8, 8.39],
      2,
      1.1,
      "#ede5cc",
      "#556c5b",
      Math.PI,
    );
    this.workshop();
    this.yard();
    PROPS.forEach((prop, i) => {
      const root = this.makeProp(i);
      root.position.set(...prop.p);
      this.props.set(i + 1, root);
      this.scene.add(root);
    });
    for (const def of DOORS) {
      const leaf = new THREE.Group();
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(...def.s),
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 }),
      );
      panel.castShadow = true;
      panel.receiveShadow = true;
      leaf.add(panel);
      // A handle on the long face, so a shut leaf reads as something to open.
      const across = def.s[0] > def.s[2];
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(
          across ? 0.09 : def.s[0] + 0.06,
          0.5,
          across ? def.s[2] + 0.06 : 0.09,
        ),
        new THREE.MeshStandardMaterial({
          color: "#2f3a34",
          roughness: 0.4,
          metalness: 0.5,
        }),
      );
      handle.position.set(
        across ? (def.slide[0] > 0 ? -def.s[0] / 2 + 0.22 : def.s[0] / 2 - 0.22) : 0,
        0,
        across ? 0 : def.slide[2] > 0 ? -def.s[2] / 2 + 0.22 : def.s[2] / 2 - 0.22,
      );
      leaf.add(handle);
      leaf.position.set(...def.p);
      this.doors.set(def.id, leaf);
      this.scene.add(leaf);
    }
    this.loaded = new GLTFLoader()
      .loadAsync("/models/common-worker.glb")
      .then((asset) => {
        this.asset = asset;
        for (const [i, p] of [
          [-2, 0, -1],
          [1, 0, -3],
          [8, 0, 1],
        ].entries()) {
          const a = this.avatar(60000 + i, "", i);
          a.root.position.set(...(p as [number, number, number]));
          a.root.rotation.y = i === 1 ? 1.6 : -0.5;
          a.label.style.display = "none";
          this.preview.push(a.root);
        }
      });
    addEventListener("resize", () => this.resize());
    this.resize();
    this.overview(0);
  }
  box(p: number[], s: number[], color: string) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...(s as [number, number, number])),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    m.position.set(...(p as [number, number, number]));
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }
  sign(
    text: string,
    p: number[],
    w: number,
    h: number,
    ink: string,
    bg: string,
    rotation = 0,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const c = canvas.getContext("2d")!;
    c.fillStyle = bg;
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "600 64px monospace";
    const lines = text.split("\n");
    lines.forEach((line, i) =>
      c.fillText(line, 512, 256 + (i - (lines.length - 1) / 2) * 95, 970),
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
    );
    mesh.position.set(...(p as [number, number, number]));
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
  }
  plant(x: number, z: number) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.27, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: "#b97554" }),
    );
    pot.position.set(x, 0.3, z);
    pot.castShadow = true;
    this.scene.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? "#647b49" : "#7a9158",
        }),
      );
      leaf.scale.set(0.5, 1.3, 0.55);
      leaf.position.set(
        x + Math.sin(i * 2.4) * 0.25,
        0.8 + (i % 3) * 0.24,
        z + Math.cos(i * 2.4) * 0.25,
      );
      leaf.rotation.z = Math.sin(i) * 0.5;
      leaf.castShadow = true;
      this.scene.add(leaf);
    }
  }
  /** Decoration for the workshop east of the hall. Geometry only, no colliders. */
  workshop() {
    for (const z of [-6, 0, 6]) this.box([22, 5.5, z], [16, 0.22, 0.2], "#8d8069");
    for (const [x, z] of [
      [17, -8.6],
      [22, -8.6],
      [26.5, -1.6],
    ]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.16, 0.5),
        new THREE.MeshStandardMaterial({
          color: "#e6e3c8",
          emissive: "#c9c38c",
          emissiveIntensity: 0.5,
        }),
      );
      lamp.position.set(x, 4.3, z);
      this.scene.add(lamp);
    }
    // A pegboard of tool silhouettes over the bench.
    this.box([18, 2.6, -8.7], [6.4, 2.4, 0.1], "#7d8f86");
    for (let i = 0; i < 9; i++)
      this.box(
        [15.4 + i * 0.65, 2.4 + (i % 3) * 0.55, -8.62],
        [i % 2 ? 0.12 : 0.34, i % 2 ? 0.9 : 0.16, 0.06],
        "#3f4a44",
      );
    for (let i = 0; i < 4; i++)
      this.box([16.2 + i * 1.2, 1.02, -6], [0.5, 0.24, 0.9], "#4d5a52");
    // The mezzanine reading corner, and a lamp over the stair head.
    this.box([10.6, 3.05, -4.4], [1.2, 0.45, 1.6], "#6d5c44");
    this.box([10.6, 3.35, -3.55], [1.2, 0.6, 0.14], "#6d5c44");
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.42, 0.22, 12),
      new THREE.MeshStandardMaterial({
        color: "#d4d5b7",
        emissive: "#a5a97e",
        emissiveIntensity: 0.4,
      }),
    );
    glow.position.set(12, 4.5, -6.5);
    this.scene.add(glow);
    this.box([12, 5.15, -6.5], [0.035, 1.1, 0.035], "#3a4840");
    this.sign(
      "05  /  THE MEZZANINE",
      [9.73, 3.45, -5.7],
      2.6,
      0.4,
      "#edebd7",
      "#4e5f56",
      -Math.PI / 2,
    );
    this.sign(
      "03  /  THE WORKSHOP",
      [13.55, 3.75, 0],
      3,
      0.45,
      "#edebd7",
      "#4e5f56",
      -Math.PI / 2,
    );
    this.sign(
      "TAKE ONE.\nMIND THE WINDOWS.",
      [24.2, 3.1, -5.7],
      1.5,
      0.9,
      "#e8e2cc",
      "#5a6670",
      Math.PI / 2,
    );
    this.sign(
      "EVERYTHING HERE\nIS A LOAN.",
      [29.76, 2.8, 3],
      3.4,
      1.4,
      "#4a5a52",
      "#c8bfa6",
      -Math.PI / 2,
    );
    for (const p of [
      [15.5, 0, 8],
      [29, 0, 7.5],
    ])
      this.plant(p[0], p[2]);
  }
  /** Decoration for the yard: paint, planting, lights and a backboard. */
  yard() {
    for (const z of [-13.2, -22.8])
      this.box([5, 0.07, z], [11.6, 0.02, 0.1], "#f2ece0");
    for (const x of [-0.8, 10.8])
      this.box([x, 0.07, -18], [0.1, 0.02, 9.6], "#f2ece0");
    this.box([5, 0.07, -18], [11.6, 0.02, 0.1], "#f2ece0");
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.box(
        [5 + Math.cos(a) * 2.6, 0.07, -18 + Math.sin(a) * 2.6],
        [0.16, 0.02, 0.16],
        "#f2ece0",
      );
    }
    for (const [x, z] of [
      [-11.5, -13.5],
      [11.5, -13.5],
      [-11.5, -24.5],
      [11.5, -25],
    ]) {
      this.box([x, 0.3, z], [2.2, 0.6, 2.2], "#a4795a");
      this.plant(x, z + 0.1);
    }
    // Festoon lights strung between the yard walls.
    for (let i = 0; i <= 14; i++) {
      const x = -12 + i * 1.72,
        sag = Math.sin((i / 14) * Math.PI) * 0.5;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({
          color: "#fdf3d0",
          emissive: "#f0dfa0",
          emissiveIntensity: 0.9,
        }),
      );
      bulb.position.set(x, 2.9 - sag, -14.5);
      this.scene.add(bulb);
      this.box([x, 3.02 - sag, -14.5], [1.75, 0.02, 0.02], "#5a5c50");
    }
    for (let i = 0; i < 40; i++) {
      const x = -12 + ((i * 7.31) % 24),
        z = -25.5 + ((i * 4.13) % 13);
      if (x > -1.6 && x < 11.6 && z > -23.8 && z < -12.2) continue;
      const tuft = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.42, 5),
        new THREE.MeshStandardMaterial({ color: i % 3 ? "#7f9463" : "#93a86f" }),
      );
      tuft.position.set(x, 0.21, z);
      tuft.rotation.y = i;
      this.scene.add(tuft);
    }
    this.box([-6, 0.95, -12.9], [9, 0.1, 0.12], "#6d5c44");
    this.sign(
      "04  /  THE YARD",
      [3.25, 3.9, -10.46],
      3.4,
      0.5,
      "#405b4d",
      "#e5deca",
    );
    this.sign(
      "04  /  THE YARD",
      [3.25, 3.6, -11.24],
      3.4,
      0.5,
      "#e5deca",
      "#4b6152",
      Math.PI,
    );
    this.sign(
      "MIND THE\nBOUNCE.",
      [0, 1.7, -25.76],
      3,
      1.2,
      "#48594c",
      "#cfc7b2",
    );
    this.sign(
      "06  /  THE SHED",
      [-9.7, 2.1, -19.68],
      2.4,
      0.4,
      "#efe7cf",
      "#6a5240",
    );
  }
  /** Children[0] is always the tintable body: `setHighlight` writes its emissive. */
  makeProp(i: number) {
    const root = new THREE.Group(),
      kind = PROPS[i].kind;
    if (kind === "ball") {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 24, 16),
        new THREE.MeshStandardMaterial({
          color: PALETTE[i % 8],
          roughness: 0.45,
        }),
      );
      ball.castShadow = true;
      ball.receiveShadow = true;
      root.add(ball);
      for (const axis of [0, 1]) {
        const seam = new THREE.Mesh(
          new THREE.TorusGeometry(0.301, 0.022, 8, 32),
          new THREE.MeshStandardMaterial({ color: "#f4ecd8", roughness: 0.6 }),
        );
        if (axis === 0) seam.rotation.x = Math.PI / 2;
        else seam.rotation.y = Math.PI / 2;
        root.add(seam);
      }
      return root;
    }
    if (kind === "gun") {
      // Modelled pointing down -z, which is where its holder is looking.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.16, 0.56),
        new THREE.MeshStandardMaterial({
          color: "#414b54",
          roughness: 0.45,
          metalness: 0.45,
        }),
      );
      body.castShadow = true;
      root.add(body);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10),
        new THREE.MeshStandardMaterial({
          color: "#2b3238",
          roughness: 0.35,
          metalness: 0.6,
        }),
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.42);
      barrel.castShadow = true;
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.28, 0.13),
        new THREE.MeshStandardMaterial({ color: "#6b5137", roughness: 0.8 }),
      );
      grip.position.set(0, -0.2, 0.14);
      grip.rotation.x = -0.22;
      grip.castShadow = true;
      const sight = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.2),
        new THREE.MeshStandardMaterial({
          color: PALETTE[i % 8],
          roughness: 0.6,
        }),
      );
      sight.position.set(0, 0.11, -0.02);
      root.add(barrel, grip, sight);
      return root;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE[i % 8],
      roughness: 0.8,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat);
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
    for (const axis of [0, 2]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === 0 ? 0.12 : 0.61,
          0.615,
          axis === 2 ? 0.12 : 0.61,
        ),
        new THREE.MeshStandardMaterial({ color: "#ece0bc", roughness: 0.9 }),
      );
      root.add(strap);
    }
    return root;
  }
  /** Slide the visible leaves to match the physics doors the simulation owns. */
  updateDoors(states: DoorState[]) {
    for (const s of states) {
      const leaf = this.doors.get(s.id),
        def = DOORS.find((d) => d.id === s.id);
      if (!leaf || !def) continue;
      const e = s.progress * s.progress * (3 - 2 * s.progress);
      leaf.position.set(
        def.p[0] + def.slide[0] * e,
        def.p[1] + def.slide[1] * e,
        def.p[2] + def.slide[2] * e,
      );
    }
  }
  private spark(
    color: string,
    size: number,
    position: THREE.Vector3,
    ttl: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0, ttl, shrink: true });
  }
  /** One shot: muzzle flash, a fading tracer, and a spark where it landed. */
  tracer(shot: {
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    dz: number;
    distance: number;
    hit: number;
  }) {
    const eye = new THREE.Vector3(shot.x, shot.y, shot.z),
      direction = new THREE.Vector3(shot.dx, shot.dy, shot.dz).normalize();
    // Start at the muzzle rather than the eye, using the same offsets the
    // simulation carries a gun at, so the flash is not inside your own face.
    const span = Math.max(0.001, Math.hypot(direction.x, direction.z)),
      right = new THREE.Vector3(-direction.z / span, 0, direction.x / span);
    const origin = eye
      .clone()
      .addScaledVector(direction, 0.55)
      .addScaledVector(right, 0.28)
      .setY(eye.y - 0.18 + direction.y * 0.55);
    const length = Math.max(0.5, shot.distance - 0.55);
    const geometry = new THREE.CylinderGeometry(0.013, 0.005, length, 6, 1, true);
    geometry.translate(0, -length / 2, 0);
    const beam = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#ffe6a6",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.copy(origin);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    this.scene.add(beam);
    this.effects.push({ mesh: beam, life: 0, ttl: 0.18, shrink: false });
    this.spark("#fff2c4", 0.085, origin, 0.06);
    this.spark(
      shot.hit ? "#ffc4a8" : "#e9e3cf",
      shot.hit ? 0.28 : 0.13,
      eye.clone().addScaledVector(direction, shot.distance),
      shot.hit ? 0.24 : 0.16,
    );
  }
  avatar(id: number, name: string, color = id - 1) {
    if (this.avatars.has(id)) {
      this.avatars.get(id)!.label.textContent = name;
      return this.avatars.get(id)!;
    }
    const root = new THREE.Group();
    const character = this.asset ? clone(this.asset.scene) : new THREE.Group();
    character.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const clonedMaterials = mats.map((m) => {
          const copy = m.clone();
          if (m.name.startsWith("Jacket"))
            (copy as THREE.MeshStandardMaterial).color.set(PALETTE[color % 8]);
          return copy;
        });
        o.material = Array.isArray(o.material)
          ? clonedMaterials
          : clonedMaterials[0];
      }
    });
    root.add(character);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(character),
      actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.asset?.animations ?? [])
      actions.set(clip.name.split("|").at(-1)!, mixer.clipAction(clip));
    const idle = [...actions.entries()].find(([n]) => n.includes("Idle"));
    idle?.[1].play();
    const label = document.createElement("div");
    label.className = "player-label";
    label.textContent = name;
    this.labels.append(label);
    const avatar: Avatar = {
      root,
      mixer,
      actions,
      current: idle?.[0] ?? "",
      label,
      driven: [],
      armL: driven(character, "armL"),
      armR: driven(character, "armR"),
      head: driven(character, "head"),
      jaw: driven(character, "jaw"),
      loudness: -1,
      speaking: false,
      mouth: 0,
    };
    avatar.driven = [avatar.armL, avatar.armR, avatar.head, avatar.jaw].filter(
      (d) => d !== undefined,
    );
    this.avatars.set(id, avatar);
    return avatar;
  }
  setPlaying(playing: boolean) {
    this.playing = playing;
    for (const m of this.front) m.visible = playing;
    for (const p of this.preview) p.visible = !playing;
  }
  overview(t: number) {
    if (this.playing) return;
    this.camera.position.set(24 + Math.sin(t * 0.08) * 0.6, 21, 27);
    this.camera.lookAt(2, 0, -3);
    for (const m of this.front) m.visible = false;
  }
  updatePlayer(s: PlayerState, name: string, dt: number, color = s.id - 1) {
    const a = this.avatar(s.id, name, color);
    a.root.position.set(s.x, s.y - (s.flags & 2 ? 0.5 : 0.85), s.z);
    a.root.rotation.y = s.yaw + Math.PI;
    const speed = Math.hypot(s.vx, s.vz),
      desired = !(s.flags & 1)
        ? "Jump"
        : s.flags & 2
          ? "Crouch"
          : speed > 0.15
            ? s.flags & 4
              ? "Sprint"
              : "Walk"
            : "Idle";
    const action = [...a.actions.entries()].find(([name]) =>
      name.includes(desired),
    );
    if (action && action[0] !== a.current) {
      a.actions.get(a.current)?.fadeOut(0.15);
      action[1].reset().fadeIn(0.15).play();
      a.current = action[0];
    }
    if (action)
      action[1].timeScale = desired === "Crouch" && speed < 0.15 ? 0 : 1;
    repose(a, dt);
    // Aim the runtime-driven bones on top of the pose the mixer just wrote.
    hinge(a.head, Math.max(-1.2, Math.min(1.2, s.pitch)) * HEAD_TILT);
    if (s.held) {
      hinge(a.armL, HOLD_LIFT);
      hinge(a.armR, HOLD_LIFT);
    }
    return a;
  }
  removePlayer(id: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    a.label.remove();
    a.mixer.stopAllAction();
    this.avatars.delete(id);
  }
  speaking(id: number, on: boolean) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.label.classList.toggle("speaking", on);
    a.speaking = on;
  }
  /** Voice level for one player, or -1 when it cannot be metered; opens their mouth. */
  setMouth(id: number, loudness: number) {
    const a = this.avatars.get(id);
    if (a) a.loudness = loudness;
  }
  updateProps(props: PropState[]) {
    for (const p of props) {
      const m = this.props.get(p.id);
      if (!m) continue;
      m.position.set(p.x, p.y, p.z);
      m.quaternion.set(p.qx, p.qy, p.qz, p.qw).normalize();
    }
  }
  setHighlight(id: number) {
    if (id === this.highlight) return;
    for (const [key, group] of this.props) {
      const mat = (group.children[0] as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      mat.emissive.set(key === id ? "#a5c666" : "#000000");
      mat.emissiveIntensity = key === id ? 0.28 : 0;
    }
    this.highlight = id;
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  render(dt: number) {
    this.clock += dt;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += dt;
      const left = 1 - e.life / e.ttl;
      if (left <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        this.effects.splice(i, 1);
        continue;
      }
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = left;
      if (e.shrink) e.mesh.scale.setScalar(0.4 + left * 0.8);
    }
    if (!this.playing)
      for (const [id, a] of this.avatars) if (id >= 60000) repose(a, dt);
    for (const [id, a] of this.avatars) {
      // Lobby stand-ins natter to themselves; live players follow their own voice level,
      // falling back to babble for speakers this client cannot meter.
      const target =
        id >= 60000
          ? Math.max(0, Math.sin(this.clock * 0.55 + id * 2.1)) *
            chatter(this.clock, id)
          : a.loudness >= 0
            ? Math.min(1, Math.max(0, (a.loudness - 0.012) * 8))
            : a.speaking
              ? chatter(this.clock, id)
              : 0;
      a.mouth += (target - a.mouth) * Math.min(1, dt * 24);
      hinge(a.jaw, -a.mouth * MOUTH_OPEN);
    }
    for (const [id, a] of this.avatars) {
      if (id >= 60000) continue;
      const p = a.root.position
        .clone()
        .add(new THREE.Vector3(0, 1.95, 0))
        .project(this.camera);
      const visible =
        this.playing &&
        p.z < 1 &&
        p.z > -1 &&
        Math.abs(p.x) < 1 &&
        Math.abs(p.y) < 1;
      a.label.style.display = visible ? "block" : "none";
      a.label.style.transform = `translate(-50%,-100%) translate(${(p.x * 0.5 + 0.5) * innerWidth}px,${(-p.y * 0.5 + 0.5) * innerHeight}px)`;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
