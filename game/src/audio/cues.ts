// Every sound the game makes, by name: what it is made of, and how often it may repeat.
// A cue with several takes rotates through them so a repeated sound (a step, a coin) never sounds stamped.
import { bell, breath, gong, hz, pent, pluck, shift, wood, type Voice } from './voices';

/** Cues in a group share one repeat window: one coins sound per batch, not one per coin. */
export type CueGroup = 'ui' | 'move' | 'coins' | 'goods';

/**
 * full: an AI's skimmed beat plays like the human's. soft: plays quieter and at most once per skim window.
 * off: an AI's skimmed beat is silent.
 */
export type SkimRule = 'full' | 'soft' | 'off';

export interface CueSpec {
  takes: readonly (readonly Voice[])[];
  /** Ungrouped cues keep a repeat window of their own. */
  group?: CueGroup;
  /** Minimum ms between two plays of the cue (or its group) while the human is watching. */
  gapMs: number;
  skim: SkimRule;
}

const ROLL_TAKE: Voice[] = [
  ...[0, 0.05, 0.11, 0.16, 0.24, 0.3].flatMap((t, i) => wood(i % 2 ? 1250 : 1500, t, 0.32 - i * 0.03)),
  ...breath(0, 0.36, 0.1, 2400, 1800, 0.05),
];

const ASCEND: Voice[] = [
  ...gong(hz(pent(-10)), 0, 0.35, 3.2),
  ...[5, 7, 9, 10, 12].flatMap((d, i) => bell(pent(d), 0.08 + i * 0.11, 0.2, 2.4)),
];

