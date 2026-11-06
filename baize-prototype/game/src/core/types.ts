// ---------------------------------------------------------------------------
// Data-file types (mirror data/*.json) and game-state types.
// Everything in GameState is plain JSON-serialisable data.
// ---------------------------------------------------------------------------

export type RegionId = 'wood' | 'fire' | 'water' | 'earth';
export type RoadId = string; // key of BoardData.roads, e.g. 'south'
export type NodeId = string; // e.g. 'W0'..'W18' (one district), 'ALTAR'
export type HeroId = 'body' | 'magic' | 'sword' | 'alch';
export type TileType =
  | 'start' | 'land' | 'gate' | 'trial' | 'spring' | 'market'
  | 'furnace' | 'cliff' | 'array' | 'shrine' | 'altar'
  | 'shop' | 'minigame' | 'hospital';
/** 小游戏格的玩法：炼丹房 / 灵骰台。 */
export type MiniGameId = 'alchemy' | 'dice';
/** 火候档位。 */
export type MiniGameTier = 'fail' | 'ok' | 'perfect';

// ---- config.json ----------------------------------------------------------
export interface ConfigData {
  version: string;
  rounds: number;
  winCultivation: number;
  startStones: number;
  /** 按座位追加的开局灵石，抵消先手抢地优势（索引 = 座位号）。 */
  seatBonusStones: number[];
  startPills: number;
  startHand: number;
  handLimit: number;
  salaryPass: number;
  salaryLand: number;
  marketCardPrice: number;
  marketMaxBuy: number;
  altarToll: number;
  breakthroughThresholds: number[];
  breakthroughCost: number[];
  rentRate: number;
  levelRentMult: number[];
  levelUpgradeCostP: number[];
  lv4PillCost: number;
  cultivationOnBuild: Record<string, number>;
  bankrupt: { resetStones: number; cultivationLoss: number };
  baizeManifestRound: number;
  manifestRentMult: number;
  badLuckStreak: number;
  pillValueInStones: number;
  rules: RulesConfig;
}

/** Numbers stated only in GDD text or card descriptions (config.json `rules`). */
export interface RulesConfig {
  /** 丹道营商：丹师购地折扣 */
  alchBuyDiscount: number;
  /** 剑气：剑修经过他人时夺取的灵石 */
  swordQiSteal: number;
  /** 神行符：本次点数 +1 至 +此值 */
  swiftstepMax: number;
  /** 灵息：法修被动获得的灵丹 */
  magicPassivePills: number;
  /** 灵泉：获得灵丹 */
  springPills: number;
  /** 丹炉：获得灵丹 */
  furnacePills: number;
  /** 白泽祠：获得灵丹 */
  shrinePills: number;
  /** 灵兽引路：可选点数下限 */
  beastRollMin: number;
  /** 灵兽引路：可选点数上限 */
  beastRollMax: number;
  /** 斗法：每方最多押注的灵丹（每颗 +1 点） */
  duelMaxPills: number;
  /** 斗法：剑修主动挑战时 +点 */
  swordDuelAttack: number;
  /** 斗法：体修被挑战时 +点 */
  bodyDuelDefense: number;
  /** 斗法：败者交出自身灵石的比例 */
  duelStealPct: number;
  /** 斗法：单次斗法夺取灵石上限 */
  duelStealMax: number;
  /** 主动技能：冷却（自己的回合数） */
  skillCooldownTurns: number;
  /** 镇山：山岳可放在前方 1 至此值格 */
  roadblockRange: number;
  /** 乾坤挪移：只能与路网上相距不超过此格数的他人互换 */
  swapRange: number;
  /** 剑遁：只能瞬移到相距不超过此格数（沿路网任意方向）的他人 */
  swordDashRange: number;
  /** 炼丹房小游戏奖励的灵丹（按档位） */
  miniGameRewards: Record<MiniGameTier, number>;
  /** 御骰符：可选点数下限 */
  diceCardMin: number;
  /** 御骰符：可选点数上限 */
  diceCardMax: number;
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
  /** 路网格（除神道与灵台外的所有格）：回首符、镇山、乾坤挪移只在路网格上生效 */
  outer?: boolean;
  /** 灵台占据的格子矩形 [c0, r0, c1, r1]，仅用于绘制 */
  rect?: [number, number, number, number];
  /** 前进方向的后继格，多于一个即为岔路；next[0] 是主线（默认选项） */
  next: NodeId[];
  /** 小游戏格（type = minigame）的玩法 */
  game?: MiniGameId;
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
  /** 小游戏玩法的名字与说明 */
  games?: Record<MiniGameId, { name: string; desc: string }>;
  buildings: { level: number; name: string }[];
}

