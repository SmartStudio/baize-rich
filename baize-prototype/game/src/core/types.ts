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
/** 小游戏结果档位（灵骰台只用 fail / perfect）。 */
export type MiniGameTier = 'fail' | 'ok' | 'perfect';
/** 功能建筑：药园 / 集市 / 挪移阵。 */
export type SpecialKind = 'garden' | 'bazaar' | 'portal';
/** 附身灵体：福缘灵狐（吉）/ 心魔（凶）。 */
export type SpiritKind = 'fox' | 'heart';

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
  cliffFee: number;
  cliffMaxTurns: number;
  maxDoubles: number;
  marketCardPrice: number;
  marketMaxBuy: number;
  altarToll: number;
  breakthroughThresholds: number[];
  breakthroughCost: number[];
  breakthroughDraw: number;
  breakthroughDrawLowest: number;
  maxDivine: number;
  shrineDiscount: number;
  demonCostPenalty: number;
  rentRate: number;
  levelRentMult: number[];
  levelUpgradeCostP: number[];
  lv4PillCost: number;
  cultivationOnBuild: Record<string, number>;
  veinLordMinLands: number;
  veinLordCultivation: number;
  monopolyRentMult: number;
  endgameRounds: number[];
  endgameRentMult: number;
  bankrupt: { resetStones: number; cultivationLoss: number };
  eruptionRounds: number[];
  demon: { spawnRounds: number[]; hp: number; stayRounds: number; movePerRound: number };
  baizeManifestRound: number;
  manifestRentMult: number;
  ult: { pillCost: number; maxUses: number };
  badLuckStreak: number;
  maxActiveTasks: number;
  pillValueInStones: number;
  rules: RulesConfig;
}

