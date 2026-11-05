// Structured event log. Every state change the UI might want to show (or a
// developer might want to debug) is emitted as a GameEvent with a Chinese
// `text` line for the 战报 panel plus machine-readable fields.
import type { GameState, NodeId } from './types';

export type GameEventType =
  | 'gameStart' | 'roundStart' | 'roundEnd' | 'turnStart' | 'turnEnd'
  | 'roll' | 'step' | 'teleport' | 'slide' | 'mire' | 'fork' | 'toll'
  | 'salary' | 'buy' | 'rent' | 'rentFree' | 'upgrade' | 'downgrade' | 'ownerChange'
  | 'stones' | 'pills' | 'cult' | 'card' | 'cast' | 'ult' | 'block'
  | 'draw' | 'task' | 'taskDone' | 'event'
  | 'jail' | 'release' | 'bind' | 'status'
  | 'breakthrough' | 'divine' | 'heaven' | 'manifest'
  | 'demonSpawn' | 'demonMove' | 'demonHit' | 'demonGone' | 'eruption'
  | 'veinLord' | 'bankrupt' | 'doubles' | 'win' | 'gameEnd' | 'info'
  | 'duel' | 'bounty' | 'trapSet' | 'trap' | 'skill' | 'roadblock' | 'roadblockHit' | 'roadblockGone';

/** §17 斗法结果（index 0 = 攻方, 1 = 守方）。 */
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
  /** 胜者是否因此领取悬赏令修为 */
  bounty: boolean;
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
  /** Deep copy of the state right after this event (only when Game option snapshots=true). */
  snap?: GameState;
}