// ---- heroes.json ----------------------------------------------------------
export interface HeroData {
  id: HeroId;
  name: string;
  role: string;
  color: string;
  passive: { id: string; name: string; desc: string };
  /** 主动技能：免费，冷却 rules.skillCooldownTurns 个自己的回合。 */
  skill: { id: HeroSkillId; name: string; desc: string; timing: 'preroll' | 'action' };
}
export type HeroSkillId = 'sworddash' | 'swap' | 'roadblock' | 'daze';

// ---- spells.json ----------------------------------------------------------
export type SpellCat = 'attack' | 'guard' | 'move' | 'wealth';
export type SpellTiming = 'action' | 'reaction' | 'rent' | 'preroll';
export interface SpellData {
  id: string;
  name: string;
  cat: SpellCat;
  cost: number;
  timing: SpellTiming;
  desc: string;
}
export interface SpellsData {
  copiesEach: number;
  categories: Record<SpellCat, { name: string; color: string }>;
  cards: SpellData[];
}

// ---- events.json ----------------------------------------------------------
export interface EventEffect {
  stones?: number;
  chooseRoll?: boolean;
  draw?: number;
  pills?: number;
  allPills?: number;
  buyCultivation?: number;
  moveBack?: number;
}
export interface EventCardData { id: string; name: string; good: boolean; desc: string; effect: EventEffect }
export interface EventsData { events: EventCardData[] }

// ---- blessings.json -------------------------------------------------------
export interface BlessingsData {
  realms: { min: number; name: string }[];
}

export interface GameData {
  config: ConfigData;
  board: BoardData;
  heroes: HeroData[];
  spells: SpellsData;
  events: EventsData;
  blessings: BlessingsData;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface PlayerStats {
  rentCollected: number;
  rentPaid: number;
  breakthroughs: number;
  /** Times the player turned from a gate into a road. */
  roadEntries: number;
  altarVisits: number;
  bankruptcies: number;
  /** 发起的斗法次数 */
  duels: number;
  /** 斗法胜场（攻守皆计） */
  duelWins: number;
  /** 主动技能使用次数 */
  skillUses: number;
  /** 玩过的小游戏次数 */
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
  pills: number;
  cultBase: number;
  /** Historical maximum of cultivation (drives breakthrough opportunities). */
  peakCult: number;
  btEarned: number;
  btUsed: number;
  hand: string[];
  bound: boolean;
  turnsTaken: number;
  /** 灵兽引路: next movement value chosen 1–6. */
  chooseRoll: boolean;
  badStreak: number;
  /** 主动技能在 turnsTaken >= skillReadyTurn 时可用。 */
  skillReadyTurn: number;
  /** 本轮已被挑战过斗法（state.round 相等时不可再被挑战）。 */
  duelShieldRound: number;
  /** 迷魂丹：下一次掷骰移动步数减半（向下取整，至少 1）。 */
  dazed: boolean;
  /** "<node>:<level>" — first-time building cultivation already granted. */
  milestones: string[];
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
  // per-move modifiers (reset after each movement)
  swiftstep: boolean;
  reverse: boolean;
  lastPath: NodeId[];
  lastDir: 1 | -1;
  /** 本回合已发起过斗法。 */
  duelDone: boolean;
  /** 本次移动途中超过的玩家座位。 */
  passed: number[];
  /** 御骰符：本回合下一次移动改为自选点数。 */
  diceCard: boolean;
}

export interface GameState {
  seed: number;
  rng: number;
  round: number;
  current: number;
  over: boolean;
  winner: number | null;
  endReason: 'cultivation' | 'roundCap' | null;
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