/** Numbers stated only in GDD text or card descriptions (config.json `rules`). */
export interface RulesConfig {
  /** §9.4 / §12 丹道营商：丹师购地折扣（8 折） */
  alchBuyDiscount: number;
  /** 折扣符：购地 / 升级折扣（7 折） */
  discountCardMult: number;
  /** 灵丹换地：收购价为投入总价的倍数 */
  buyoutMult: number;
  /** 剑气：剑修经过他人时夺取的灵石 */
  swordQiSteal: number;
  /** 点金符：获得灵石 */
  goldtouchStones: number;
  /** 神行符：本次点数 +1 至 +此值 */
  swiftstepMax: number;
  /** 身轻如燕：移动总点数 ±此值 */
  swiftDivineDelta: number;
  /** 御剑飞行：移动点数 ±此值 */
  swordUltDelta: number;
  /** 灵息：法修被动获得的灵丹 */
  magicPassivePills: number;
  /** 聚灵：每回合首次收租获得的灵丹 */
  gatherPills: number;
  /** 点石成金：收租倍率（+20%） */
  midasMult: number;
  /** 金身：每隔几回合自动抵挡 1 次 */
  goldbodyCooldownRounds: number;
  /** 缩地成寸：每隔几回合可用 1 次 */
  shrinkCooldownRounds: number;
  /** 丹心：回合开始时灵丹低于此值则 +1 */
  pillheartBelow: number;
  /** 不动明王：免租持续回合数（本回合与下回合） */
  immovableTurns: number;
  /** §9.5 天赐 白泽护道：持续轮数 */
  wardRounds: number;
  /** §9.5 天赐 白泽图：获得修为 */
  chartCultivation: number;
  /** §9.5 天赐 白泽图：抽符箓张数 */
  chartDraw: number;
  /** §9.5 天赐 天降祥瑞：免费升级的洞府数 */
  auspiceLands: number;
  /** §9.5 天赐 灵脉馈赠：获得灵石 */
  veinStones: number;
  /** §9.5 天赐 丹霞：获得灵丹 */
  dawnPills: number;
  /** §8.1 / §10 悬赏：获得修为 */
  bountyCultivation: number;
  /** §10 斩妖除魔：对天魔最后一击获得修为 */
  demonLastHitCultivation: number;
  /** 五雷符：对天魔伤害 */
  thunderDemonDamage: number;
  /** 法修大招：对天魔伤害 */
  magicUltDemonDamage: number;
  /** 镇妖：对天魔伤害倍率 */
  subdueDamageMult: number;
  /** §4 灵泉：获得灵丹 */
  springPills: number;
  /** §4 丹炉：获得灵丹 */
  furnacePills: number;
  /** §4 白泽祠：获得灵丹 */
  shrinePills: number;
  /** §11.2 灵兽引路：可选点数下限 */
  beastRollMin: number;
  /** §11.2 灵兽引路：可选点数上限 */
  beastRollMax: number;
  /** §9.4 神识：抽机缘时抽几选 1 */
  senseDrawCount: number;
  /** §17 斗法：每方最多押注的灵丹（每颗 +1 点） */
  duelMaxPills: number;
  /** §17 斗法：剑修主动挑战时 +点 */
  swordDuelAttack: number;
  /** §17 斗法：体修被挑战时 +点 */
  bodyDuelDefense: number;
  /** §17 斗法：败者交出自身灵石的比例 */
  duelStealPct: number;
  /** §17 斗法：单次斗法夺取灵石上限 */
  duelStealMax: number;
  /** §17 悬赏令：持令者至少需要的修为 */
  bountyMinCult: number;
  /** §17 悬赏令：斗法击败持令者获得的修为 */
  bountyDuelCultivation: number;
  /** §17 禁制：布置一处花费的灵丹 */
  trapPillCost: number;
  /** §17 禁制：每名玩家同时生效的上限 */
  trapMaxPerPlayer: number;
  /** §17 禁制：触发者交给地主的灵石 */
  trapStones: number;
  /** §12 主动技能：冷却（自己的回合数） */
  skillCooldownTurns: number;
  /** §12 镇山：山岳可放在前方 1 至此值格 */
  roadblockRange: number;
  /** §12 乾坤挪移：只能与外环上相距不超过此格数（顺逆时针取近）的他人互换 */
  swapRange: number;
  /** §12 剑遁：只能瞬移到相距不超过此格数（沿路网任意方向）的他人 */
  swordDashRange: number;
  /** §18.1 整街：一人拥有一条街的全部灵田时，该街租金倍率 */
  streetRentMult: number;
  /** §18.2 福缘灵狐：附身者收租倍率 */
  foxRentMult: number;
  /** §18.2 福缘灵狐：附身者购地价格倍率（8 折） */
  foxLandDiscount: number;
  /** §18.2 心魔：附身者付租倍率 */
  heartRentMult: number;
  /** §18.2 心魔：附身者每个自己的回合开始失去的灵丹 */
  heartPills: number;
  /** §18.2 附身持续：附身者自己的回合数 */
  spiritTurns: number;
  /** §18.2 每轮结束时灵体游走 1 至此值步 */
  spiritMoveMax: number;
  /** §18.4 药园：每轮开始拥有者获得的灵丹 */
  gardenPills: number;
  /** §18.4 集市：他人停留时付的过路费（代替租金） */
  bazaarFee: number;
  /** §18.4 挪移阵：传送一次花费的灵丹（0 = 免费） */
  portalPills: number;
  /** §18.4 修为 for the first 功能建筑 a player builds on a given land (counts as one 筑府 milestone). */
  specialCultivation: number;
  /** §18.5 小游戏奖励的灵丹（按玩法、档位） */
  miniGameRewards: Record<MiniGameId, Record<MiniGameTier, number>>;
  /** §18.5 灵骰台可押的灵石档位 */
  diceStakes: number[];
  /** §18.5 灵骰台猜中时押注返还的倍数（2 = 翻倍） */
  diceWinMult: number;
  /** §18.5 灵骰台：两骰之和不小于此值为「大」 */
  diceBigMin: number;
  /** §18.5 灵骰台：两骰之和不大于此值为「小」（中间的点数庄家通吃） */
  diceSmallMax: number;
  /** §18.3 御骰符：可选点数下限 */
  diceCardMin: number;
  /** §18.3 御骰符：可选点数上限 */
  diceCardMax: number;
  /** §18.3 路障符：可放在前方 1 至此值格 */
  barrierRange: number;
  /** §18.3 医馆：被爆炎阵炸伤后休养（跳过）的回合数 */
  hospitalTurns: number;
}

