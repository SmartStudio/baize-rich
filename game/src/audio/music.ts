// The ambient bed, one bar at a time: a low D–A drone, a guqin line wandering the pentatonic in small
// steps, a far bell now and then. Every fourth bar comes home to D. The title breathes slower than the board.
import { bell, hz, pent, pluck, type Voice } from './voices';

export type MusicMode = 'title' | 'board';

export interface MusicState {
  bar: number;
  /** Pentatonic degree of the last melody note. */
  deg: number;
}

interface Style {
  barS: number;
  slots: number;
  /** Chance that a slot holds a note. */
  density: number;
  low: number;
  high: number;
  bellEvery: number;
  pluck: number;
}

const STYLES: Record<MusicMode, Style> = {
  title: { barS: 6, slots: 6, density: 0.3, low: 3, high: 10, bellEvery: 2, pluck: 0.2 },
  board: { barS: 4, slots: 8, density: 0.26, low: 0, high: 8, bellEvery: 4, pluck: 0.18 },
};

const PHRASE_BARS = 4;
const STEPS = [-2, -1, -1, 1, 1, 2];
const DRONE = [pent(-5), pent(-2)];

export const INITIAL_MUSIC: MusicState = { bar: 0, deg: 5 };

export function barSeconds(mode: MusicMode): number {
  return STYLES[mode].barS;
}

/** One bar of music starting at 0 s, and the state the next bar continues from. `rand` returns [0, 1). */
export function musicBar(mode: MusicMode, state: MusicState, rand: () => number): { voices: Voice[]; state: MusicState } {
  const st = STYLES[mode];
  const slot = st.barS / st.slots;
  const voices: Voice[] = state.bar % 2 === 0 ? drone(st.barS) : [];
  let deg = state.deg;
  for (let i = 0; i < st.slots; i++) {
    if (rand() >= st.density) continue;
    deg = reflect(deg + STEPS[Math.floor(rand() * STEPS.length)], st.low, st.high);
    voices.push(...pluck(pent(deg), i * slot, st.pluck * (0.7 + 0.3 * rand()), 1.8));
  }
  if (state.bar % PHRASE_BARS === PHRASE_BARS - 1) {
    deg = home(deg, st.low, st.high);
    voices.push(...pluck(pent(deg), st.barS - slot, st.pluck, 2.4));
  }
  if (state.bar % st.bellEvery === 0) voices.push(...bell(pent(10 + Math.floor(rand() * 5)), Math.floor(rand() * st.slots) * slot, 0.07, 2.6));
  return { voices, state: { bar: state.bar + 1, deg } };
}

function drone(barS: number): Voice[] {
  return DRONE.map((m, i) => ({ kind: 'tone', wave: 'sine', hz: hz(m), at: 0, dur: barS * 2.4, attack: barS * 0.9, gain: i === 0 ? 0.09 : 0.05 }));
}

function reflect(deg: number, low: number, high: number): number {
  if (deg < low) return low + (low - deg);
  if (deg > high) return high - (deg - high);
  return deg;
}

/** The nearest D (a degree divisible by 5) inside the range. */
function home(deg: number, low: number, high: number): number {
  const down = Math.floor(deg / 5) * 5;
  const up = down + 5;
  if (down < low) return up;
  if (up > high) return down;
  return deg - down <= up - deg ? down : up;
}
