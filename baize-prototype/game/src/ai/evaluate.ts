// Pure valuation helpers for the AI: how much (in stones) a tile, a 机缘 card,
// a 白泽 gift or a breakthrough attempt is worth to one player right now.
import type { Board } from '../core/board';
import type { ManifestGift } from '../core/choices';
import {
  barSize, chance2d6, closureBonus, closureSite, hasAbility, hasTrait, insightRoom, isGlowing, rentFor, sitGain, winRealm,
} from '../core/rules';
import type { EventEffect, GameData, GameState, NodeId, PlayerState } from '../core/types';

/** Stone-equivalents used to compare heterogeneous gains. */
export const VALUE = { pill: 200, herb: 60, cult: 120, card: 90, insight: 50 };

export interface View {
  st: GameState;
  board: Board;
  data: GameData;
  seat: number;
}

const me = (v: View): PlayerState => v.st.players[v.seat];

/** Room left on the bar (0 at 化神). */
export function barRoom(v: View): number {
  const p = me(v);
  return p.realm >= winRealm(v.data) ? 0 : barSize(v.data, p) - p.cult;
}

/** Value of gaining `n` 修为 now; overflow is worth nothing unless it can be stored as 感悟. */
export function cultValue(v: View, n: number): number {
  const kept = Math.min(n, barRoom(v));
  const stored = Math.min(n - kept, insightRoom(v.data, me(v)));
  return kept * VALUE.cult + stored * VALUE.insight;
}

/** Bar full, or one point short (吐纳 fills it at turn end). */
export function nearlyFull(v: View): boolean {
  return me(v).realm < winRealm(v.data) && barRoom(v) <= 1;
}

/** Success chance for 闭关 with site bonus `site` and up to `pills` staked (清心符 included when held). */
export function closureChance(v: View, site: number, pills: number): number {
  const p = me(v);
  const b = v.data.config.breakthrough;
  const fixed = closureBonus(v.st, v.data, v.seat, site) + (p.hand.includes('calm') ? b.calmBonus : 0);
  const stake = Math.min(pills, b.maxPills, p.pills);
  return chance2d6(v.data.config.realms[p.realm].target - fixed - stake * b.pillBonus);
}

/** Smallest stake reaching `want` success chance at site bonus `site`, else everything allowed. */
export function stakeFor(v: View, want: number, site: number): number {
  const max = Math.min(v.data.config.breakthrough.maxPills, me(v).pills);
  for (let k = 0; k <= max; k++) if (closureChance(v, site, k) >= want) return k;
  return max;
}

export function fortuneValue(v: View, e: EventEffect): number {
  const p = me(v);
  if (e.immuneRealm !== undefined && p.realm >= e.immuneRealm) return 0;
  let s = 0;
  if (e.cult) s += e.cult > 0 ? cultValue(v, e.cult) : -Math.min(p.cult, -e.cult) * VALUE.cult;
  s += (e.herbs ?? 0) * VALUE.herb + (e.pills ?? 0) * VALUE.pill + (e.stones ?? 0) + (e.draw ?? 0) * VALUE.card;
  if (e.guidance) s += 250;
  if (e.glow) s -= p.pills > 0 ? 120 : 20;
  if (e.rift) s += 120;
  return s;
}

/** Average value of one draw from the 机缘 deck. */
export function deckValue(v: View): number {
  const evs = v.data.events.events;
  const n = evs.reduce((a, e) => a + e.count, 0);
  return evs.reduce((a, e) => a + e.count * fortuneValue(v, e.effect), 0) / n;
}

export function giftValue(v: View, g: ManifestGift): number {
  const m = v.data.config.manifest;
  switch (g) {
    case 'chart': return cultValue(v, m.chartCult);
    case 'stones': return m.giftStones;
    case 'pills': return m.giftPills * VALUE.pill;
    case 'guide': return nearlyFull(v) ? 700 : 150;
  }
}

/** 斗法 loot value a loser would hand over. */
export function lootValue(st: GameState, data: GameData, loser: number): number {
  const p = st.players[loser];
  const d = data.config.duel;
  if (hasAbility(data, p, 'escape') && p.escapeRound !== st.round) return 0;
  if (p.pills > 0) return Math.min(p.pills, isGlowing(st, data, loser) ? d.glowSteal : d.steal) * VALUE.pill;
  return Math.min(p.stones, d.lossStones);
}

/** Value of the tile effect when stopping on `node` (rent counted, duels not). */
export function tileValue(v: View, node: NodeId): number {
  const p = me(v);
  const cfg = v.data.config;
  switch (v.board.node(node).type) {
    case 'start': return cfg.salaryLand;
    case 'land': return landValue(v, node);
    case 'alchemy': return Math.floor(p.herbs / cfg.alchemy.herbsPerPill) * VALUE.pill * 0.9 + (hasTrait(v.data, p, 'pillway') && p.herbs >= 2 ? VALUE.pill : 0);
    case 'market': return p.stones > 900 ? 60 : 0;
    case 'secret': return deckValue(v);
    case 'spring': return cultValue(v, cfg.cultivation.spring) + cfg.spring.herbs * VALUE.herb;
    case 'beast': return beastValue(v);
    case 'ruins': return deckValue(v) + 120;
    case 'eye': return cultValue(v, cfg.cultivation.eye);
    case 'altar': return nearlyFull(v) ? closureSiteValue(v, node) : cultValue(v, cfg.cultivation.altarCalm);
    case 'gate': return 0;
  }
}

function beastValue(v: View): number {
  const p = me(v);
  const b = v.data.config.beast;
  const win = chance2d6(b.target - p.realm);
  return win * b.herbs * VALUE.herb - (1 - win) * Math.min(b.loss, p.stones);
}

function landValue(v: View, node: NodeId): number {
  const p = me(v);
  const t = v.st.tiles[node];
  if (t.owner === v.seat) return cultValue(v, sitGain(v.st, v.data, v.seat, node)) + (nearlyFull(v) ? closureSiteValue(v, node) : 0);
  if (t.owner === null) return p.stones - v.board.node(node).price! >= 300 ? 0.3 * v.board.node(node).price! : 0;
  const r = rentFor(v.st, v.board, v.data, node, v.seat).amount;
  return -r - (r >= p.stones ? 400 : 0);
}

/** A full bar standing on an own closure site lets the AI close right away. */
function closureSiteValue(v: View, node: NodeId): number {
  const site = closureSite(v.st, v.data, v.seat, node);
  return site === null ? 0 : 500 * closureChance(v, site, me(v).pills);
}
