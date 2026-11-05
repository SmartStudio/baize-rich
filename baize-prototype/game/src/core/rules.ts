// Pure rule calculations (no mutation, no randomness). Shared by the engine,
// the AI and the UI (e.g. to preview rent / costs).
import type { Board } from './board';
import { REGION_IDS } from './board';
import type { GameData, GameState, NodeId, PlayerState, RegionId, SpiritKind } from './types';

export function veinLordCount(state: GameState, seat: number): number {
  return REGION_IDS.filter((r) => state.veinLords[r] === seat).length;
}

/** Total 修为 = permanent part + 灵脉之主 bonus (dynamic, §5.2). */
export function cultivation(state: GameState, data: GameData, seat: number): number {
  const p = state.players[seat];
  return p.cultBase + veinLordCount(state, seat) * data.config.veinLordCultivation;
}

export function realmName(data: GameData, cult: number): string {
  let name = data.blessings.realms[0].name;
  for (const r of data.blessings.realms) if (cult >= r.min) name = r.name;
  return name;
}

export function baseRent(data: GameData, price: number): number {
  return price * data.config.rentRate;
}

/** Stones needed to go from level-1 to `newLevel` (1..4), before discounts. */
export function upgradeCostRaw(data: GameData, price: number, newLevel: number): number {
  return price * data.config.levelUpgradeCostP[newLevel];
}

export function upgradeCost(
  data: GameData, price: number, newLevel: number, discount: boolean,
): { stones: number; pills: number } {
  const mult = discount ? data.config.rules.discountCardMult : 1;
  return {
    stones: Math.floor(upgradeCostRaw(data, price, newLevel) * mult),
    pills: newLevel === 4 ? data.config.lv4PillCost : 0,
  };
}

export function buyPrice(state: GameState, data: GameData, p: PlayerState, price: number, discount: boolean): number {
  let m = p.hero === 'alch' ? data.config.rules.alchBuyDiscount : 1;
  // §18.2 灵狐's discount does not stack with 丹师's: the lower one applies.
  if (spiritOf(state, p.seat) === 'fox') m = Math.min(m, data.config.rules.foxLandDiscount);
  if (discount) m *= data.config.rules.discountCardMult;
  return Math.floor(price * m);
}

/** §18.2 The spirit possessing `seat`, if any. */
export function spiritOf(state: GameState, seat: number): SpiritKind | null {
  return state.spirits.find((s) => s.holder === seat)?.kind ?? null;
}

/** §18.1 `seat` owns every land of the street `node` belongs to (false for a land without a street). */
export function ownsStreet(state: GameState, board: Board, node: NodeId, seat: number): boolean {
  const lands = board.streetOf(node);
  return lands.length > 0 && lands.every((id) => state.tiles[id].owner === seat);
}

/** Land price + all upgrade costs (undiscounted) for a land at `level`. Used for assets & buyout. */
export function investedValue(data: GameData, price: number, level: number): number {
  let v = price;
  for (let l = 1; l <= level; l++) v += upgradeCostRaw(data, price, l);
  return v;
}

export function buyoutPrice(data: GameData, price: number, level: number): number {
  return Math.floor(investedValue(data, price, level) * data.config.rules.buyoutMult);
}

export function ownsAllOfRegion(state: GameState, board: Board, region: RegionId, seat: number): boolean {
  return board.landsInRegion(region).every((id) => state.tiles[id].owner === seat);
}

export function isEndgame(state: GameState, data: GameData): boolean {
  return data.config.endgameRounds.includes(state.round);
}

export function isManifestRound(state: GameState, data: GameData): boolean {
  return state.manifested && state.round === data.config.baizeManifestRound;
}

export interface RentBreakdown {
  amount: number;
  base: number;
  mults: { label: string; mult: number }[];
  zeroReason?: string;
}

/**
 * Rent owed for landing on `node` (§5.2). All multipliers are multiplied, then floored.
 * Returns 0 for unowned land, the demon's tile, or when the payer is the owner.
 */
