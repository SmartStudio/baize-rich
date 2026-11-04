// ---------------------------------------------------------------------------
// Data-file types (mirror data/*.json) and game-state types.
// Everything in GameState is plain JSON-serialisable data.
// ---------------------------------------------------------------------------

export type RegionId = 'wood' | 'fire' | 'water' | 'earth';
export type RoadId = 'S' | 'W' | 'N' | 'E';
export type NodeId = string; // 'R0'..'R31', 'S1', 'S2', ..., 'ALTAR'
export type HeroId = 'body' | 'magic' | 'sword' | 'alch';
export type TileType =
  | 'start' | 'land' | 'gate' | 'trial' | 'spring' | 'market'
  | 'furnace' | 'cliff' | 'array' | 'shrine' | 'altar';

// ---- config.json ----------------------------------------------------------
export interface ConfigData {
  version: string;
  rounds: number;
  winCultivation: number;
  startStones: number;
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
}

// ---- board.json -----------------------------------------------------------
export interface RingTileData {
  id: NodeId;
  pos: [number, number];
  type: TileType;
  region?: RegionId;
  name?: string;
  price?: number;
  road?: RoadId;
}
export interface RoadData {
  gate: NodeId;
  nodes: { id: NodeId; pos: [number, number]; type: TileType }[];
}
export interface RegionData { name: string; element: string; rule: string; ruleName: string; color: string }
export interface BoardData {
  grid: { cols: number; rows: number; tile: number };
  regions: Record<RegionId, RegionData>;
  ring: RingTileData[];
  roads: Record<RoadId, RoadData>;
  altar: { id: NodeId; rect: [number, number, number, number]; type: 'altar' };
  tileTypes: Record<TileType, { name: string; desc: string }>;
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
}

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
}

export interface PlayerState {
  seat: number;
  name: string;
  hero: HeroId;
  pos: NodeId;
  /** Direction of travel when standing on a road node ('in' toward altar / 'out' toward gate). */
  roadDir: 'in' | 'out';
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
  /** "<node>:<level>" — first-time Lv3/Lv4 cultivation already granted. */
  milestones: string[];
  stats: PlayerStats;
}

export interface TileState {
  owner: number | null;
  level: number;
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
  turn: TurnState;
}

export interface GameSetup {
  seed: number;
  players: { name: string; hero: HeroId }[];
}