// ---- board.json -----------------------------------------------------------
export interface BoardNodeData {
  id: NodeId;
  type: TileType;
  pos: [number, number];
  /** 所属灵域。灵田的租金、灵脉之主等按它计算；非灵田格只用于缩地成寸的「当前灵域」 */
  region?: RegionId;
  name?: string;
  price?: number;
  /** 灵田所属街道（BoardData.streets 的键），供绘制与后续「整街」规则使用 */
  street?: string;
  /** 所属神道（BoardData.roads 的键），拐入时显示「拐入某神道」并计入进入神道次数 */
  road?: RoadId;
  /** 路网格（除神道与灵台外的所有格）：迷踪、逆行符、遁地符、缩地成寸、镇山、乾坤挪移只在路网格上生效 */
  outer?: boolean;
  /** 灵台占据的格子矩形 [c0, r0, c1, r1]，仅用于绘制 */
  rect?: [number, number, number, number];
  /** 前进方向的后继格，多于一个即为岔路；next[0] 是主线（默认选项） */
  next: NodeId[];
  /** 小游戏格（type = minigame）的玩法 */
  game?: MiniGameId;
}
export interface RegionData { name: string; element: string; rule: string; ruleName: string; color: string }
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
  /** 功能建筑的名字与说明 */
  specials?: Record<SpecialKind, { name: string; desc: string }>;
  /** 灵体出生 / 重生的候选格（缺省 = 本图没有灵体） */
  spiritSpawns?: NodeId[];
  buildings: { level: number; name: string }[];
}

// ---- heroes.json ----------------------------------------------------------
export interface HeroData {
  id: HeroId;
  name: string;
  role: string;
  color: string;
  passive: { id: string; name: string; desc: string };
  ult: { id: string; name: string; desc: string };
  /** 主动技能：免费，冷却 rules.skillCooldownTurns 个自己的回合。 */
  skill: { id: HeroSkillId; name: string; desc: string; timing: 'preroll' | 'action' };
}
export type HeroSkillId = 'sworddash' | 'swap' | 'roadblock' | 'daze';

// ---- spells.json ----------------------------------------------------------
export type SpellCat = 'attack' | 'guard' | 'move' | 'wealth';
export type SpellTiming = 'action' | 'reaction' | 'rent' | 'start' | 'preroll';
export interface SpellData {
  id: string;
  name: string;
  cat: SpellCat;
  cost: number;
  timing: SpellTiming;
  desc: string;
  /** 百宝阁售价（灵石）；有售价的牌才在百宝阁出售 */
  price?: number;
  /** 道具：只在百宝阁出售，不进符箓牌堆 */
  shopOnly?: boolean;
}
export interface SpellsData {
  copiesEach: number;
  categories: Record<SpellCat, { name: string; color: string }>;
  cards: SpellData[];
}

// ---- events.json ----------------------------------------------------------
export type TaskCheck =
  | { kind: 'rentCollected'; value: number }
  | { kind: 'buildingsAtLeast'; level: number; count: number }
  | { kind: 'gatesInOneMove'; value: number }
  | { kind: 'handSize'; value: number }
  | { kind: 'breakthroughDone'; value: number }
  | { kind: 'demonDamage'; value: number };
export interface TaskData { id: string; name: string; desc: string; check: TaskCheck }
export interface EventEffect {
  stones?: number;
  chooseRoll?: boolean;
  draw?: number;
  pills?: number;
  shrineSeal?: boolean;
  allPills?: number;
  buyCultivation?: number;
  moveBack?: number;
  rentHalfSelf?: boolean;
  payLeader?: number;
  toCliff?: boolean;
}
export interface EventCardData { id: string; name: string; good: boolean; desc: string; effect: EventEffect }
export interface EventsData { tasks: TaskData[]; events: EventCardData[] }

