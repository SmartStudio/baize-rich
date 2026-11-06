// ---------------------------------------------------------------------------
// Data-file types (mirror data/*.json) and game-state types.
// Everything in GameState is plain JSON-serialisable data.
// ---------------------------------------------------------------------------

export type RegionId = 'wood' | 'fire' | 'water' | 'earth';
export type RoadId = string; // key of BoardData.roads, e.g. 'south'
export type NodeId = string; // e.g. 'W0'..'W18' (one district), 'ALTAR'
export type HeroId = 'body' | 'magic' | 'sword' | 'alch';
export type TileType =
  | 'start' | 'land' | 'gate' | 'alchemy' | 'market' | 'secret'
  | 'spring' | 'beast' | 'ruins' | 'eye' | 'altar';
/** 火候档位。 */
export type MiniGameTier = 'fail' | 'ok' | 'perfect';
/** 境界能力：御器 / 神识 / 元婴遁。 */
export type RealmAbility = 'steer' | 'sense' | 'escape';

// ---- config.json ----------------------------------------------------------

/** One row of the realm table (GDD §5.1). The last row (化神) ends the game. */
export interface RealmData {
  name: string;
  /** 修为条长度。 */
  bar: number;
  /** 突破目标值：2D6 + 加成 ≥ 此值成功。 */
  target: number;
  /** 突破成功进入此境界时获得的能力。 */
  ability: RealmAbility | null;
}

/** One row of the land-level table (GDD §4). Index = level. */
export interface LandLevelData {
  /** 升到此级的花费（× 地价）。Lv0 = 买入。 */
  upgradeCostP: number;
  /** 租金倍数（× R = rentRate × 地价）。 */
  rentMult: number;
  /** 每轮开始给主人的灵草。 */
  herbs: number;
  /** 回合结束站在此地的主人打坐所得修为。 */
  sit: number;
  /** 可在此闭关时的地点加成；null = 不能闭关。 */
  closureBonus: number | null;
}

export interface ConfigData {
  version: string;
  rounds: number;
  startStones: number;
  /** 按座位追加的开局灵石，抵消先手抢地优势（索引 = 座位号）。 */
  seatBonusStones: number[];
  startPills: number;
  startHerbs: number;
  startHand: number;
  handLimit: number;
  salaryPass: number;
  salaryLand: number;
  altarToll: number;
  rentRate: number;
  realms: RealmData[];
  landLevels: LandLevelData[];
  cultivation: {
    /** 吐纳：每个自己的回合结束 */
    breath: number;
    spring: number;
    eye: number;
    /** 服丹：每颗 */
    pill: number;
    /** 白泽问心：停在灵台但不突破 */
    altarCalm: number;
  };
  breakthrough: {
    /** 每颗押上的丹药 */
    pillBonus: number;
    maxPills: number;
    altarBonus: number;
    /** 心境：本境界每失败 1 次 */
    mindBonus: number;
    /** 前辈指点 */
    guidanceBonus: number;
    /** 清心符 */
    calmBonus: number;
    /** 过目不忘：每这么多点感悟突破 +1 */
    insightPer: number;
    /** 过目不忘：感悟加成的上限 */
    insightMax: number;
    /** 引雷破境：在任意格闭关时的地点加成 */
    thunderSite: number;
  };
  alchemy: {
    herbsPerPill: number;
    /** 第一炉火候正中多出的丹药 */
    perfectBonus: number;
    /** 丹道：丹师每次停在丹房多出的丹药 */
    alchBonus: number;
  };
  market: { pillPrice: number; pillMax: number; cardPrice: number; cardMax: number };
  spring: { herbs: number };
  beast: { target: number; herbs: number; loss: number };
  duel: {
    senseBonus: number;
    swordAttack: number;
    bodyDefense: number;
    /** 攻方挑战身怀宝光的守方 */
    glowBonus: number;
    /** 丹药 ≥ 此值即冒宝光 */
    glowAt: number;
    steal: number;
    glowSteal: number;
    /** 输家没有丹药时被夺的灵石 */
    lossStones: number;
  };
  bankrupt: { resetStones: number };
  manifest: { round: number; chartCult: number; giftStones: number; giftPills: number };
  /** 终局比资产时丹药、灵草折合的灵石。 */
  assetValue: { pill: number; herb: number };
  rules: RulesConfig;
}

