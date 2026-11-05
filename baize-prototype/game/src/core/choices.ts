// The decision interface.
//
// Whenever the rules need a player decision, the engine stops and exposes a
// `PendingChoice` (game.pending). A controller — human UI, AI or test script —
// answers with one of the option ids via `game.answer(id)`. Every decision in
// the game, from "roll the dice" to "use 金光符?", goes through this one door,
// which is what lets the same engine drive the UI, the AI and the headless sim.
import type { MiniGameId, MiniGameTier, NodeId, RegionId, SpecialKind } from './types';

export type PreRollAct =
  | { t: 'roll' }
  | { t: 'cast'; card: string }
  | { t: 'ult' }
  | { t: 'shrink' }
  | { t: 'skill' };

export type ActionAct =
  /** 升级一级；带 special 时改为把脚下的 Lv0 灵田改建为功能建筑（§18.4，与升级共用每回合 1 次）。 */
  | { t: 'upgrade'; node: NodeId; special?: SpecialKind }
  | { t: 'cast'; card: string }
  | { t: 'ult' }
  | { t: 'skill' }
  | { t: 'trap'; node: NodeId }
  | { t: 'end' };

export type Target =
  | { t: 'land'; node: NodeId }
  | { t: 'demon' }
  | { t: 'player'; seat: number }
  | { t: 'node'; node: NodeId }
  | { t: 'cancel' };

/** What kind of attack/threat a guard reaction (金光符) is being asked about. */
export type ThreatKind = 'thunder' | 'fivethunder' | 'drain' | 'bind' | 'buyout' | 'eruption';

export type NodePurpose = 'array' | 'guide' | 'shrink' | 'auspice';

/** Value type carried by the options of each choice kind. */
export interface ChoiceValueMap {
  preRoll: PreRollAct;
  action: ActionAct;
  /** 灵兽引路: pick the movement value directly. */
  rollValue: number;
  /** Final movement total after 神行符 / 身轻如燕 / 御剑飞行. */
  adjust: number;
  /** 迷踪: +1 clockwise, -1 counter-clockwise. */
  direction: 1 | -1;
  /** At a fork: the next node to step to. */
  fork: NodeId;
  /** At the altar with steps left: stop, or pay toll and leave through this neighbour. */
  altarPass: 'stop' | NodeId;
  /** Leaving the altar at the start of a move: the neighbour to step to. */
  exitRoad: NodeId;
  buy: boolean;
  /** 避劫符 when paying rent. */
  rentReact: boolean;
  /** 金光符 when attacked / bought out / erupted. */
  guardReact: boolean;
  altar: 'break' | 'calm' | 'leave';
  divinePick: string;
  heavenPick: string;
  /** 神识: draw 2 机缘 choose 1. */
  eventPick: string;
  /** 坊市拍卖: buy 1 修为. */
  auction: boolean;
  /** 坊市: number of spell cards to buy. */
  market: number;
  node: NodeId;
  target: Target;
  region: RegionId | 'cancel';
  cliff: 'pay' | 'roll' | 'calm';
  /** §17 斗法：挑战哪位玩家（null = 不斗法）。 */
  duel: number | null;
  /** §17 斗法：押注几颗灵丹（每颗 +1 点，胜负都消耗）。 */
  duelBet: number;
  /** §18.3 百宝阁：买哪件（null = 离开）。 */
  shop: { card: string; price: number } | null;
  /** §18.5 小游戏结果档位（option.id 即 tier），真人由界面小游戏产出。 */
  miniGame: { game: MiniGameId; tier: MiniGameTier };
  /** §18.5 灵骰台押注。 */
  diceBet: DiceBet;
  /** §18.4 挪移阵：传送到哪座（null = 留下）。 */
  portal: NodeId | null;
}

export interface DiceBet {
  /** 押注灵石（config.rules.diceStakes 之一） */
  stake: number;
  side: 'big' | 'small';
}
export type ChoiceKind = keyof ChoiceValueMap;

export interface ChoiceOption<V> {
  id: string;
  label: string;
  value: V;
  /** Grid node this option refers to (lets the UI make board tiles clickable). */
  node?: NodeId;
  hint?: string;
}

export interface ChoiceContext {
  /** Free-form extra info for UI/AI (e.g. rent amount, remaining steps, purpose). */
  rent?: number;
  remaining?: number;
  node?: NodeId;
  price?: number;
  card?: string;
  threat?: ThreatKind;
  attacker?: number;
  purpose?: NodePurpose | 'thunder' | 'fivethunder' | 'drain' | 'bind' | 'buyout' | 'treasure'
    | 'sworddash' | 'swap' | 'roadblock' | 'daze' | 'barrier' | 'blast';
  /** 小游戏：玩法（miniGame / diceBet） */
  game?: MiniGameId;
  /** 灵骰台：已押的注（miniGame 询问时可见） */
  diceBet?: DiceBet;
  dice?: [number, number];
  base?: number;
  cost?: number;
  /** 斗法：守方座位 */
  defender?: number;
  /** 斗法：本局赌注（败者将交出的灵石，按当前双方灵石计） */
  stake?: number;
  /** 斗法押注阶段：对手已押的灵丹（守方决定时可见） */
  bet?: number;
}

export interface PendingChoiceOf<K extends ChoiceKind> {
  seq: number;
  player: number;
  kind: K;
  title: string;
  desc?: string;
  options: ChoiceOption<ChoiceValueMap[K]>[];
  /** Option id that means "cancel / back out" (Esc in the UI). */
  cancelId?: string;
  /** Option id used for Space / default confirmation. */
  defaultId?: string;
  ctx: ChoiceContext;
}

/** Discriminated union over all choice kinds (switch on `.kind` to narrow). */
export type PendingChoice = { [K in ChoiceKind]: PendingChoiceOf<K> }[ChoiceKind];

export interface ChoiceSpec<K extends ChoiceKind> {
  player: number;
  kind: K;
  title: string;
  desc?: string;
  options: ChoiceOption<ChoiceValueMap[K]>[];
  cancelId?: string;
  defaultId?: string;
  ctx?: ChoiceContext;
  /** Present even if there is a single option (main-phase prompts). */
  forceAsk?: boolean;
}

/** Anything that can answer choices: AI, scripted test controller, UI bridge. */
export interface Controller {
  decide(choice: PendingChoice): string;
}
