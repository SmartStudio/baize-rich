// The decision interface.
//
// Whenever the rules need a player decision, the engine stops and exposes a
// `PendingChoice` (game.pending). A controller — human UI, AI or test script —
// answers with one of the option ids via `game.answer(id)`. Every decision in
// the game, from "roll the dice" to "use 金光符?", goes through this one door,
// which is what lets the same engine drive the UI, the AI and the headless sim.
import type { MiniGameId, MiniGameTier, NodeId } from './types';

export type PreRollAct =
  | { t: 'roll' }
  | { t: 'cast'; card: string }
  | { t: 'skill' };

export type ActionAct =
  | { t: 'upgrade'; node: NodeId }
  | { t: 'cast'; card: string }
  | { t: 'skill' }
  | { t: 'end' };

export type Target =
  | { t: 'player'; seat: number }
  | { t: 'node'; node: NodeId }
  | { t: 'cancel' };

/** What kind of attack a guard reaction (金光符) is being asked about. */
export type ThreatKind = 'drain' | 'bind';

export type NodePurpose = 'array';

/** Value type carried by the options of each choice kind. */
export interface ChoiceValueMap {
  preRoll: PreRollAct;
  action: ActionAct;
  /** 御骰符 / 灵兽引路: pick the movement value directly. */
  rollValue: number;
  /** Final movement total after 神行符. */
  adjust: number;
  /** At a fork: the next node to step to. */
  fork: NodeId;
  /** At the altar with steps left: stop, or pay toll and leave through this neighbour. */
  altarPass: 'stop' | NodeId;
  /** Leaving the altar at the start of a move: the neighbour to step to. */
  exitRoad: NodeId;
  buy: boolean;
  /** 避劫符 when paying rent. */
  rentReact: boolean;
  /** 金光符 when attacked. */
  guardReact: boolean;
  altar: 'break' | 'calm' | 'leave';
  /** 坊市拍卖: buy 1 修为. */
  auction: boolean;
  /** 坊市: number of spell cards to buy. */
  market: number;
  node: NodeId;
  target: Target;
  /** 斗法：挑战哪位玩家（null = 不斗法）。 */
  duel: number | null;
  /** 斗法：押注几颗灵丹（每颗 +1 点，胜负都消耗）。 */
  duelBet: number;
  /** 炼丹房结果档位（option.id 即 tier），真人由界面小游戏产出。 */
  miniGame: { game: MiniGameId; tier: MiniGameTier };
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
  purpose?: NodePurpose | 'drain' | 'bind' | 'sworddash' | 'swap' | 'roadblock' | 'daze';
  /** 小游戏：玩法 */
  game?: MiniGameId;
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