const CUES = {
  click: { takes: [wood(1700, 0, 0.18)], group: 'ui', gapMs: 50, skim: 'full' },
  confirm: { takes: [[...wood(1300, 0, 0.18), ...pluck(pent(7), 0.02, 0.22, 0.5)]], group: 'ui', gapMs: 60, skim: 'full' },
  cancel: { takes: [[...pluck(pent(6), 0, 0.2, 0.35), ...pluck(pent(4), 0.07, 0.18, 0.5)]], group: 'ui', gapMs: 60, skim: 'full' },
  roll: { takes: [ROLL_TAKE], gapMs: 120, skim: 'soft' },
  step: { takes: [wood(620, 0, 0.3), wood(700, 0, 0.27)], group: 'move', gapMs: 40, skim: 'soft' },
  warp: { takes: [[...breath(0, 0.5, 0.35, 500, 3000), ...bell(pent(12), 0.35, 0.14, 1)]], group: 'move', gapMs: 120, skim: 'soft' },
  buy: { takes: [[...pluck(pent(5), 0, 0.3), ...pluck(pent(8), 0.06, 0.26), ...bell(pent(12), 0.12, 0.14, 1.2)]], gapMs: 150, skim: 'soft' },
  upgrade: { takes: [[5, 6, 7, 8, 10].flatMap((d, i) => pluck(pent(d), i * 0.07, 0.24, 0.9))], gapMs: 150, skim: 'soft' },
  coinsIn: { takes: [[...bell(pent(13), 0, 0.16, 0.5), ...bell(pent(15), 0.06, 0.16, 0.5), ...bell(pent(16), 0.12, 0.2, 0.8)]], group: 'coins', gapMs: 150, skim: 'soft' },
  coinsOut: { takes: [[...bell(pent(12), 0, 0.15, 0.4), ...bell(pent(10), 0.08, 0.15, 0.4), ...wood(380, 0.16, 0.25)]], group: 'coins', gapMs: 150, skim: 'soft' },
  herb: { takes: [[...breath(0, 0.35, 0.16, 900, 2600, 0.12), ...pluck(pent(11), 0.12, 0.2, 0.7)]], group: 'goods', gapMs: 150, skim: 'off' },
  pill: { takes: [[...bell(pent(14), 0, 0.2, 1.1), ...bell(pent(17), 0.09, 0.12, 0.9)]], group: 'goods', gapMs: 150, skim: 'off' },
  brew: { takes: [[...breath(0, 0.6, 0.18, 300, 900, 0.2), ...[0.1, 0.22, 0.31, 0.45].flatMap((t, i) => wood(260 + i * 70, t, 0.2))]], group: 'goods', gapMs: 200, skim: 'off' },
  cult: { takes: [[{ kind: 'tone', wave: 'sine', hz: hz(pent(5)), glide: hz(pent(10)), at: 0, dur: 0.7, attack: 0.25, gain: 0.14 }, ...bell(pent(10), 0.45, 0.1, 0.8)]], group: 'goods', gapMs: 300, skim: 'off' },
  card: { takes: [[...breath(0, 0.14, 0.2, 4000, 6000, 0.02), ...wood(1900, 0.08, 0.1)]], group: 'goods', gapMs: 120, skim: 'off' },
  cast: { takes: [[...breath(0, 0.45, 0.3, 700, 4200, 0.3), ...bell(pent(11), 0.3, 0.18, 1.2)]], gapMs: 150, skim: 'soft' },
  fortune: { takes: [[...bell(pent(10), 0, 0.16, 1.4), ...bell(pent(12), 0.1, 0.14, 1.4), ...bell(pent(14), 0.2, 0.12, 1.6)]], gapMs: 200, skim: 'soft' },
  hit: { takes: [[...breath(0, 0.14, 0.55, 1800, 500, 0.004), ...wood(210, 0, 0.45), { kind: 'tone', wave: 'sine', hz: 110, glide: 45, at: 0, dur: 0.35, attack: 0.002, gain: 0.6 }, { kind: 'tone', wave: 'square', hz: 620, glide: 560, at: 0.01, dur: 0.3, attack: 0.002, gain: 0.05, lowpass: 2400 }]], gapMs: 200, skim: 'full' },
  charge: { takes: [[...breath(0, 1.1, 0.24, 300, 2400, 1), { kind: 'tone', wave: 'sine', hz: 110, glide: 330, at: 0, dur: 1.2, attack: 1, gain: 0.18 }]], gapMs: 100, skim: 'full' },
  ascend: { takes: [ASCEND], gapMs: 100, skim: 'full' },
  deviate: { takes: [[...gong(hz(pent(-12)), 0, 0.4, 2.2), { kind: 'tone', wave: 'sawtooth', hz: 220, glide: 70, at: 0, dur: 1, attack: 0.01, gain: 0.08, lowpass: 900 }, ...breath(0, 0.5, 0.25, 1200, 200, 0.01)]], gapMs: 100, skim: 'full' },
  manifest: { takes: [[...gong(hz(pent(-11)), 0, 0.45, 4), ...[10, 12, 14, 15, 17].flatMap((d, i) => bell(pent(d), 0.6 + i * 0.16, 0.11, 2.2))]], gapMs: 1000, skim: 'full' },
  yourTurn: { takes: [[...bell(pent(8), 0, 0.22, 1.2), ...bell(pent(10), 0.16, 0.26, 1.6)]], gapMs: 150, skim: 'full' },
  round: { takes: [[...wood(240, 0, 0.3), ...wood(240, 0.22, 0.22)]], gapMs: 150, skim: 'full' },
  win: { takes: [[...[0, 2, 4, 5, 7, 10].flatMap((d, i) => pluck(pent(d + 3), i * 0.12, 0.24, 1.6)), ...shift(ASCEND, 0.75, 0.8)]], gapMs: 1000, skim: 'full' },
  lose: { takes: [[9, 7, 5, 4, 2].flatMap((d, i) => pluck(pent(d), i * 0.22, 0.24, 1.6)).concat(gong(hz(pent(-10)), 1.1, 0.25, 2.4))], gapMs: 1000, skim: 'full' },
} satisfies Record<string, CueSpec>;

export type Cue = keyof typeof CUES;

export const CUE_SPECS: Readonly<Record<Cue, CueSpec>> = CUES;

export const CUE_NAMES = Object.keys(CUES) as Cue[];
