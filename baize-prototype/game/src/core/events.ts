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
  | 'veinLord' | 'bankrupt' | 'doubles' | 'win' | 'gameEnd' | 'info';

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
  /** Deep copy of the state right after this event (only when Game option snapshots=true). */
  snap?: GameState;
}
