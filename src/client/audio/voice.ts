import { DEFAULT_ICE } from "../../net/mode";
import { readVoice, voicePacket } from "../../shared/protocol";
import type { Channel } from "../../net/channel";
import { openSocket } from "../../net/ws-client";
import { SpatialAudio, type Emitter } from "./spatial";
import workletUrl from "./worklet.ts?worker&url";
import CodecWorker from "./codec.worker.ts?worker";
export type VoiceState =
  | "DIRECT_CONNECTING"
  | "DIRECT"
  | "DIRECT_SUSPECT"
  | "RELAY_PREPARING"
  | "RELAY"
  | "DIRECT_PROBING"
  | "UPGRADING"
  | "UNAVAILABLE";
type Peer = {
  id: number;
  generation: number;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  state: VoiceState;
  relay: boolean;
  forced: boolean;
  epoch: number;
  emitter: Emitter;
  meter: AnalyserNode;
  rms: number;
  direct: GainNode;
  relayed: GainNode;
  playback: AudioWorkletNode;
  audio?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  ice: RTCIceCandidateInit[];
  serial: Promise<void>;
  started: number;
  healthy: number;
  lastProbe: number;
  nextProbe: number;
  backoff: number;
  lastPacket: number;
  packets: number;
  lastPong: number;
  pcm: number;
  bufferMs: number;
  underruns: number;
  active: boolean;
  reason: string;
};
export class Voice {
  iceServers: RTCIceServer[] = DEFAULT_ICE;
  spatial?: SpatialAudio;
  worker?: Worker;
  stream?: MediaStream;
  socket?: Channel;
  /** Swapped for a host DataChannel in P2P mode. */
  openTransport: () => Promise<Channel> = () => openSocket("/voice");
  private transportGeneration = 0;
  peers = new Map<number, Peer>();
  members: { id: number; voiceReady: boolean; connected: boolean }[] = [];
  enabled = false;
  muted = false;
  mode: "open" | "ptt" = "open";
  talk = false;
  codec = "Not started";
  status = "Voice is off";
  sent = 0;
  received = 0;
  dropped = 0;
  level = 0;
  generation = 0;
  sequence = 0;
  epoch = crypto.getRandomValues(new Uint32Array(1))[0];
  speaking = false;
  lastSpeaking = 0;
  gate = false;
  private samples = new Float32Array(512);
  private timer?: ReturnType<typeof setInterval>;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private ticket = "";
  private room = "";
  private identity = 0;
  private closed = false;
  private audioReady?: Promise<void>;
  constructor(
    private send: (data: unknown) => void,
    public onSpeaking: (id: number, on: boolean) => void,
    private onStatus: () => void,
  ) {}
  configure(id: number, room: string, ticket: string) {
    this.identity = id;
    this.room = room;
    this.ticket = ticket;
    this.closed = false;
    this.closePeers();
    this.socket?.close();
    if (this.enabled) {
      void this.connectSocket();
      this.send({ type: "voice-ready", ready: true });
    }
  }
  async prepareAudio() {
    const spatial = (this.spatial ??= new SpatialAudio());
    await spatial.context.resume();
    await (this.audioReady ??= Promise.all([
      spatial.init(),
      spatial.context.audioWorklet.addModule(workletUrl),
    ])
      .then(() => {})
      .catch((error) => {
        this.audioReady = undefined;
        throw error;
      }));
    return spatial;
  }
  async enable() {
    if (this.enabled) {
      await this.spatial?.context.resume();
      return;
    }
    this.status = "Preparing audio…";
    this.onStatus();
    try {
      const spatial = await this.prepareAudio();
      this.worker = new CodecWorker();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Codec initialization timed out")),
          10000,
        );
        this.worker!.onmessage = (e) => {
          if (e.data.type === "ready") {
            clearTimeout(timeout);
            this.codec = e.data.mode;
            resolve();
          }
          if (e.data.type === "error") {
            clearTimeout(timeout);
            reject(Error(e.data.message));
          }
        };
        this.worker!.postMessage({
          type: "init",
          forceWasm: new URLSearchParams(location.search).has("wasm"),
        });
      });
      this.worker.onmessage = (e) => this.workerMessage(e.data);
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (e) {
        this.status = "Listen only · microphone unavailable";
      }
      if (this.stream) {
        this.source = spatial.context.createMediaStreamSource(this.stream);
        this.capture = new AudioWorkletNode(spatial.context, "capture", {
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        const zero = spatial.context.createGain();
        zero.gain.value = 0;
        this.source
          .connect(this.capture)
          .connect(zero)
          .connect(spatial.context.destination);
        this.capture.port.onmessage = (e) => this.captureFrame(e.data);
        for (const t of this.stream.getTracks())
          t.onended = () => {
            this.muted = true;
            this.status = "Microphone disconnected";
            this.updateGate();
            this.onStatus();
          };
      }
      this.enabled = true;
      this.status = this.stream
        ? "Voice connected"
        : "Listen only · microphone unavailable";
      this.updateGate();
      void this.connectSocket();
      this.send({ type: "voice-ready", ready: true });
      this.updateMembers(this.members);
      this.timer = setInterval(() => void this.monitor(), 500);
      this.onStatus();
    } catch (e) {
      this.status = `Audio unavailable: ${e instanceof Error ? e.message : String(e)}`;
      this.worker?.terminate();
      this.onStatus();
    }
  }
  private async connectSocket() {
    if (!this.identity || this.closed) return;
    const generation = ++this.transportGeneration;
    const retry = () =>
      setTimeout(() => {
        if (generation === this.transportGeneration && !this.closed)
          void this.connectSocket();
      }, 1500);
    let channel: Channel;
    try {
      channel = await this.openTransport();
    } catch {
      this.status = "Voice relay reconnecting…";
      this.onStatus();
      retry();
      return;
    }
    if (generation !== this.transportGeneration || this.closed) {
      channel.close();
      return;
    }
    this.socket = channel;
    channel.send(
      JSON.stringify({
        id: this.identity,
        code: this.room,
        ticket: this.ticket,
      }),
    );
    channel.onmessage = (data) => {
      if (typeof data === "string") {
        if (JSON.parse(data).type === "ready") {
          this.status = this.stream
            ? "Voice connected"
            : "Listen only · microphone unavailable";
          this.onStatus();
        }
        return;
      }
      try {
        const f = readVoice(data);
        const p = this.peers.get(f.id);
        if (!p || (!p.relay && p.state !== "UPGRADING")) return;
        this.received++;
        this.worker?.postMessage({ type: "decode", ...f }, [f.payload.buffer]);
      } catch {
        this.dropped++;
      }
    };
    channel.onclose = () => {
      if (this.socket !== channel || this.closed) return;
      this.status = "Voice relay reconnecting…";
      this.onStatus();
      retry();
    };
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.updateGate();
  }
  setMode(mode: "open" | "ptt") {
    this.mode = mode;
    this.talk = false;
    this.updateGate();
  }
  setTalk(value: boolean) {
    this.talk = value;
    this.updateGate();
  }
  private updateGate() {
    const gate =
      this.enabled && !this.muted && (this.mode === "open" || this.talk);
    if (gate !== this.gate) {
      this.gate = gate;
      this.generation++;
    }
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = gate));
    if (!gate && this.speaking) {
      this.speaking = false;
      this.send({ type: "speaking", active: false });
      this.onSpeaking(this.identity, false);
    }
    this.onStatus();
  }
  private captureFrame({ pcm, time }: { pcm: Float32Array; time: number }) {
    if (this.spatial!.context.currentTime - time > 0.12) {
      this.dropped++;
      return;
    }
    this.level = Math.sqrt(pcm.reduce((n, x) => n + x * x, 0) / pcm.length);
    const now = performance.now();
    if (this.gate && this.level > 0.015) this.lastSpeaking = now;
    const active = this.gate && now - this.lastSpeaking < 180;
    if (active !== this.speaking) {
      this.speaking = active;
      this.send({ type: "speaking", active });
      this.onSpeaking(this.identity, active);
    }
    if (this.gate)
      this.worker?.postMessage(
        {
          type: "encode",
          pcm,
          gen: this.generation,
          capturedAt: performance.timeOrigin + performance.now(),
        },
        [pcm.buffer],
      );
  }
  private workerMessage(m: any) {
    if (m.type === "codec") {
      this.codec = m.mode;
      return;
    }
    if (m.type === "encoded") {
      if (performance.timeOrigin + performance.now() - m.capturedAt > 120) {
        this.dropped++;
        return;
      }
      if (
        m.gen !== this.generation ||
        !this.gate ||
        ![...this.peers.values()].some(
          (p) => p.relay || p.state === "UPGRADING",
        )
      )
        return;
      if (!this.socket?.open || this.socket.bufferedAmount > 6000) {
        this.dropped++;
        return;
      }
      this.socket.send(
        voicePacket(this.epoch, ++this.sequence, m.timestamp, m.payload),
      );
      this.sent++;
      return;
    }
    const p = this.peers.get(m.id);
    if (!p) return;
    if (m.type === "reset") {
      p.playback.port.postMessage({ reset: true });
      p.pcm = 0;
    }
    if (m.type === "pcm") {
      p.pcm += m.pcm.length;
      p.playback.port.postMessage({ pcm: m.pcm }, [m.pcm.buffer]);
      if (p.relay && p.state === "RELAY_PREPARING" && p.pcm >= 2880)
        this.select(p, true);
    }
  }
  updateMembers(
    members: { id: number; voiceReady: boolean; connected: boolean }[],
  ) {
    this.members = members;
    for (const [id, p] of this.peers)
      if (!members.some((m) => m.id === id && m.connected && m.voiceReady)) {
        this.disposePeer(p);
        this.peers.delete(id);
      }
    if (!this.enabled) return;
    for (const m of members)
      if (
        m.id !== this.identity &&
        m.connected &&
        m.voiceReady &&
        !this.peers.has(m.id)
      )
        this.createPeer(m.id);
  }
  private createPeer(id: number) {
    const spatial = this.spatial!,
      c = spatial.context,
      emitter = spatial.emitter(),
      direct = c.createGain(),
      relayed = c.createGain(),
      playback = new AudioWorkletNode(c, "playback", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
    direct.connect(emitter.input);
    relayed.connect(emitter.input);
    relayed.gain.value = 0;
    playback.connect(relayed);
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: "max-bundle",
    });
    const meter = c.createAnalyser();
    meter.fftSize = 512;
    emitter.input.connect(meter);
    const p: Peer = {
      id,
      generation: 0,
      pc,
      meter,
      rms: 0,
      state: "DIRECT_CONNECTING",
      relay: false,
      forced: false,
      epoch: 0,
      emitter,
      direct,
      relayed,
      playback,
      ice: [],
      serial: Promise.resolve(),
      started: performance.now(),
      healthy: 0,
      lastProbe: 0,
      nextProbe: 0,
      backoff: 10000,
      lastPacket: performance.now(),
      packets: 0,
      lastPong: 0,
      pcm: 0,
      bufferMs: 0,
      underruns: 0,
      active: false,
      reason: "Finding a direct connection",
    };
    this.peers.set(id, p);
    playback.port.onmessage = (e) => {
      p.bufferMs = e.data.bufferMs;
      p.underruns = e.data.underruns;
    };
    this.installConnection(p);
    return p;
  }
  private installConnection(p: Peer) {
    const pc = p.pc,
      id = p.id;
    if (this.stream)
      for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    else pc.addTransceiver("audio", { direction: "recvonly" });
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.send({
          type: "signal",
          peer: id,
          data: { generation: p.generation, candidate: e.candidate.toJSON() },
        });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      p.audio?.remove();
      p.source?.disconnect();
      const audio = document.createElement("audio");
      audio.muted = true;
      audio.autoplay = true;
      audio.srcObject = stream;
      audio.style.display = "none";
      document.body.append(audio);
      void audio.play().catch(() => {
        this.status = "Click Enable audio to resume playback";
        this.onStatus();
      });
      p.audio = audio;
      p.source = this.spatial!.context.createMediaStreamSource(stream);
      p.source.connect(p.direct);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed")
        this.fallback(p, "Direct connection failed");
      if (pc.connectionState === "disconnected" && !p.relay) {
        p.state = "DIRECT_SUSPECT";
        p.started = performance.now();
      }
    };
    const channel = (ch: RTCDataChannel) => {
      p.channel = ch;
      ch.onmessage = (e) => {
        if (e.data === "ping") ch.send("pong");
        else p.lastPong = performance.now();
      };
    };
    pc.ondatachannel = (e) => channel(e.channel);
    if (this.identity < id) {
      channel(
        pc.createDataChannel("health", { ordered: false, maxRetransmits: 0 }),
      );
      p.serial = p.serial
        .then(() => this.offer(p))
        .catch(() => this.fallback(p, "Negotiation failed"));
    }
  }
  private rebuild(p: Peer) {
    p.pc.onconnectionstatechange = null;
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.close();
    p.channel = undefined;
    p.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: "max-bundle",
    });
    p.ice = [];
    p.healthy = 0;
    p.lastPong = 0;
    p.serial = Promise.resolve();
    this.installConnection(p);
  }
  private requestRebuild(p: Peer) {
    if (this.identity < p.id) {
      p.generation++;
      this.send({
        type: "signal",
        peer: p.id,
        data: { generation: p.generation, rebuild: true },
      });
      this.rebuild(p);
    } else
      this.send({
        type: "signal",
        peer: p.id,
        data: { generation: p.generation, requestRebuild: true },
      });
  }
  private async offer(p: Peer, restart = false) {
    if (p.pc.signalingState !== "stable") return;
    await p.pc.setLocalDescription(
      await p.pc.createOffer({ iceRestart: restart }),
    );
    this.send({
      type: "signal",
      peer: p.id,
      data: { generation: p.generation, description: p.pc.localDescription },
    });
  }
  signal(id: number, data: any) {
    if (!this.enabled) return;
    const p = this.peers.get(id) ?? this.createPeer(id);
    if (data.rebuild) {
      if (data.generation <= p.generation) return;
      p.generation = data.generation;
      this.rebuild(p);
      return;
    }
    if (data.generation !== p.generation) return;
    if (data.requestRebuild) {
      if (this.identity < id) this.requestRebuild(p);
      return;
    }
    p.serial = p.serial
      .then(async () => {
        if (data.restart) {
          if (this.identity < id) await this.offer(p, true);
          return;
        }
        if (data.description) {
          await p.pc.setRemoteDescription(data.description);
          for (const candidate of p.ice) await p.pc.addIceCandidate(candidate);
          p.ice = [];
          if (data.description.type === "offer") {
            await p.pc.setLocalDescription(await p.pc.createAnswer());
            this.send({
              type: "signal",
              peer: id,
              data: {
                generation: p.generation,
                description: p.pc.localDescription,
              },
            });
          }
        } else if (data.candidate) {
          if (p.pc.remoteDescription)
            await p.pc.addIceCandidate(data.candidate);
          else p.ice.push(data.candidate);
        }
      })
      .catch(() => this.fallback(p, "Signaling retry required"));
  }
  route(
    id: number,
    relay: boolean,
    epoch: number,
    reason: string,
    forced: boolean,
  ) {
    const p = this.peers.get(id);
    if (!p || epoch <= p.epoch) return;
    p.epoch = epoch;
    p.forced = forced;
    p.reason = reason;
    p.relay = relay;
    p.healthy = 0;
    if (relay) {
      p.state = "RELAY_PREPARING";
      p.started = performance.now();
      p.nextProbe = performance.now() + p.backoff;
      p.pcm = 0;
      if (!p.active) this.select(p, true);
    } else {
      p.state = "UPGRADING";
      this.select(p, false);
      setTimeout(() => {
        if (!p.relay && this.peers.get(id) === p) p.state = "DIRECT";
      }, 1000);
    }
    this.onStatus();
  }
  private select(p: Peer, relay: boolean) {
    const t = this.spatial!.context.currentTime;
    p.direct.gain.cancelScheduledValues(t);
    p.relayed.gain.cancelScheduledValues(t);
    p.direct.gain.setTargetAtTime(relay ? 0 : 1, t, 0.012);
    p.relayed.gain.setTargetAtTime(relay ? 1 : 0, t, 0.012);
    if (relay) p.state = "RELAY";
    else {
      p.backoff = 10000;
      p.nextProbe = performance.now() + 10000;
    }
  }
  private fallback(p: Peer, reason: string) {
    if (p.relay) return;
    p.state = "RELAY_PREPARING";
    p.started = performance.now();
    p.reason = reason;
    this.send({ type: "route-request", peer: p.id, relay: true, reason });
  }
  force(id: number, enabled: boolean) {
    const p = this.peers.get(id);
    if (!p) return;
    this.send({
      type: "route-request",
      peer: id,
      relay: true,
      force: enabled,
      reason: enabled ? "Forced relay for testing" : "Direct retry requested",
    });
    p.nextProbe = performance.now();
  }
  /**
   * Instantaneous level for one peer, read straight off their meter so avatar mouths can
   * track speech per frame. Returns -1 when that peer has no live meter to read.
   */
  loudness(id: number) {
    const p = this.peers.get(id);
    if (!p) return -1;
    p.meter.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const x of this.samples) sum += x * x;
    return Math.sqrt(sum / this.samples.length);
  }
  speakingFrom(id: number, active: boolean) {
    const p = this.peers.get(id);
    if (p) p.active = active;
    this.onSpeaking(id, active);
  }
  private async monitor() {
    const now = performance.now();
    for (const p of this.peers.values()) {
      const samples = new Float32Array(512);
      p.meter.getFloatTimeDomainData(samples);
      p.rms = Math.sqrt(
        samples.reduce((n, x) => n + x * x, 0) / samples.length,
      );
      if (p.channel?.readyState === "open") p.channel.send("ping");
      try {
        const stats = await p.pc.getStats();
        for (const r of stats.values())
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            if (r.packetsReceived > p.packets) p.lastPacket = now;
            p.packets = r.packetsReceived;
          }
      } catch {}
      const transport =
        p.pc.connectionState === "connected" &&
        p.channel?.readyState === "open" &&
        now - p.lastPong < 2000;
      const healthy = transport && (!p.active || now - p.lastPacket < 1000);
      if (healthy) p.healthy ||= now;
      else p.healthy = 0;
      if (p.state === "DIRECT_CONNECTING" && now - p.started > 3000 && !healthy)
        this.fallback(p, "Direct connection timed out");
      if (p.state === "DIRECT" && !healthy) {
        p.state = "DIRECT_SUSPECT";
        p.started = now;
      }
      if (p.state === "DIRECT_SUSPECT") {
        if (healthy) p.state = "DIRECT";
        else if (now - p.started > 750)
          this.fallback(p, "Direct audio interrupted");
      }
      if (p.state === "RELAY_PREPARING" && now - p.started > 2000) {
        if (!p.active) this.select(p, true);
        else {
          p.state = "UNAVAILABLE";
          p.reason = "Waiting for relay audio";
        }
      }
      if (
        p.relay &&
        !p.forced &&
        now >= p.nextProbe &&
        p.state !== "DIRECT_PROBING"
      ) {
        p.state = "DIRECT_PROBING";
        p.started = now;
        p.healthy = 0;
        p.lastProbe = now;
        p.nextProbe = now + p.backoff;
        p.backoff = Math.min(60000, p.backoff * 2);
        if (
          p.pc.connectionState === "closed" ||
          p.pc.connectionState === "failed"
        ) {
          this.requestRebuild(p);
        } else if (this.identity < p.id)
          p.serial = p.serial.then(() => this.offer(p, true)).catch(() => {});
        else
          this.send({
            type: "signal",
            peer: p.id,
            data: { generation: p.generation, restart: true },
          });
      }
      if (p.state === "DIRECT_PROBING" && now - p.started > 5000 && !healthy) {
        p.state = "RELAY";
        p.nextProbe = now + p.backoff;
      }
      if (
        (p.state === "DIRECT_PROBING" || p.state === "DIRECT_CONNECTING") &&
        healthy &&
        p.healthy &&
        now - p.healthy >= 2000 &&
        !p.forced
      )
        this.send({ type: "route-request", peer: p.id, relay: false });
      if (p.state === "UNAVAILABLE" && p.pcm >= 2880) this.select(p, true);
    }
  }
  updatePosition(id: number, position: { x: number; y: number; z: number }) {
    const p = this.peers.get(id);
    if (p) p.emitter.position = position;
  }
  private disposePeer(p: Peer) {
    p.pc.close();
    p.audio?.pause();
    if (p.audio) p.audio.srcObject = null;
    p.audio?.remove();
    p.source?.disconnect();
    p.playback.disconnect();
    p.direct.disconnect();
    p.relayed.disconnect();
    p.meter.disconnect();
    p.emitter.dispose();
    this.worker?.postMessage({ type: "remove", id: p.id });
  }
  private closePeers() {
    for (const p of this.peers.values()) this.disposePeer(p);
    this.peers.clear();
  }
  disconnect() {
    this.closed = true;
    this.socket?.close();
    this.closePeers();
  }
  dispose() {
    this.disconnect();
    clearInterval(this.timer);
    this.worker?.terminate();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.capture?.disconnect();
    this.source?.disconnect();
    void this.spatial?.context.close();
  }
}
