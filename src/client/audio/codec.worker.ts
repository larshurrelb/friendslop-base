import {
  createEncoder,
  createDecoder,
  Application,
  type OpusEncoderHandle,
  type OpusDecoderHandle,
} from "libopus-wasm";
const scope = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
let encoder: OpusEncoderHandle;
let native: any;
let timestamp = 0;
let encodeMode = "WASM Opus";
const pending = new Map<number, { gen: number; capturedAt: number }>();
const decoders = new Map<
  number,
  { decoder: OpusDecoderHandle; epoch: number; seq: number; time: number }
>();
let serial = Promise.resolve();
async function init(forceWasm = false) {
  encoder = await createEncoder({
    sampleRate: 48000,
    channels: 1,
    frameSize: 960,
    application: Application.Voip,
    bitrate: 24000,
    complexity: 5,
    dtx: false,
  });
  const A = (globalThis as any).AudioEncoder,
    D = (globalThis as any).AudioData;
  if (!forceWasm && A && D) {
    try {
      const config = {
        codec: "opus",
        sampleRate: 48000,
        numberOfChannels: 1,
        bitrate: 24000,
        opus: { format: "opus", frameDuration: 20000, application: "voip" },
      };
      if ((await A.isConfigSupported(config)).supported) {
        const testDecoder = await createDecoder({
          sampleRate: 48000,
          channels: 1,
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Codec probe timeout")),
            1500,
          );
          const probe = new A({
            output: (chunk: any) => {
              try {
                const bytes = new Uint8Array(chunk.byteLength);
                chunk.copyTo(bytes);
                const pcm = testDecoder.decodeFloat(bytes);
                if (pcm.length !== 960) throw Error("Unexpected frame size");
                clearTimeout(timer);
                probe.close();
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            error: reject,
          });
          probe.configure(config);
          const data = new D({
            format: "f32",
            sampleRate: 48000,
            numberOfFrames: 960,
            numberOfChannels: 1,
            timestamp: 0,
            data: new Float32Array(960),
          });
          probe.encode(data);
          data.close();
        });
        testDecoder.free();
        native = new A({
          output: (chunk: any) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            const capture = pending.get(chunk.timestamp);
            pending.delete(chunk.timestamp);
            scope.postMessage(
              {
                type: "encoded",
                payload: bytes,
                timestamp: Math.round(chunk.timestamp * 0.048),
                ...capture,
              },
              [bytes.buffer],
            );
          },
          error: () => {
            native = undefined;
            pending.clear();
            encodeMode = "WASM Opus";
            scope.postMessage({ type: "codec", mode: encodeMode });
          },
        });
        native.configure(config);
        encodeMode = "WebCodecs + WASM decode";
      }
    } catch {
      /* Always retain a tested libopus fallback. */
    }
  }
  const packet = encoder.encodeFloat(new Float32Array(960));
  const d = await createDecoder({ sampleRate: 48000, channels: 1 });
  if (d.decodeFloat(packet).length !== 960)
    throw Error("Opus self test failed");
  d.free();
  scope.postMessage({ type: "ready", mode: encodeMode });
}
scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    serial = init(m.forceWasm).catch((err) =>
      scope.postMessage({ type: "error", message: String(err) }),
    );
    return;
  }
  if (m.type === "encode") {
    if (performance.timeOrigin + performance.now() - m.capturedAt > 120) return;
    const pcm = m.pcm as Float32Array;
    timestamp += 20000;
    if (native) {
      if (native.encodeQueueSize > 3) return;
      pending.set(timestamp, { gen: m.gen, capturedAt: m.capturedAt });
      const data = new (globalThis as any).AudioData({
        format: "f32",
        sampleRate: 48000,
        numberOfFrames: 960,
        numberOfChannels: 1,
        timestamp,
        data: pcm,
      });
      native.encode(data);
      data.close();
    } else if (encoder) {
      const packet = encoder.encodeFloat(pcm);
      scope.postMessage(
        {
          type: "encoded",
          payload: packet,
          timestamp: Math.round(timestamp * 0.048),
          gen: m.gen,
          capturedAt: m.capturedAt,
        },
        [packet.buffer as ArrayBuffer],
      );
    }
    return;
  }
  if (m.type === "remove") {
    serial = serial.then(() => {
      decoders.get(m.id)?.decoder.free();
      decoders.delete(m.id);
    });
    return;
  }
  if (m.type === "decode") {
    serial = serial
      .then(async () => {
        let d = decoders.get(m.id);
        const now = performance.now();
        if (
          !d ||
          d.epoch !== m.epoch ||
          now - d.time > 300 ||
          m.seq - d.seq > 6
        ) {
          d?.decoder.free();
          d = {
            decoder: await createDecoder({ sampleRate: 48000, channels: 1 }),
            epoch: m.epoch,
            seq: m.seq - 1,
            time: now,
          };
          decoders.set(m.id, d);
          scope.postMessage({ type: "reset", id: m.id });
        }
        if (m.seq <= d.seq) return;
        for (let i = d.seq + 1; i < m.seq; i++) {
          const pcm = d.decoder.decodePacketLossFloat(960);
          scope.postMessage({ type: "pcm", id: m.id, pcm }, [
            pcm.buffer as ArrayBuffer,
          ]);
        }
        const pcm = d.decoder.decodeFloat(m.payload);
        if (pcm.length !== 960) throw Error("Unexpected audio frame");
        d.seq = m.seq;
        d.time = now;
        scope.postMessage({ type: "pcm", id: m.id, pcm }, [
          pcm.buffer as ArrayBuffer,
        ]);
      })
      .catch((err) =>
        scope.postMessage({
          type: "decode-error",
          id: m.id,
          message: String(err),
        }),
      );
  }
};