// ---- blessings.json -------------------------------------------------------
export interface BlessingData { id: string; name: string; desc: string; aiWeight: number }
export interface BlessingsData {
  realms: { min: number; name: string }[];
  divine: BlessingData[];
  heaven: BlessingData[];
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

export interface ActiveTask {
  id: string;
  /** Snapshot of the relevant cumulative counter when the task was taken. */
  base: number;
}

export interface PlayerStats {
  rentCollected: number;
  rentPaid: number;
  breakthroughs: number;
  demonDamage: number;
  /** Moves in which >= 2 gates were passed. */
  twoGateMoves: number;
  /** Times the player turned from a gate into a road. */
  roadEntries: number;
  altarVisits: number;
  bankruptcies: number;
  tasksDone: number;
  /** 发起的斗法次数 */
  duels: number;
  /** 斗法胜场（攻守皆计） */
  duelWins: number;
  /** 击败悬赏令持有者的次数 */
  bountyClaims: number;
  /** 自己的禁制被触发次数 */
  trapTriggers: number;
  /** 主动技能使用次数 */
  skillUses: number;
  /** 被灵体附身的次数（含心魔转移得来） */
  possessions: number;
  /** 把心魔传给他人的次数 */
  heartPasses: number;
  /** 在百宝阁买下的道具 / 符箓数 */
  shopBuys: number;
  /** 改建的功能建筑数 */
  specialsBuilt: number;
  /** 玩过的小游戏次数 */
  miniGames: number;
  /** 凑齐整条街的次数 */
  streets: number;
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
  /** Cultivation from permanent sources. Vein-lord bonus is added dynamically (see rules.cultivation). */
  cultBase: number;
  /** Historical maximum of total cultivation (drives breakthrough opportunities). */
  peakCult: number;
  btEarned: number;
  btUsed: number;
  hand: string[];
  divines: string[];
  tasks: ActiveTask[];
  seal: boolean;
  jailed: boolean;
  /** Number of jailed turn-starts so far for the current stay. */
  jailTurns: number;
  bound: boolean;
  /** Ward (白泽护道) active while state.round <= wardUntilRound. */
  wardUntilRound: number;
  /** 地脉异动: own rent halved in this round. */
  tremorRound: number;
  /** 聚宝符: region doubled for a round. */
  treasure: { region: RegionId; round: number }[];
  /** 不动明王: immune to rent while turnsTaken <= rentImmuneUntilTurn. */
  rentImmuneUntilTurn: number;
  turnsTaken: number;
  ultUses: number;
  goldbodyReadyRound: number;
  shrinkReadyRound: number;
  gatherRound: number;
  /** Ended last turn on a wood land: may move counter-clockwise this turn (迷踪). */
  mazeAvailable: boolean;
  /** 灵兽引路: next movement value chosen 1–6. */
  chooseRoll: boolean;
  badStreak: number;
  /** 主动技能在 turnsTaken >= skillReadyTurn 时可用。 */
  skillReadyTurn: number;
  /** 本轮已被挑战过斗法（state.round 相等时不可再被挑战）。 */
  duelShieldRound: number;
  /** 迷魂丹：下一次掷骰移动步数减半（向下取整，至少 1）。 */
  dazed: boolean;
  /** §18.3 医馆：>0 时跳过自己的回合并 −1。 */
  hospitalTurns: number;
  /** "<node>:<level>" — first-time Lv3/Lv4 cultivation already granted. */
  milestones: string[];
  stats: PlayerStats;
}

export interface TileState {
  owner: number | null;
  level: number;
  /** 禁制（属于地主）。易主或破产时清除。 */
  trap: boolean;
  /** 功能建筑（只在 Lv0 自有灵田上改建，之后不能升级）。破产时清除，易主时保留。 */
  special?: SpecialKind;
}

/** §18.2 游荡时 node 有值、holder 为 null；附身时反过来。 */
export interface SpiritState {
  kind: SpiritKind;
  node: NodeId | null;
  holder: number | null;
  /** 附身剩余：附身者每个自己的回合开始 −1，回合结束时 ≤0 即离体。 */
  turnsLeft: number;
}

export interface DemonState {
  node: NodeId;
  hp: number;
  maxHp: number;
  spawnRound: number;
  leaveRound: number;
}

/** Per-turn transient flags (reset at each turn start). */
export interface TurnState {
  seat: number;
  doubles: number;
  mireUsed: boolean;
  upgraded: boolean;
  discount: boolean;
  // per-move modifiers (reset after each movement)
  swiftstep: boolean;
  reverse: boolean;
  swordUlt: boolean;
  lastPath: NodeId[];
  lastDir: 1 | -1;
  /** 本回合已发起过斗法（含双数再掷）。 */
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
  heavenDeck: string[];
  demon: DemonState | null;
  manifested: boolean;
  /** Region -> seat of current 灵脉之主 (or null). */
  veinLords: Record<RegionId, number | null>;
  /** Region -> per-seat sequence number of when the land count last changed (tie-break "先达成者"). */
  regionReach: Record<RegionId, number[]>;
  seq: number;
  /** §17 悬赏令持有者（每轮开始时重算；被斗法击败后清空至下一轮）。 */
  bountySeat: number | null;
  /** 体修镇山的山岳路障：拦下下一个经过它的他人；主人下回合开始时消失。 */
  roadblock: { node: NodeId; seat: number } | null;
  /** §18.2 附身灵体：[0] 福缘灵狐，[1] 心魔。 */
  spirits: SpiritState[];
  /** §18.3 路障符的路障：拦下下一个经过的他人，用后消失；每人同时 1 处。 */
  barriers: { node: NodeId; seat: number }[];
  /** §18.3 爆炎阵（对他人隐藏）：下一个停上去的他人去医馆。 */
  blasts: { node: NodeId; seat: number }[];
  turn: TurnState;
}

export interface GameSetup {
  seed: number;
  players: { name: string; hero: HeroId }[];
}
