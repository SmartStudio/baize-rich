// Structured event log. Every state change the UI might want to show (or a
// developer might want to debug) is emitted as a GameEvent with a Chinese
// `text` line for the 战报 panel plus machine-readable fields.
import type { GameState, MiniGameId, MiniGameTier, NodeId } from './types';

export type GameEventType =
  | 'gameStart' | 'roundStart' | 'roundEnd' | 'turnStart' | 'turnEnd'
  | 'roll' | 'step' | 'teleport' | 'fork' | 'toll'
  | 'salary' | 'buy' | 'rent' | 'rentFree' | 'upgrade'
  | 'stones' | 'pills' | 'cult' | 'card' | 'cast' | 'block'
  | 'event' | 'bind' | 'status'
  | 'breakthrough' | 'manifest'
  | 'bankrupt' | 'win' | 'gameEnd' | 'info'
  | 'duel' | 'skill' | 'roadblock' | 'roadblockHit' | 'roadblockGone'
  | 'miniGame';

/** 炼丹房结果；reward 是净得失。 */
export interface MiniGameResult {
  game: MiniGameId;
  tier: MiniGameTier;
  reward: { pills: number; stones: number };
}

/** 斗法结果（index 0 = 攻方, 1 = 守方）。 */
export interface DuelResult {
  attacker: number;
  defender: number;
  bets: [number, number];
  rolls: [number, number];
  /** 英雄加成（剑修攻 / 体修守） */
  bonus: [number, number];
  totals: [number, number];
  winner: number;
  loser: number;
  /** 败者交给胜者的灵石 */
  amount: number;
}

export interface GameEvent {
  seq: number;
  round: number;
  type: GameEventType;
  text: string;
  player?: number;
  node?: NodeId;
  from?: NodeId;
  amount?: number;
  dice?: [number, number];
  duel?: DuelResult;
  miniGame?: MiniGameResult;
  /** Deep copy of the state right after this event (only when Game option snapshots=true). */
  snap?: GameState;
}
