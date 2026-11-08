// The game's one sound system. Silent until the first click or key (browser autoplay policy), and a no-op
// wherever WebAudio is missing. Scenes name cues and the music mode; this owns timing, levels and settings.
import type { GameEvent } from '../core/events';
import type { Tempo } from '../ui/pacing';
import { loadAudioPrefs, saveAudioPrefs } from '../ui/saves';
import { CUE_SPECS, type Cue } from './cues';
import { cueForEvent } from './eventCues';
import { CueGate } from './gate';
import { busGains, DEFAULT_PREFS, type AudioPrefs } from './mix';
import { barSeconds, INITIAL_MUSIC, musicBar, type MusicMode, type MusicState } from './music';
import { applyGains, buildChain, renderOffline, schedule, setDucked, setGains, type Chain } from './synth';
import { shift, type Voice } from './voices';

/** Music is scheduled this far ahead, so a throttled background-tab timer never leaves a gap. */
const LOOKAHEAD_S = 1.5;
const PUMP_MS = 250;

type Listener = (p: AudioPrefs) => void;

class SoundSystem {
  private ctx: AudioContext | null = null;
  private chain: Chain | null = null;
  private gate = new CueGate();
  private prefs: AudioPrefs = DEFAULT_PREFS;
  private listeners = new Set<Listener>();
  private takeIndex = new Map<Cue, number>();
  private mode: MusicMode | null = null;
  private bar: MusicState = INITIAL_MUSIC;
  private nextBarAt = 0;
  private ducks = 0;
  /** Cues actually scheduled, by name: the debug handle's proof that sound fired. */
  readonly counts: Partial<Record<Cue, number>> = {};

  install(): void {
    this.prefs = loadAudioPrefs();
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true });
    window.addEventListener('keydown', (ev) => {
      if ((ev.key === 'm' || ev.key === 'M') && !ev.repeat) this.update({ muted: !this.prefs.muted });
    });
    (window as unknown as { __audio: object }).__audio = {
      state: () => this.ctx?.state ?? 'none',
      counts: this.counts,
      render: (cue: Cue, take = 0) => this.render(CUE_SPECS[cue].takes[take], 'sfx'),
      renderMusic: (mode: MusicMode, bars: number) => this.render(musicBars(mode, bars), 'music'),
    };
  }

  get settings(): AudioPrefs {
    return this.prefs;
  }

  update(patch: Partial<AudioPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    saveAudioPrefs(this.prefs);
    if (this.ctx && this.chain) applyGains(this.ctx, this.chain, busGains(this.prefs));
    for (const l of this.listeners) l(this.prefs);
  }

  /** Calls `fn` on every settings change; returns the unsubscribe. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  cue(c: Cue, tempo: Tempo = 'watch'): void {
    const { ctx, chain } = this;
    if (!ctx || !chain || ctx.state !== 'running' || this.prefs.muted || !this.prefs.sfx) return;
    const gain = this.gate.admit(c, tempo, performance.now());
    if (gain === null) return;
    const takes = CUE_SPECS[c].takes;
    const i = this.takeIndex.get(c) ?? 0;
    this.takeIndex.set(c, (i + 1) % takes.length);
    schedule(ctx, chain.sfx, takes[i], ctx.currentTime + 0.005, gain);
    this.counts[c] = (this.counts[c] ?? 0) + 1;
  }

  event(e: GameEvent, tempo: Tempo, humans: ReadonlySet<number>): void {
    const c = cueForEvent(e, humans);
    if (c) this.cue(c, tempo);
  }

  music(mode: MusicMode): void {
    this.mode = mode;
  }

  /** Lowers the music while `p` (a cutscene) runs. Overlapping cutscenes keep it low until the last ends. */
  async duckDuring<T>(p: Promise<T>): Promise<T> {
    this.setDucks(this.ducks + 1);
    try {
      return await p;
    } finally {
      this.setDucks(this.ducks - 1);
    }
  }

  private setDucks(n: number): void {
    this.ducks = n;
    if (this.ctx && this.chain) setDucked(this.ctx, this.chain, n > 0);
  }

  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch (e) {
      console.info('[baize] 无法开启音频', e);
      return;
    }
    this.chain = buildChain(this.ctx);
    setGains(this.chain, busGains(this.prefs));
    void this.ctx.resume().catch(() => undefined);
    window.setInterval(() => this.pump(), PUMP_MS);
  }

  private pump(): void {
    const { ctx, chain, mode } = this;
    if (!ctx || !chain || !mode || ctx.state !== 'running' || this.prefs.muted || !this.prefs.music) {
      this.nextBarAt = 0;
      return;
    }
    const now = ctx.currentTime;
    if (this.nextBarAt < now) this.nextBarAt = now + 0.1;
    while (this.nextBarAt < now + LOOKAHEAD_S) {
      const next = musicBar(mode, this.bar, Math.random);
      schedule(ctx, chain.music, next.voices, this.nextBarAt);
      this.bar = next.state;
      this.nextBarAt += barSeconds(mode);
    }
  }

  private async render(voices: readonly Voice[], bus: 'sfx' | 'music'): Promise<{ sampleRate: number; data: number[] }> {
    const buf = await renderOffline(voices, bus, busGains(DEFAULT_PREFS));
    return { sampleRate: buf.sampleRate, data: Array.from(buf.getChannelData(0)) };
  }
}

function musicBars(mode: MusicMode, bars: number): Voice[] {
  let state = INITIAL_MUSIC;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out: Voice[] = [];
  for (let i = 0; i < bars; i++) {
    const next = musicBar(mode, state, rand);
    out.push(...shift(next.voices, i * barSeconds(mode)));
    state = next.state;
  }
  return out;
}

export const sound = new SoundSystem();
