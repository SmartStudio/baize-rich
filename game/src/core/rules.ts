// Pure rule calculations (no mutation, no randomness). Shared by the engine,
// the AI and the UI (e.g. to preview rent / costs / breakthrough odds).
import { ALTAR, type Board } from './board';
import type { BreakthroughBonuses } from './events';
import type { GameData, GameState, HeroTrait, LandLevelData, NodeId, PlayerState, RealmAbility, RealmData } from './types';

// ---- realms -------------------------------------------------------------

export function realmOf(data: GameData, realm: number): RealmData {
  return data.config.realms[realm];
}

export function realmName(data: GameData, realm: number): string {
  return realmOf(data, realm).name;
}

/** The realm ordinal that ends the game (化神). */
export function winRealm(data: GameData): number {
  return data.config.realms.length - 1;
}

/** Abilities are permanent: every realm reached so far contributes its ability. */
export function hasAbility(data: GameData, p: PlayerState, ability: RealmAbility): boolean {
  return data.config.realms.slice(0, p.realm + 1).some((r) => r.ability === ability);
}

export function hasTrait(data: GameData, p: PlayerState, trait: HeroTrait): boolean {
  return data.heroes.find((h) => h.id === p.hero)!.passive.traits.includes(trait);
}

export function barSize(data: GameData, p: PlayerState): number {
  return realmOf(data, p.realm).bar;
}

export function barFull(data: GameData, p: PlayerState): boolean {
  return p.realm < winRealm(data) && p.cult >= barSize(data, p);
}

// ---- land ---------------------------------------------------------------

export function landLevel(data: GameData, level: number): LandLevelData {
  return data.config.landLevels[level];
}

export function maxLevel(data: GameData): number {
  return data.config.landLevels.length - 1;
}

export function baseRent(data: GameData, price: number): number {
  return price * data.config.rentRate;
}

/** Stones needed to go from level-1 to `newLevel`. */
export function upgradeCost(data: GameData, price: number, newLevel: number): number {
  return Math.floor(price * landLevel(data, newLevel).upgradeCostP);
}

/** Land price + all upgrade costs for a land at `level`. Used for assets. */
export function investedValue(data: GameData, price: number, level: number): number {
  let v = price;
  for (let l = 1; l <= level; l++) v += upgradeCost(data, price, l);
  return v;
}

/** Rent the land charges at a given level. */
export function nominalRent(data: GameData, price: number, level: number): number {
  return Math.floor(baseRent(data, price) * landLevel(data, level).rentMult);
}

export interface RentBreakdown {
  amount: number;
  zeroReason?: string;
}

/** Rent owed for landing on `node`. Returns 0 for unowned land or when the payer is the owner. */
export function rentFor(state: GameState, board: Board, data: GameData, node: NodeId, payer?: number): RentBreakdown {
  const n = board.node(node);
  const t = state.tiles[node];
  if (n.type !== 'land' || !t || t.owner === null) return { amount: 0, zeroReason: '无主' };
  if (payer !== undefined && t.owner === payer) return { amount: 0, zeroReason: '自己的灵田' };
  return { amount: nominalRent(data, n.price!, t.level) };
}

/** 过路费 for walking over `node` without stopping: a share of its rent, 0 where no rent is owed. */
export function passToll(state: GameState, board: Board, data: GameData, node: NodeId, payer?: number): number {
  return Math.floor(rentFor(state, board, data, node, payer).amount * data.config.tollRate);
}

export function countOwned(state: GameState, board: Board, seat: number): number {
  return board.lands.filter((id) => state.tiles[id].owner === seat).length;
}

/** Herbs a player's lands yield at round start. */
export function herbYield(state: GameState, board: Board, data: GameData, seat: number): number {
  let n = 0;
  for (const id of board.lands) {
    const t = state.tiles[id];
    if (t.owner === seat) n += landLevel(data, t.level).herbs;
  }
  return n;
}

/** 打坐: 修为 for ending the turn on `node` (0 unless it is the player's own land). */
export function sitGain(state: GameState, data: GameData, seat: number, node: NodeId): number {
  const t = state.tiles[node];
  if (!t || t.owner !== seat) return 0;
  return landLevel(data, t.level).sit;
}

// ---- breakthrough ---------------------------------------------------------

