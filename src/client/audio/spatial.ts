import { VOICE, type Vec3 } from "../../shared/level";
import { REVERB_REGIONS, regionWeights } from "../../shared/acoustics";
export type Emitter = {
  input: GainNode;
  panner: PannerNode;
  range: GainNode;
  dry: GainNode;
  sends: Map<string, GainNode>;
  position: Vec3;
  dispose: () => void;
};
/** One synthesized voice per event: a tone that falls or rises, plus filtered noise. */
type EffectSpec = {
  volume: number;
  duration: number;
  from: number;
  to: number;
  noise: number;
  cutoff: number;
  type?: OscillatorType;
};
const EFFECTS: Record<string, EffectSpec> = {
  step: { volume: 0.1, duration: 0.095, from: 105, to: 42, noise: 0.9, cutoff: 650 },
  "step-soft": { volume: 0.04, duration: 0.095, from: 105, to: 42, noise: 0.9, cutoff: 650 },
  jump: { volume: 0.13, duration: 0.2, from: 210, to: 460, noise: 0.3, cutoff: 1800 },
  pickup: { volume: 0.16, duration: 0.18, from: 420, to: 680, noise: 0.3, cutoff: 650 },
  shoot: { volume: 0.3, duration: 0.17, from: 820, to: 70, noise: 1.1, cutoff: 3200, type: "triangle" },
  swing: { volume: 0.18, duration: 0.16, from: 340, to: 95, noise: 0.8, cutoff: 1400 },
  hit: { volume: 0.3, duration: 0.26, from: 220, to: 38, noise: 0.7, cutoff: 700 },
  bounce: { volume: 0.17, duration: 0.13, from: 470, to: 140, noise: 0.22, cutoff: 1300 },
  door: { volume: 0.12, duration: 0.55, from: 120, to: 80, noise: 0.45, cutoff: 420 },
  default: { volume: 0.16, duration: 0.18, from: 180, to: 60, noise: 0.3, cutoff: 650 },
};
export class SpatialAudio {
  context: AudioContext;
  master: GainNode;
  convolvers = new Map<string, ConvolverNode>();
  emitters = new Set<Emitter>();
  zone = 0;
  private noise: AudioBuffer;
  private horn?: AudioBuffer;
  constructor() {
    this.context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });
    const c = this.context;
    // Original deterministic noise, synthesized here; no recordings or third-party samples.
    this.noise = c.createBuffer(
      1,
      Math.ceil(c.sampleRate * 0.22),
      c.sampleRate,
    );
    const samples = this.noise.getChannelData(0);
    let seed = 7319;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296) * 2 - 1;
    }
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -5;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(c.destination);
    for (const region of REVERB_REGIONS) {
      const convolver = c.createConvolver();
      convolver.connect(this.master);
      this.convolvers.set(region.id, convolver);
    }
  }
  async init() {
    await Promise.all([
      ...REVERB_REGIONS.map(async (region) => {
        const response = await fetch(
          new URL(region.impulse, document.baseURI),
        );
        this.convolvers.get(region.id)!.buffer =
          await this.context.decodeAudioData(await response.arrayBuffer());
      }),
      fetch(new URL("audio/horn.ogg", document.baseURI))
        .then((response) => response.arrayBuffer())
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => (this.horn = buffer)),
    ]);
  }
  emitter(): Emitter {
    const c = this.context,
      input = c.createGain(),
      panner = c.createPanner(),
      range = c.createGain(),
      dry = c.createGain();
    const sends = new Map<string, GainNode>();
    panner.panningModel = "HRTF";
    panner.distanceModel = VOICE.distanceModel;
    panner.refDistance = VOICE.refDistance;
    panner.maxDistance = VOICE.maxDistance;
    panner.rolloffFactor = VOICE.rolloff;
    input.connect(panner).connect(range);
    range.connect(dry).connect(this.master);
    for (const [id, convolver] of this.convolvers) {
      const gain = c.createGain();
      gain.gain.value = 0;
      range.connect(gain).connect(convolver);
      sends.set(id, gain);
    }
    const e: Emitter = {
      input,
      panner,
      range,
      dry,
      sends,
      position: { x: 0, y: 0, z: 0 },
      dispose: () => {
        for (const n of [input, panner, range, dry, ...sends.values()])
          n.disconnect();
        this.emitters.delete(e);
      },
    };
    this.emitters.add(e);
    return e;
  }
  update(listener: Vec3, yaw: number, pitch: number) {
    const c = this.context,
      t = c.currentTime,
      l = c.listener;
    const values = [
      l.positionX,
      l.positionY,
      l.positionZ,
      l.forwardX,
      l.forwardY,
      l.forwardZ,
      l.upX,
      l.upY,
      l.upZ,
    ];
    const sin = Math.sin,
      cos = Math.cos;
    const v = [
      listener.x,
      listener.y,
      listener.z,
      -sin(yaw) * cos(pitch),
      -sin(pitch),
      -cos(yaw) * cos(pitch),
      -sin(yaw) * sin(pitch),
      cos(pitch),
      -cos(yaw) * sin(pitch),
    ];
    values.forEach((p, i) => p.setTargetAtTime(v[i], t, 0.015));
    const listenerWeights = regionWeights(listener);
    this.zone = listenerWeights.get("hall") ?? 0;
    for (const e of this.emitters) {
      e.panner.positionX.setTargetAtTime(e.position.x, t, 0.015);
      e.panner.positionY.setTargetAtTime(e.position.y, t, 0.015);
      e.panner.positionZ.setTargetAtTime(e.position.z, t, 0.015);
      const d = Math.hypot(
          e.position.x - listener.x,
          e.position.y - listener.y,
          e.position.z - listener.z,
        ),
        fade = Math.max(0, Math.min(1, (VOICE.maxDistance - d) / 3));
      e.range.gain.setTargetAtTime(fade, t, 0.03);
      const speakerWeights = regionWeights(e.position);
      const overlap = REVERB_REGIONS.reduce(
        (sum, region) =>
          sum +
          Math.min(
            listenerWeights.get(region.id) ?? 0,
            speakerWeights.get(region.id) ?? 0,
          ),
        0,
      );
      for (const region of REVERB_REGIONS)
        e.sends
          .get(region.id)!
          .gain.setTargetAtTime(
            (listenerWeights.get(region.id) ?? 0) *
              region.wet *
              (0.5 + 0.5 * overlap),
            t,
            0.08,
          );
      e.dry.gain.value = 1;
    }
  }
  effect(position: Vec3, kind: string) {
    if (this.context.state !== "running") return;
    const e = this.emitter();
    e.position = { ...position };
    const c = this.context;
    if (kind === "honk" && this.horn) {
      const source = c.createBufferSource(),
        gain = c.createGain();
      source.buffer = this.horn;
      gain.gain.value = 0.72;
      source.connect(gain).connect(e.input);
      source.start();
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        setTimeout(() => e.dispose(), 2000);
      };
      return;
    }
    const
      o = c.createOscillator(),
      g = c.createGain();
    const { volume, duration, from, to, noise, cutoff, type } =
      EFFECTS[kind] ?? EFFECTS.default;
    o.type = type ?? "sine";
    o.frequency.setValueAtTime(from, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, c.currentTime + duration);
    g.gain.setValueAtTime(0.001, c.currentTime);
    g.gain.linearRampToValueAtTime(volume, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g).connect(e.input);
    const scuff = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      rustle = c.createGain();
    scuff.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    rustle.gain.setValueAtTime(volume * noise, c.currentTime);
    rustle.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    scuff.connect(filter).connect(rustle).connect(e.input);
    scuff.start();
    scuff.stop(c.currentTime + duration);
    o.start();
    o.stop(c.currentTime + duration + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
      scuff.disconnect();
      filter.disconnect();
      rustle.disconnect();
      setTimeout(() => e.dispose(), 2000);
    };
  }
}
