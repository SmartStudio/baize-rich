import { describe, expect, it } from 'vitest';
import { CUE_NAMES, CUE_SPECS, type Cue } from '../src/audio/cues';
import { cueForEvent } from '../src/audio/eventCues';
import { CueGate, SOFT_GAIN } from '../src/audio/gate';
import { busGains, DEFAULT_PREFS, stepVolume, VOLUMES } from '../src/audio/mix';
import { INITIAL_MUSIC, musicBar, barSeconds, type MusicMode } from '../src/audio/music';
import { voicesLength, type Voice } from '../src/audio/voices';
import type { GameEvent, GameEventType } from '../src/core/events';
import { PACE, type Tempo } from '../src/ui/pacing';
import { parseAudioPrefs } from '../src/ui/saves';

const HUMAN = new Set([0]);

function ev(type: GameEventType, extra: Partial<GameEvent> = {}): GameEvent {
  return { seq: 0, round: 1, type, text: '', ...extra };
}

/** Feeds `cue` to a fresh gate every `everyMs` for `n` beats; returns the gains of the beats that sounded. */
function run(cues: Cue[], tempo: Tempo, everyMs: number): number[] {
  const gate = new CueGate();
  return cues.flatMap((c, i) => {
    const g = gate.admit(c, tempo, 1000 + i * everyMs);
    return g === null ? [] : [g];
  });
}

describe('cue registry', () => {
  it('every cue has short, unclipped takes', () => {
    for (const name of CUE_NAMES) {
      for (const take of CUE_SPECS[name].takes) {
        expect(take.length, name).toBeGreaterThan(0);
        expect(voicesLength(take), name).toBeLessThan(5);
        for (const v of take) {
          expect(v.gain, name).toBeGreaterThan(0);
          expect(v.gain, name).toBeLessThanOrEqual(0.6);
          expect(v.attack, name).toBeLessThanOrEqual(v.dur);
        }
      }
    }
  });
});

describe('engine events to cues', () => {
  it('the core moves of a turn each sound', () => {
    expect(cueForEvent(ev('roll', { player: 1 }), HUMAN)).toBe('roll');
    expect(cueForEvent(ev('step', { player: 1 }), HUMAN)).toBe('step');
    expect(cueForEvent(ev('buy', { player: 0 }), HUMAN)).toBe('buy');
    expect(cueForEvent(ev('upgrade', { player: 2 }), HUMAN)).toBe('upgrade');
  });

  it('rent rings as income only when the human is the one paid', () => {
    expect(cueForEvent(ev('rent', { player: 1, payee: 0 }), HUMAN)).toBe('coinsIn');
    expect(cueForEvent(ev('rent', { player: 0, payee: 1 }), HUMAN)).toBe('coinsOut');
    expect(cueForEvent(ev('passToll', { player: 2, payee: 3 }), HUMAN)).toBe('coinsOut');
    expect(cueForEvent(ev('stones', { player: 0, amount: -50 }), HUMAN)).toBe('coinsOut');
    expect(cueForEvent(ev('stones', { player: 0, amount: 50 }), HUMAN)).toBe('coinsIn');
  });

  it('only the human hears their turn come round', () => {
    expect(cueForEvent(ev('turnStart', { player: 0 }), HUMAN)).toBe('yourTurn');
    expect(cueForEvent(ev('turnStart', { player: 2 }), HUMAN)).toBeNull();
  });

  it('the end sounds a win for the human winner (or an all-AI table) and a loss otherwise', () => {
    expect(cueForEvent(ev('win', { player: 0 }), HUMAN)).toBe('win');
    expect(cueForEvent(ev('win', { player: 3 }), HUMAN)).toBe('lose');
    expect(cueForEvent(ev('win', { player: 3 }), new Set())).toBe('win');
  });

  it('the breakthrough is left to its cutscene, and a 修为 change that gained nothing is silent', () => {
    expect(cueForEvent(ev('breakthrough', { player: 0 }), HUMAN)).toBeNull();
    expect(cueForEvent(ev('cult', { player: 0, cult: { source: 'breath', gained: 0, insight: 0, wasted: 2 } }), HUMAN)).toBeNull();
    expect(cueForEvent(ev('cult', { player: 0, cult: { source: 'breath', gained: 2, insight: 0, wasted: 0 } }), HUMAN)).toBe('cult');
  });
});