/** Card / skill numbers stated only in their descriptions (config.json `rules`). */
export interface RulesConfig {
  /** 神行符：本次点数 +1 至 +此值 */
  swiftstepMax: number;
  /** 御骰符：可选点数下限 */
  diceCardMin: number;
  /** 御骰符：可选点数上限 */
  diceCardMax: number;
  /** 镇山：山岳可放在前方 1 至此值格 */
  roadblockRange: number;
  /** 剑遁：只能瞬移到相距不超过此格数（沿路网任意方向）的他人 */
  swordDashRange: number;
}

// ---- board.json -----------------------------------------------------------
export interface BoardNodeData {
  id: NodeId;
  type: TileType;
  pos: [number, number];
  /** 所属灵域。灵田的地价按它分布；非灵田格只用于绘制 */
  region?: RegionId;
  name?: string;
  price?: number;
  /** 灵田所属街道（BoardData.streets 的键），只用于绘制 */
  street?: string;
  /** 所属神道（BoardData.roads 的键），拐入时显示「拐入某神道」并计入进入神道次数 */
  road?: RoadId;
  /** 路网格（除神道与灵台外的所有格）：回首符、镇山只在路网格上生效 */
  outer?: boolean;
  /** 灵台占据的格子矩形 [c0, r0, c1, r1]，仅用于绘制 */
  rect?: [number, number, number, number];
  /** 前进方向的后继格，多于一个即为岔路；next[0] 是主线（默认选项） */
  next: NodeId[];
}
export interface RegionData { name: string; element: string; color: string }
export interface BoardData {
  grid: { cols: number; rows: number; tile: number };
  regions: Record<RegionId, RegionData>;
  roads: Record<RoadId, { name: string }>;
  /** 街道：每个灵域 3 条，每条 3–5 块灵田 */
  streets?: Record<string, { name: string; region: RegionId }>;
  nodes: BoardNodeData[];
  tileTypes: Record<TileType, { name: string; desc: string }>;
  /** 灵田等级的名字，索引 = 等级。 */
  buildings: { level: number; name: string }[];
}

// ---- heroes.json ----------------------------------------------------------
export interface HeroData {
  id: HeroId;
  /** 人物名，界面以它为主。 */
  name: string;
  /** 路数：体修 / 法修 / 剑修 / 丹师。 */
  school: string;
  /** 出身 · 灵根。 */
  origin: string;
  /** 选中台词。 */
  quote: string;
  color: string;
  passive: { id: string; name: string; desc: string; traits: HeroTrait[] };
  skill: HeroSkillData;
}
/** One rule a passive adds. Rules and AI ask `hasTrait`, never the hero id. */
export type HeroTrait =
  /** 斗法守方 +duel.bodyDefense */
  | 'guard'
  /** 自家任意等级的灵田都能闭关；不能闭关的等级按地点加成 0 算 */
  | 'homeClosure'
  /** 走火入魔不掉修为（丹药照扣、心境照加） */
  | 'steadyBar'
  /** 斗法攻方 +duel.swordAttack */
  | 'swordQi'
  /** 每次停在丹房炼丹 +alchemy.alchBonus */
  | 'pillway'
  /** 修为条满后溢出的修为存为感悟，突破时折成加成 */
  | 'insight';
export interface HeroSkillData {
  id: HeroSkillId;
  name: string;
  desc: string;
  timing: 'preroll' | 'action';
  /** 用后隔多少个自己的回合再次可用：本回合用掉，第 turnsTaken + cooldown 个回合起就绪。 */
  cooldown: number;
}
export type HeroSkillId = 'sworddash' | 'thunder' | 'roadblock' | 'daze';

// ---- spells.json ----------------------------------------------------------
export type SpellCat = 'attack' | 'guard' | 'move' | 'mind';
/** preroll 掷骰前 · adjust 掷骰后 · action 行动 · rent 付租 · reaction 被斗法 / 被夺灵 · closure 突破前 */
export type SpellTiming = 'preroll' | 'adjust' | 'action' | 'rent' | 'reaction' | 'closure';
export interface SpellData {
  id: string;
  name: string;
  cat: SpellCat;
  timing: SpellTiming;
  desc: string;
}
export interface SpellsData {
  copiesEach: number;
  categories: Record<SpellCat, { name: string; color: string }>;
  cards: SpellData[];
}

