// The decision interface.
//
// Whenever the rules need a player decision, the engine stops and exposes a
// `PendingChoice` (game.pending). A controller — human UI, AI or test script —
// answers with one of the option ids via `game.answer(id)`. Every decision in
// the game, from "roll the dice" to "use 金光符?", goes through this one door,
// which is what lets the same engine drive the UI, the AI and the headless sim.
import type { MiniGameTier, NodeId } from './types';

export type PreRollAct =
  | { t: 'roll' }
  | { t: 'cast'; card: string }
  | { t: 'skill' }
  | { t: 'closure' };

export type ActionAct =
  | { t: 'upgrade'; node: NodeId }
  | { t: 'eat' }
  | { t: 'brew' }
  | { t: 'cast'; card: string }
  | { t: 'skill' }
  | { t: 'closure' }
  | { t: 'end' };

export type Target =
  | { t: 'player'; seat: number }
  | { t: 'node'; node: NodeId }
  | { t: 'cancel' };

/** What a guard reaction (金光符) is being asked about. */
export type ThreatKind = 'duel' | 'drain';

/** 坊市: what to buy on this visit. */
export type MarketBuy = { item: 'pill' | 'card'; n: number } | { item: 'none' };

/** 白泽现世的四份机缘。 */
export type ManifestGift = 'chart' | 'stones' | 'pills' | 'guide';

/** Final move after the roll: steps, whether 神行符 is spent, the 御器 offset used. */
export interface AdjustValue {
  steps: number;
  card: boolean;
  steer: -1 | 0 | 1;
}

/** Value type carried by the options of each choice kind. */
export interface ChoiceValueMap {
  preRoll: PreRollAct;
  action: ActionAct;
  /** 御骰符: pick the movement value directly. */
  rollValue: number;
  /** After the roll: 御器 ±1 and / or 神行符 +1..+3. */
  adjust: AdjustValue;
  /** At a fork: the next node to step to. */
  fork: NodeId;
  /** At the altar with steps left: stop, or pay toll and leave through this neighbour. */
  altarPass: 'stop' | NodeId;
  /** Leaving the altar at the start of a move: the neighbour to step to. */
  exitRoad: NodeId;
  buy: boolean;
  /** 避劫符 when paying rent. */
  rentReact: boolean;
  /** 金光符 when challenged or drained. */
  guardReact: boolean;
  /** 闭关突破: pills staked (each +breakthrough.pillBonus); null = 返回 to the choice that opened the 闭关, nothing spent. */
  stake: number | null;
  /** 清心符 before the breakthrough roll. */
  calm: boolean;
  /** 丹房: how many pills to brew. */
  brew: number;
  market: MarketBuy;
  /** 古修洞府: which of the two drawn 机缘 to keep (event id). */
  fortunePick: string;
  manifestPick: ManifestGift;
  /** 秘境裂隙: the 秘境 to move to. */
  node: NodeId;
  target: Target;
  /** 斗法：挑战哪位玩家（null = 不斗法）。 */
  duel: number | null;
  /** 火候结果档位（option.id 即 tier），真人由界面小游戏产出。 */
  miniGame: { tier: MiniGameTier };
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

export type ChoicePurpose = 'rift' | 'drain' | 'bind' | 'sworddash' | 'roadblock' | 'daze';

export interface ChoiceContext {
  /** Free-form extra info for UI/AI (e.g. rent amount, remaining steps, purpose). */
  rent?: number;
  remaining?: number;
  node?: NodeId;
  price?: number;
  threat?: ThreatKind;
  attacker?: number;
  purpose?: ChoicePurpose;
  dice?: [number, number];
  base?: number;
  /** 闭关突破：不押丹时的检定加成、目标值与其中的地点加成 */
  bonus?: number;
  target?: number;
  site?: number;
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
