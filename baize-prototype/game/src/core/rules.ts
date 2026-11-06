// Pure rule calculations (no mutation, no randomness). Shared by the engine,
// the AI and the UI (e.g. to preview rent / costs).
import type { Board } from './board';
import type { GameData, GameState, NodeId, PlayerState } from './types';

export function cultivation(state: GameState, _data: GameData, seat: number): number {
  return state.players[seat].cultBase;
}

export function realmName(data: GameData, cult: number): string {
  let name = data.blessings.realms[0].name;
  for (const r of data.blessings.realms) if (cult >= r.min) name = r.name;
  return name;
}

export function baseRent(data: GameData, price: number): number {
  return price * data.config.rentRate;
}

/** Stones needed to go from level-1 to `newLevel` (1..4). */
export function upgradeCostRaw(data: GameData, price: number, newLevel: number): number {
  return price * data.config.levelUpgradeCostP[newLevel];
}

export function upgradeCost(data: GameData, price: number, newLevel: number): { stones: number; pills: number } {
  return {
    stones: Math.floor(upgradeCostRaw(data, price, newLevel)),
    pills: newLevel === 4 ? data.config.lv4PillCost : 0,
  };
}

export function buyPrice(data: GameData, p: PlayerState, price: number): number {
  return Math.floor(price * (p.hero === 'alch' ? data.config.rules.alchBuyDiscount : 1));
}

/** Land price + all upgrade costs for a land at `level`. Used for assets. */
export function investedValue(data: GameData, price: number, level: number): number {
  let v = price;
  for (let l = 1; l <= level; l++) v += upgradeCostRaw(data, price, l);
  return v;
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

/** Rent owed for landing on `node`. Returns 0 for unowned land or when the payer is the owner. */
export function rentFor(state: GameState, board: Board, data: GameData, node: NodeId, payer?: number): RentBreakdown {
  const n = board.node(node);
  const t = state.tiles[node];
  if (n.type !== 'land' || !t || t.owner === null) return { amount: 0, base: 0, mults: [], zeroReason: '无主' };
  if (payer !== undefined && t.owner === payer) return { amount: 0, base: 0, mults: [], zeroReason: '自己的灵田' };
  const cfg = data.config;
  const base = baseRent(data, n.price!);
  const mults: { label: string; mult: number }[] = [{ label: `Lv${t.level}`, mult: cfg.levelRentMult[t.level] }];
  if (isManifestRound(state, data)) mults.push({ label: '灵雨', mult: cfg.manifestRentMult });
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
  return cfg.breakthroughCost[Math.min(p.btUsed, cfg.breakthroughCost.length - 1)];
}

export function canBreakthrough(state: GameState, data: GameData, seat: number): boolean {
  const p = state.players[seat];
  return breakthroughsAvailable(p) > 0 && p.pills >= breakthroughCost(state, data, seat);
}

/** Total assets for the round-cap tie-break. */
export function totalAssets(state: GameState, board: Board, data: GameData, seat: number): number {
  const p = state.players[seat];
  let v = p.stones + p.pills * data.config.pillValueInStones;
  for (const id of board.lands) {
    const t = state.tiles[id];
    if (t.owner === seat) v += investedValue(data, board.node(id).price!, t.level);
  }
  return v;
}

export function countOwned(state: GameState, board: Board, seat: number): number {
  return board.lands.filter((id) => state.tiles[id].owner === seat).length;
}
