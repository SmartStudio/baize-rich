// Structured event log. Every state change the UI might want to show (or a
// developer might want to debug) is emitted as a GameEvent with a Chinese
// `text` line for the 战报 panel plus machine-readable fields.
import type { GameState, MiniGameTier, NodeId } from './types';

export type GameEventType =
  | 'gameStart' | 'roundStart' | 'roundEnd' | 'turnStart' | 'turnEnd'
  | 'roll' | 'step' | 'teleport' | 'fork' | 'toll'
  | 'salary' | 'buy' | 'rent' | 'rentFree' | 'upgrade'
  | 'stones' | 'herbs' | 'pills' | 'cult' | 'card' | 'cast' | 'block'
  | 'event' | 'bind' | 'status' | 'beast'
  | 'breakthrough' | 'manifest'
  | 'bankrupt' | 'win' | 'gameEnd' | 'info'
  | 'duel' | 'skill' | 'roadblock' | 'roadblockHit' | 'roadblockGone'
  | 'miniGame';

/** 第一炉的火候结果；pills 是这一次停留炼出的丹药总数。 */
export interface MiniGameResult {
  tier: MiniGameTier;
  brewed: number;
  pills: number;
}

/** 斗法结果（index 0 = 攻方, 1 = 守方）。 */
export interface DuelResult {
  attacker: number;
  defender: number;
  rolls: [number, number];
  /** 境界差、神识、剑气、铜皮铁骨、宝光之和 */
  bonus: [number, number];
  totals: [number, number];
  winner: number;
  loser: number;
  /** 输家被夺走的丹药 / 灵石；元婴遁生效时均为 0 */
  pills: number;
  stones: number;
  escaped: boolean;
}

/** 突破检定的各项加成；site 可为负。 */
export interface BreakthroughBonuses {
  pills: number;
  site: number;
  mind: number;
  guidance: number;
  /** 过目不忘 */
  insight: number;
  /** 战意 */
  momentum: number;
  calm: number;
}

/** 闭关突破的完整检定（GDD §5.3）。 */
export interface BreakthroughResult {
  from: number;
  dice: [number, number];
  stake: number;
  bonuses: BreakthroughBonuses;
  total: number;
  target: number;
  success: boolean;
  /** 失败时修为条掉的点数 */
  cultLost: number;
}

/** 修为变化：gained 计入修为条，insight 溢出存为感悟，wasted 溢出作废。 */
export interface CultChange {
  source: CultSource;
  gained: number;
  insight: number;
  wasted: number;
}

export type CultSource = 'breath' | 'sit' | 'spring' | 'eye' | 'pill' | 'altar' | 'event' | 'manifest';

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
  breakthrough?: BreakthroughResult;
  cult?: CultChange;
  miniGame?: MiniGameResult;
  /** Deep copy of the state right after this event (only when Game option snapshots=true). */
  snap?: GameState;
}
