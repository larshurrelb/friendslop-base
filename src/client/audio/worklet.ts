declare const sampleRate: number;
declare const currentTime: number;
declare abstract class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: typeof AudioWorkletProcessor,
): void;
class Capture extends AudioWorkletProcessor {
  chunk = new Float32Array(960);
  n = 0;
  phase = 0;
  last = 0;
  process(inputs: Float32Array[][]) {
    const data = inputs[0]?.[0];
    if (!data) return true;
    for (const value of data) {
      this.phase += 48000 / sampleRate;
      while (this.phase >= 1) {
        this.chunk[this.n++] = value;
        this.phase--;
        if (this.n === 960) {
          this.port.postMessage({ pcm: this.chunk, time: currentTime }, [
            this.chunk.buffer,
          ]);
          this.chunk = new Float32Array(960);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
class Playback extends AudioWorkletProcessor {
  ring = new Float32Array(16384);
  read = 0;
  write = 0;
  count = 0;
  playing = false;
  phase = 0;
  value = 0;
  target = 2880;
  underruns = 0;
  frames = 0;
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.reset) {
        this.count = 0;
        this.read = this.write;
        this.playing = false;
        return;
      }
      const pcm: Float32Array = e.data.pcm;
      if (!pcm) return;
      if (this.count + pcm.length > 5760) {
        this.read = this.write;
        this.count = 0;
        this.playing = false;
      }
      for (const v of pcm) {
        this.ring[this.write++ % this.ring.length] = v;
        this.count++;
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!this.playing && this.count >= this.target) this.playing = true;
    const correction =
      this.count > this.target + 960
        ? 1.01
        : this.count < this.target - 960
          ? 0.99
          : 1;
    for (let i = 0; i < out.length; i++) {
      if (!this.playing) {
        out[i] = 0;
        continue;
      }
      this.phase += (48000 / sampleRate) * correction;
      while (this.phase >= 1) {
        if (!this.count) {
          this.playing = false;
          this.underruns++;
          this.target = Math.min(5760, this.target + 240);
          this.value *= 0.9;
          break;
        }
        this.value = this.ring[this.read++ % this.ring.length];
        this.count--;
        this.phase--;
      }
      out[i] = this.playing ? this.value : 0;
    }
    if (++this.frames % 375 === 0) {
      this.port.postMessage({
        bufferMs: this.count / 48,
        underruns: this.underruns,
      });
      this.target = Math.max(1920, this.target - 48);
    }
    return true;
  }
}
registerProcessor("capture", Capture);
registerProcessor("playback", Playback);
