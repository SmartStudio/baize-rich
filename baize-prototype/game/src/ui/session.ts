import type { Difficulty, Personality } from '../ai/ai';
import type { HeroId } from '../core/types';

export interface SeatConfig {
  human: boolean;
  hero: HeroId;
  difficulty: Difficulty;
  personality: Personality;
}

export interface SessionConfig {
  seed: number;
  seats: SeatConfig[];
  /** Animation speed multiplier (F toggles 1× / 2×). */
  speed: number;
  /** Started via ?auto=1 (4 AI). */
  auto?: boolean;
}

export function urlParams(): URLSearchParams {
  return new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