// ---- events.json (机缘卡) --------------------------------------------------
export interface EventEffect {
  cult?: number;
  herbs?: number;
  pills?: number;
  stones?: number;
  draw?: number;
  /** 前辈指点：下一次突破的加成次数 */
  guidance?: number;
  /** 境界序数 ≥ 此值时免疫本卡 */
  immuneRealm?: number;
  /** 宝光外泄：本轮算作身怀宝光 */
  glow?: boolean;
  /** 秘境裂隙：移动到任意秘境格并再抽 1 张 */
  rift?: boolean;
}
export interface EventCardData { id: string; name: string; count: number; good: boolean; desc: string; effect: EventEffect }
export interface EventsData { events: EventCardData[] }

export interface GameData {
  config: ConfigData;
  board: BoardData;
  heroes: HeroData[];
  spells: SpellsData;
  events: EventsData;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface PlayerStats {
  rentCollected: number;
  rentPaid: number;
  /** 闭关突破次数（成功 + 失败） */
  breakthroughs: number;
  /** 走火入魔次数 */
  breakthroughFails: number;
  /** Times the player turned from a gate into a road. */
  roadEntries: number;
  altarVisits: number;
  bankruptcies: number;
  /** 发起的斗法次数 */
  duels: number;
  /** 斗法胜场（攻守皆计） */
  duelWins: number;
  /** 被夺走的丹药（斗法、夺灵符） */
  pillsLost: number;
  pillsMade: number;
  pillsEaten: number;
  /** 修为条满后作废的修为 */
  cultWasted: number;
  /** 主动技能使用次数 */
  skillUses: number;
  /** 玩过的火候小游戏次数 */
  miniGames: number;
}

export interface PlayerState {
  seat: number;
  name: string;
  hero: HeroId;
  pos: NodeId;
  /** Node the last walk entered `pos` from. On a two-way node it fixes the heading (null = default `next[0]`). */
  cameFrom: NodeId | null;
  stones: number;
  herbs: number;
  pills: number;
  /** 境界序数：0 练气 … 4 化神。 */
  realm: number;
  /** 当前境界的修为条（0..bar）。 */
  cult: number;
  /** 心境：本境界失败过的次数，成功后清零。 */
  mind: number;
  /** 前辈指点：下一次突破的加成次数。 */
  guidance: number;
  /** 过目不忘：存下的感悟，下一次闭关时用尽。 */
  insight: number;
  /** 宝光外泄所在的轮次（本轮算作身怀宝光）。 */
  glowRound: number;
  /** 元婴遁最近一次生效的轮次（每轮 1 次）。 */
  escapeRound: number;
  hand: string[];
  bound: boolean;
  turnsTaken: number;
  /** 主动技能在 turnsTaken >= skillReadyTurn 时可用。 */
  skillReadyTurn: number;
  /** 迷魂丹：下一次掷骰移动步数减半（向下取整，至少 1）。 */
  dazed: boolean;
  stats: PlayerStats;
}

export interface TileState {
  owner: number | null;
  level: number;
}

/** Per-turn transient flags (reset at each turn start). */
export interface TurnState {
  seat: number;
  upgraded: boolean;
  /** 本回合已服丹。 */
  ate: boolean;
  /** 本回合已闭关突破。 */
  closed: boolean;
  /** 本回合在白泽灵台停下结算过（白泽问心）。 */
  landedAltar: boolean;
  reverse: boolean;
  lastPath: NodeId[];
  lastDir: 1 | -1;
  /** 本回合已发起过斗法。 */
  duelDone: boolean;
  /** 本次移动途中经过的玩家座位。 */
  passed: number[];
  /** 御骰符：本回合下一次移动改为自选点数。 */
  diceCard: boolean;
}

export type EndReason = 'ascend' | 'roundCap';

export interface GameState {
  seed: number;
  rng: number;
  round: number;
  current: number;
  over: boolean;
  winner: number | null;
  endReason: EndReason | null;
  players: PlayerState[];
  tiles: Record<NodeId, TileState>;
  spellDeck: string[];
  spellDiscard: string[];
  eventDeck: string[];
  eventDiscard: string[];
  manifested: boolean;
  /** 体修镇山的山岳路障：拦下下一个经过它的他人；主人下回合开始时消失。 */
  roadblock: { node: NodeId; seat: number } | null;
  turn: TurnState;
}

export interface GameSetup {
  seed: number;
  players: { name: string; hero: HeroId }[];
}