export function rentFor(state: GameState, board: Board, data: GameData, node: NodeId, payer?: number): RentBreakdown {
  const n = board.node(node);
  const t = state.tiles[node];
  if (n.type !== 'land' || !t || t.owner === null) return { amount: 0, base: 0, mults: [], zeroReason: '无主' };
  if (payer !== undefined && t.owner === payer) return { amount: 0, base: 0, mults: [], zeroReason: '自己的灵田' };
  const cfg = data.config;
  const base = baseRent(data, n.price!);
  const mults: { label: string; mult: number }[] = [];
  mults.push({ label: `Lv${t.level}`, mult: cfg.levelRentMult[t.level] });
  if (state.demon && state.demon.node === node) {
    return { amount: 0, base, mults, zeroReason: '天魔盘踞' };
  }
  const owner = state.players[t.owner];
  // §18.4 集市: a fixed fee replaces the rent, no multipliers.
  if (t.special === 'bazaar') {
    const fee = cfg.rules.bazaarFee;
    return { amount: fee, base: fee, mults: [{ label: '集市过路费', mult: 1 }] };
  }
  // 一域独占 implies every street of the region, so it replaces 整街 instead of stacking.
  if (ownsAllOfRegion(state, board, n.region!, t.owner)) mults.push({ label: '一域独占', mult: cfg.monopolyRentMult });
  else if (ownsStreet(state, board, node, t.owner)) mults.push({ label: `整街·${board.streetName(n.street!)}`, mult: cfg.rules.streetRentMult });
  if (spiritOf(state, t.owner) === 'fox') mults.push({ label: '福缘灵狐', mult: cfg.rules.foxRentMult });
  if (payer !== undefined && spiritOf(state, payer) === 'heart') mults.push({ label: '心魔', mult: cfg.rules.heartRentMult });
  if (isEndgame(state, data)) mults.push({ label: '终局', mult: cfg.endgameRentMult });
  if (isManifestRound(state, data)) mults.push({ label: '灵雨', mult: cfg.manifestRentMult });
  if (owner.treasure.some((x) => x.region === n.region && x.round === state.round)) mults.push({ label: '聚宝符', mult: 2 });
  if (owner.tremorRound === state.round) mults.push({ label: '地脉异动', mult: 0.5 });
  if (owner.divines.includes('midas')) mults.push({ label: '点石成金', mult: data.config.rules.midasMult });
  const amount = Math.floor(mults.reduce((a, m) => a * m.mult, base));
  return { amount, base, mults };
}

/** Rent the land would charge at a given level ignoring situational multipliers (AI / UI preview). */
export function nominalRent(data: GameData, price: number, level: number): number {
  return Math.floor(baseRent(data, price) * data.config.levelRentMult[level]);
}

export function breakthroughsAvailable(p: PlayerState): number {
  return p.btEarned - p.btUsed;
}

export function breakthroughCost(state: GameState, data: GameData, seat: number): number {
  const cfg = data.config;
  const p = state.players[seat];
  const idx = Math.min(p.btUsed, cfg.breakthroughCost.length - 1);
  let c = cfg.breakthroughCost[idx];
  if (p.seal) c -= cfg.shrineDiscount;
  if (state.demon) c += cfg.demonCostPenalty;
  return Math.max(0, c);
}

export function canBreakthrough(state: GameState, data: GameData, seat: number): boolean {
  const p = state.players[seat];
  return (
    breakthroughsAvailable(p) > 0 &&
    p.divines.length < data.config.maxDivine &&
    p.pills >= breakthroughCost(state, data, seat)
  );
}

/** Total assets for the round-cap tie-break (§7). */
export function totalAssets(state: GameState, board: Board, data: GameData, seat: number): number {
  const p = state.players[seat];
  let v = p.stones + p.pills * data.config.pillValueInStones;
  for (const id of board.lands) {
    const t = state.tiles[id];
    // A 功能建筑 cost as much as a Lv1 building.
    if (t.owner === seat) v += investedValue(data, board.node(id).price!, t.special ? 1 : t.level);
  }
  return v;
}

/** Seat with the unique highest 修为, or null if tied. */
export function uniqueLeader(state: GameState, data: GameData): number | null {
  let best = -1;
  let seat: number | null = null;
  let tie = false;
  state.players.forEach((_, i) => {
    const c = cultivation(state, data, i);
    if (c > best) { best = c; seat = i; tie = false; } else if (c === best) tie = true;
  });
  return tie ? null : seat;
}

export function isWardActive(state: GameState, seat: number): boolean {
  return state.round <= state.players[seat].wardUntilRound;
}

export function goldbodyReady(state: GameState, seat: number): boolean {
  const p = state.players[seat];
  return p.divines.includes('goldbody') && state.round >= p.goldbodyReadyRound;
}

export function countOwned(state: GameState, board: Board, seat: number, region?: RegionId): number {
  return board.lands.filter((id) => state.tiles[id].owner === seat && (!region || board.node(id).region === region)).length;
}

/**
 * Recompute 灵脉之主 for every region (§5.2): the player with the most lands in a region
 * (at least veinLordMinLands). On ties the current lord keeps it; among challengers
 * the one who reached the count first (lowest regionReach seq) wins.
 */
export function computeVeinLords(state: GameState, board: Board, data: GameData): Record<RegionId, number | null> {
  const out = {} as Record<RegionId, number | null>;
  for (const r of REGION_IDS) {
    const counts = state.players.map((_, i) => countOwned(state, board, i, r));
    const max = Math.max(...counts);
    if (max < data.config.veinLordMinLands) { out[r] = null; continue; }
    const cur = state.veinLords[r];
    if (cur !== null && counts[cur] === max) { out[r] = cur; continue; }
    const cands = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    cands.sort((a, b) => state.regionReach[r][a] - state.regionReach[r][b] || a - b);
    out[r] = cands[0];
  }
  return out;
}
