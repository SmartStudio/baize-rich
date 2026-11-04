import type { Difficulty, Personality } from '../ai/ai';
import { defaultData } from '../core/data';
import type { SeatControl } from '../core/record';
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
  /** Animation speed multiplier (F toggles 1× / 2×). */
  speed: number;
  /** Started via ?auto=1 (4 AI). Not autosaved, so a demo never overwrites a human game. */
  auto?: boolean;
  /** 继续上局: answers replayed silently before play continues. */
  history?: string[];
}

export function newSession(seed: number, seats: SeatConfig[], speed: number, auto = false): SessionConfig {
  const heroName = (id: HeroId) => defaultData.heroes.find((h) => h.id === id)!.name;
  return {
    setup: { seed, players: seats.map((s, i) => ({ name: `P${i + 1}·${heroName(s.hero)}`, hero: s.hero })) },
    seats: seats.map(({ human, difficulty, personality }) => ({ human, difficulty, personality })),
    speed,
    auto,
  };
}

export function urlParams(): URLSearchParams {
  return new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
