// Synth voices as plain data, and the instruments built from them: a guqin pluck, a bronze bell, a wood
// block, a gong, a breath of noise. Pitches sit on the D 宫 pentatonic (D E F# A B). Times are seconds from
// the cue's start; gains are linear peaks before the bus gains.

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** An oscillator with a linear attack and an exponential fall to silence over `dur`. */
export interface Tone {
  kind: 'tone';
  wave: Wave;
  hz: number;
  /** Pitch at the end of `dur`, gliding exponentially from `hz`. */
  glide?: number;
  at: number;
  dur: number;
  attack: number;
  gain: number;
  lowpass?: number;
}

/** White noise through one filter whose centre can sweep to `sweep`. */
export interface Noise {
  kind: 'noise';
  band: 'lowpass' | 'highpass' | 'bandpass';
  hz: number;
  sweep?: number;
  q?: number;
  at: number;
  dur: number;
  attack: number;
  gain: number;
}

export type Voice = Tone | Noise;

const PENTATONIC = [0, 2, 4, 7, 9];
const D4 = 62;

/** MIDI note of pentatonic degree `deg`, counted from D4 (negative goes down). */
export function pent(deg: number): number {
  const oct = Math.floor(deg / PENTATONIC.length);
  return D4 + 12 * oct + PENTATONIC[deg - oct * PENTATONIC.length];
}

export function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Seconds until the last voice has faded. */
export function voicesLength(voices: readonly Voice[]): number {
  return voices.reduce((end, v) => Math.max(end, v.at + v.dur), 0);
}

export function shift(voices: readonly Voice[], at: number, gain = 1): Voice[] {
  return voices.map((v) => ({ ...v, at: v.at + at, gain: v.gain * gain }));
}

/** 古琴: a triangle string, its octave, a fingernail click, and a small slide into the note. */
export function pluck(midi: number, at: number, gain: number, dur = 1.4): Voice[] {
  const f = hz(midi);
  return [
    { kind: 'tone', wave: 'triangle', hz: f * 0.985, glide: f, at, dur, attack: 0.004, gain, lowpass: 2600 },
    { kind: 'tone', wave: 'sine', hz: f * 2, at, dur: dur * 0.45, attack: 0.003, gain: gain * 0.3 },
    { kind: 'noise', band: 'bandpass', hz: 3200, q: 2, at, dur: 0.025, attack: 0.001, gain: gain * 0.25 },
  ];
}

/** 编钟: inharmonic partials that die faster the higher they are. */
export function bell(midi: number, at: number, gain: number, dur = 1.8): Voice[] {
  const f = hz(midi);
  return [
    { kind: 'tone', wave: 'sine', hz: f, at, dur, attack: 0.002, gain },
    { kind: 'tone', wave: 'sine', hz: f * 2.76, at, dur: dur * 0.45, attack: 0.002, gain: gain * 0.4 },
    { kind: 'tone', wave: 'sine', hz: f * 5.4, at, dur: dur * 0.2, attack: 0.001, gain: gain * 0.18 },
  ];
}

/** 木鱼: a short knock that drops in pitch, with a click on top. */
export function wood(f: number, at: number, gain: number): Voice[] {
  return [
    { kind: 'tone', wave: 'sine', hz: f, glide: f * 0.78, at, dur: 0.09, attack: 0.001, gain },
    { kind: 'noise', band: 'bandpass', hz: f * 2.2, q: 4, at, dur: 0.02, attack: 0.001, gain: gain * 0.5 },
  ];
}

/** 锣: a low swell with beating partials and a long tail. */
export function gong(f: number, at: number, gain: number, dur = 3): Voice[] {
  return [
    { kind: 'tone', wave: 'sine', hz: f * 1.02, glide: f, at, dur, attack: 0.01, gain },
    { kind: 'tone', wave: 'sine', hz: f * 1.483, at, dur: dur * 0.7, attack: 0.02, gain: gain * 0.45 },
    { kind: 'tone', wave: 'sine', hz: f * 2.13, at, dur: dur * 0.5, attack: 0.02, gain: gain * 0.3 },
    { kind: 'noise', band: 'lowpass', hz: 500, at, dur: 0.4, attack: 0.005, gain: gain * 0.4 },
  ];
}

/** A breath of air sweeping through a band, for whooshes and charge-ups. */
export function breath(at: number, dur: number, gain: number, from: number, to: number, attack = dur * 0.6): Voice[] {
  return [{ kind: 'noise', band: 'bandpass', hz: from, sweep: to, q: 1.4, at, dur, attack, gain }];
}
