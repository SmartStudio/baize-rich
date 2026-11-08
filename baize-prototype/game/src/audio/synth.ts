// Turns voice data into WebAudio nodes. Works on a live AudioContext and on an OfflineAudioContext alike,
// so a rendered WAV is exactly what the game plays.
import { DUCK_LEVEL, type BusGains } from './mix';
import { voicesLength, type Noise, type Tone, type Voice } from './voices';

/** master → limiter → speakers; sfx → master; music → duck → master. */
export interface Chain {
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  duck: GainNode;
}

const SILENT = 0.0001;
const SMOOTH_S = 0.08;

export function buildChain(ctx: BaseAudioContext): Chain {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(limiter);
  const sfx = ctx.createGain();
  sfx.connect(master);
  const duck = ctx.createGain();
  duck.connect(master);
  const music = ctx.createGain();
  music.connect(duck);
  return { master, sfx, music, duck };
}

/** Bus levels set outright, for a chain that has not sounded yet. */
export function setGains(chain: Chain, g: BusGains): void {
  chain.master.gain.value = g.master;
  chain.sfx.gain.value = g.sfx;
  chain.music.gain.value = g.music;
}

export function applyGains(ctx: BaseAudioContext, chain: Chain, g: BusGains): void {
  const t = ctx.currentTime;
  chain.master.gain.setTargetAtTime(g.master, t, SMOOTH_S);
  chain.sfx.gain.setTargetAtTime(g.sfx, t, SMOOTH_S);
  chain.music.gain.setTargetAtTime(g.music, t, SMOOTH_S);
}

export function setDucked(ctx: BaseAudioContext, chain: Chain, on: boolean): void {
  chain.duck.gain.setTargetAtTime(on ? DUCK_LEVEL : 1, ctx.currentTime, on ? 0.06 : 0.4);
}

/** Schedule `voices` into `dest` starting at context time `t0`, every gain scaled by `scale`. */
export function schedule(ctx: BaseAudioContext, dest: AudioNode, voices: readonly Voice[], t0: number, scale = 1): void {
  for (const v of voices) {
    const start = t0 + v.at;
    const end = start + v.dur;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(v.gain * scale, start + v.attack);
    env.gain.exponentialRampToValueAtTime(SILENT, end);
    env.connect(dest);
    const src = v.kind === 'tone' ? tone(ctx, v, env, start, end) : noise(ctx, v, env, start, end);
    src.start(start);
    src.stop(end + 0.02);
    src.onended = () => env.disconnect();
  }
}

function tone(ctx: BaseAudioContext, v: Tone, out: AudioNode, start: number, end: number): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = v.wave;
  osc.frequency.setValueAtTime(v.hz, start);
  if (v.glide) osc.frequency.exponentialRampToValueAtTime(v.glide, end);
  if (v.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = v.lowpass;
    osc.connect(f).connect(out);
  } else osc.connect(out);
  return osc;
}

function noise(ctx: BaseAudioContext, v: Noise, out: AudioNode, start: number, end: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = v.band;
  f.Q.value = v.q ?? 1;
  f.frequency.setValueAtTime(v.hz, start);
  if (v.sweep) f.frequency.exponentialRampToValueAtTime(v.sweep, end);
  src.connect(f).connect(out);
  return src;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** Render `voices` through the game's own chain, on `bus`, at the levels `gains` set. */
export function renderOffline(voices: readonly Voice[], bus: 'sfx' | 'music', gains: BusGains, sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil((voicesLength(voices) + 0.2) * sampleRate), sampleRate);
  const chain = buildChain(ctx);
  setGains(chain, gains);
  schedule(ctx, bus === 'sfx' ? chain.sfx : chain.music, voices, 0);
  return ctx.startRendering();
}
