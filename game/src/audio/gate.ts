// Decides whether a cue sounds now and how loud, so a skimmed AI turn murmurs instead of machine-gunning.
import type { Tempo } from '../ui/pacing';
import { CUE_SPECS, type Cue, type CueGroup } from './cues';

/** A skimmed 'soft' cue sounds at most once per window: one tick for a whole walk, one chime per coin batch. */
const SKIM_WINDOW_MS = 300;
export const SOFT_GAIN = 0.4;

export class CueGate {
  private last = new Map<CueGroup | Cue, number>();

  /** Gain multiplier to play `cue` at `now` (ms), or null to stay silent. */
  admit(cue: Cue, tempo: Tempo, now: number): number | null {
    const spec = CUE_SPECS[cue];
    const skimmed = tempo === 'skim' && spec.skim !== 'full';
    if (skimmed && spec.skim === 'off') return null;
    const gap = skimmed ? Math.max(spec.gapMs, SKIM_WINDOW_MS) : spec.gapMs;
    const key = spec.group ?? cue;
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < gap) return null;
    this.last.set(key, now);
    return skimmed ? SOFT_GAIN : 1;
  }
}