/** Site bonus for 闭关 on `node`, or null if the player cannot close there. */
export function closureSite(state: GameState, data: GameData, seat: number, node: NodeId): number | null {
  if (node === ALTAR) return data.config.breakthrough.altarBonus;
  const t = state.tiles[node];
  if (!t || t.owner !== seat) return null;
  return landLevel(data, t.level).closureBonus ?? (hasTrait(data, state.players[seat], 'homeClosure') ? 0 : null);
}

/** Where 闭关 is allowed, in words for the rules screens. */
export function closurePlaces(data: GameData): string {
  const lowest = data.config.landLevels.findIndex((l) => l.closureBonus !== null);
  return `白泽灵台或自家${data.board.buildings[lowest].name}以上的灵田`;
}

export function canClose(state: GameState, data: GameData, seat: number): boolean {
  const p = state.players[seat];
  return barFull(data, p) && closureSite(state, data, seat, p.pos) !== null;
}

/** The bonuses known before the stake and 清心符, for a closure whose site bonus is `site`. */
export function fixedBonuses(state: GameState, data: GameData, seat: number, site: number): Omit<BreakthroughBonuses, 'pills' | 'calm'> {
  const p = state.players[seat];
  const b = data.config.breakthrough;
  return {
    site,
    mind: p.mind * b.mindBonus,
    guidance: p.guidance > 0 ? b.guidanceBonus : 0,
    insight: insightBonus(data, p),
    momentum: p.momentum ? b.momentumBonus : 0,
  };
}

/** 过目不忘: every insightPer 感悟 is +1 at the next breakthrough, at most insightMax. */
export function insightBonus(data: GameData, p: PlayerState): number {
  const b = data.config.breakthrough;
  return Math.min(b.insightMax, Math.floor(p.insight / b.insightPer));
}

/** 感悟 the player can still store: none without 过目不忘, else up to what reaches insightMax. */
export function insightRoom(data: GameData, p: PlayerState): number {
  const b = data.config.breakthrough;
  return hasTrait(data, p, 'insight') ? b.insightPer * b.insightMax - p.insight : 0;
}

export function closureBonus(state: GameState, data: GameData, seat: number, site: number): number {
  return Object.values(fixedBonuses(state, data, seat, site)).reduce((a, v) => a + v, 0);
}

/** P(2D6 ≥ need). */
export function chance2d6(need: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= need) n++;
  return n / 36;
}

// ---- duel ---------------------------------------------------------------

/** 宝光: pills ≥ glowAt, or 宝光外泄 this round. */
export function isGlowing(state: GameState, data: GameData, seat: number): boolean {
  const p = state.players[seat];
  return p.pills >= data.config.duel.glowAt || p.glowRound === state.round;
}

/** Duel bonuses [attacker, defender] (GDD §8.1): realm gap, 神识, 剑气, 铜皮铁骨, 宝光. */
export function duelBonus(state: GameState, data: GameData, attacker: number, defender: number): [number, number] {
  const d = data.config.duel;
  const pa = state.players[attacker];
  const pd = state.players[defender];
  const gap = pa.realm - pd.realm;
  const side = (p: PlayerState) => (hasAbility(data, p, 'sense') ? d.senseBonus : 0);
  const a = Math.max(0, gap) + side(pa) + (hasTrait(data, pa, 'swordQi') ? d.swordAttack : 0) + (isGlowing(state, data, defender) ? d.glowBonus : 0);
  const b = Math.max(0, -gap) + side(pd) + (hasTrait(data, pd, 'guard') ? d.bodyDefense : 0);
  return [a, b];
}

/** P(attacker wins) on 1D6 each with the given totals offset (ties go to the defender). */
export function duelWinChance(off: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (a + off > d) n++;
  return n / 36;
}

// ---- standing -------------------------------------------------------------

/** Total assets for the round-cap tie-break: stones + land invested + pills + herbs. */
export function totalAssets(state: GameState, board: Board, data: GameData, seat: number): number {
  const p = state.players[seat];
  const av = data.config.assetValue;
  let v = p.stones + p.pills * av.pill + p.herbs * av.herb;
  for (const id of board.lands) {
    const t = state.tiles[id];
    if (t.owner === seat) v += investedValue(data, board.node(id).price!, t.level);
  }
  return v;
}

/** Standing order: realm, then bar, then assets (GDD §11). */
export function compareStanding(state: GameState, board: Board, data: GameData, a: number, b: number): number {
  const pa = state.players[a];
  const pb = state.players[b];
  return pb.realm - pa.realm || pb.cult - pa.cult
    || totalAssets(state, board, data, b) - totalAssets(state, board, data, a) || a - b;
}
