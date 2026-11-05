import type { Difficulty, Personality } from '../ai/ai';
import { defaultData } from '../core/data';
import { HERO_IDS } from '../core/heroes';
import type { GameRecord, SeatControl } from '../core/record';
import type { GameSetup, HeroId } from '../core/types';

export interface SeatConfig {
  human: boolean;
  hero: HeroId;
  difficulty: Difficulty;
  personality: Personality;
}

export interface SessionConfig {
  setup: GameSetup;
  seats: SeatControl[];
  /** Animation speed multiplier (F cycles 0.5/1/2/4×). */
  speed: number;
  /** Started via ?auto=1 (4 AI). Not autosaved, so a demo never overwrites a human game. */
  auto?: boolean;
  /** 继续上局: answers replayed silently before play continues. */
  history?: string[];
}

/** AI personalities by seat, so a default table always mixes play styles. */
export const SEAT_PERSONAS: Personality[] = ['steady', 'aggressive', 'miser', 'steady'];

/** A lone human is named 你 so the board, log and result screen say who "you" are; hot-seat games keep P1–P4. */
export function newSession(seed: number, seats: SeatConfig[], speed: number, auto = false): SessionConfig {
  const heroName = (id: HeroId) => defaultData.heroes.find((h) => h.id === id)!.name;
  const solo = seats.filter((s) => s.human).length === 1;
  return {
    setup: { seed, players: seats.map((s, i) => ({ name: `${solo && s.human ? '你' : `P${i + 1}`}·${heroName(s.hero)}`, hero: s.hero })) },
    seats: seats.map(({ human, difficulty, personality }) => ({ human, difficulty, personality })),
    speed,
    auto,
  };
}

/** Quick start: the chosen hero is the human in seat 1, the other heroes are AI at one difficulty. */
export function quickSeats(chosen: HeroId, difficulty: Difficulty): SeatConfig[] {
  const order = [chosen, ...HERO_IDS.filter((h) => h !== chosen)];
  return order.map((hero, i) => ({ human: i === 0, hero, difficulty, personality: SEAT_PERSONAS[i] }));
}

export function resumeSession(r: GameRecord): SessionConfig {
  return { setup: r.setup, seats: r.seats, speed: urlSpeed(1), history: r.history };
}

export function urlParams(): URLSearchParams {
  return new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** `?seed=` when given, otherwise a fresh random seed. */
export function urlSeed(): number {
  const s = urlParams().get('seed');
  return s !== null ? Number(s) : randomSeed();
}

export function urlSpeed(fallback: number): number {
  const s = urlParams().get('speed');
  return s !== null ? Number(s) : fallback;
}