describe('throttling', () => {
  const walk = (n: number): Cue[] => Array.from({ length: n }, () => 'step');

  it("the human's walk ticks on every step at full volume", () => {
    expect(run(walk(9), 'watch', PACE.watch.step)).toEqual(Array(9).fill(1));
    expect(run(walk(9), 'watch', PACE.watch.step / 4)).toEqual(Array(9).fill(1));
  });

  it("a skimmed AI walk murmurs soft ticks on at most every other step", () => {
    const gains = run(walk(9), 'skim', PACE.skim.step);
    expect(gains.length).toBeGreaterThan(0);
    expect(gains.length).toBeLessThanOrEqual(5);
    expect(gains.every((g) => g === SOFT_GAIN)).toBe(true);
  });

  it('a batch of tolls and the total collapse into one coins sound', () => {
    const batch: Cue[] = ['coinsOut', 'coinsOut', 'coinsIn', 'coinsOut', 'coinsOut'];
    expect(run(batch, 'skim', 50)).toHaveLength(1);
    expect(run(batch, 'watch', 50)).toHaveLength(2);
  });

  it("an AI's skimmed bookkeeping is silent; its fights are not", () => {
    expect(run(['herb', 'pill', 'cult'], 'skim', 1000)).toEqual([]);
    expect(run(['hit'], 'skim', 0)).toEqual([1]);
  });

  it('different cues do not block each other', () => {
    expect(run(['roll', 'step', 'buy', 'coinsOut', 'yourTurn'], 'watch', 10)).toHaveLength(5);
  });
});

describe('music bed', () => {
  const PENTATONIC_PCS = new Set([2, 4, 6, 9, 11]);
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const melody = (vs: Voice[]) => vs.filter((v): v is Extract<Voice, { kind: 'tone' }> => v.kind === 'tone' && v.wave === 'triangle');
  const pc = (f: number) => ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;

  for (const mode of ['title', 'board'] as MusicMode[]) {
    it(`${mode}: stays on the pentatonic, inside its bar, and comes home to D every fourth bar`, () => {
      let state = INITIAL_MUSIC;
      const rand = seeded(7);
      for (let bar = 0; bar < 16; bar++) {
        const next = musicBar(mode, state, rand);
        for (const v of next.voices) expect(v.at).toBeLessThan(barSeconds(mode));
        for (const v of melody(next.voices)) expect(PENTATONIC_PCS.has(pc(v.glide!))).toBe(true);
        if (bar % 4 === 3) expect(next.state.deg % 5).toBe(0);
        state = next.state;
      }
      expect(state.bar).toBe(16);
    });
  }

  it('the same seed gives the same bars', () => {
    const a = musicBar('board', INITIAL_MUSIC, seeded(3));
    const b = musicBar('board', INITIAL_MUSIC, seeded(3));
    expect(a).toEqual(b);
  });
});

describe('sound settings', () => {
  it('missing or unreadable settings fall back to the defaults', () => {
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parseAudioPrefs('{oops')).toEqual(DEFAULT_PREFS);
    expect(parseAudioPrefs('42')).toEqual(DEFAULT_PREFS);
  });

  it('keeps every field that still reads and snaps the volume to a step', () => {
    expect(parseAudioPrefs(JSON.stringify({ music: false, sfx: 'yes', volume: 0.6 }))).toEqual({ ...DEFAULT_PREFS, music: false, volume: 0.5 });
    expect(parseAudioPrefs(JSON.stringify({ muted: true, volume: 9 }))).toEqual({ ...DEFAULT_PREFS, muted: true, volume: 1 });
  });

  it('volume steps hold at the ends', () => {
    expect(stepVolume(VOLUMES[0], -1)).toBe(VOLUMES[0]);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0.5, 1)).toBe(0.75);
  });

  it('mute silences the master; the music bus always sits under the effects', () => {
    expect(busGains({ ...DEFAULT_PREFS, muted: true }).master).toBe(0);
    expect(busGains({ ...DEFAULT_PREFS, music: false }).music).toBe(0);
    const g = busGains(DEFAULT_PREFS);
    expect(g.music).toBeLessThan(g.sfx / 2);
  });
});
