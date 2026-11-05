// Structured event log. Every state change the UI might want to show (or a
// developer might want to debug) is emitted as a GameEvent with a Chinese
// `text` line for the 战报 panel plus machine-readable fields.
import type { GameState, MiniGameId, MiniGameTier, NodeId, SpecialKind, SpiritKind } from './types';

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
  | 'duel' | 'bounty' | 'trapSet' | 'trap' | 'skill' | 'roadblock' | 'roadblockHit' | 'roadblockGone'
  | 'spirit' | 'shop' | 'special' | 'miniGame' | 'hospital' | 'street'
  | 'barrier' | 'barrierHit' | 'blastSet' | 'blast';

/** §18.2 灵体事件。move / expire 的 from、to 是格子；transfer 的 seat 是接手者、giver 是传出者。 */
export interface SpiritEvent {
  kind: SpiritKind;
  action: 'move' | 'possess' | 'transfer' | 'expire';
  seat?: number;
  giver?: number;
  from?: NodeId;
  to?: NodeId;
}

/** §18.5 小游戏结果；reward 是净得失。 */
export interface MiniGameResult {
  game: MiniGameId;
  tier: MiniGameTier;
  reward: { pills: number; stones: number };
  /** 灵骰台：开出的两颗骰（只在回答之后才产生，界面据此演出） */
  roll?: [number, number];
  /** 灵骰台：押的大小 */
  side?: 'big' | 'small';
  /** 灵骰台：押注灵石 */
  stake?: number;
}

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
  spirit?: SpiritEvent;
  miniGame?: MiniGameResult;
  /** §18.4 改建的功能建筑（special 事件） */
  special?: SpecialKind;
  /** §18.3 买下的牌（shop 事件） */
  card?: string;
  /** §18.1 刚凑齐的街（street 事件，seat 即 player） */
  street?: string;
  /** Deep copy of the state right after this event (only when Game option snapshots=true). */
  snap?: GameState;
}
