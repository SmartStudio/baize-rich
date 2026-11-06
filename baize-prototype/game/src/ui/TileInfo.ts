import type { Game } from '../core/engine';
import { maxLevel, nominalRent, rentFor } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import type { TipContent } from './Tooltip';

/**
 * Popover text for a board node: owner, price, rent, street and rent ladder for
 * land, the rule text otherwise.
 */
export function tileTip(g: Game, state: GameState, node: NodeId): TipContent {
  const n = g.board.node(node);
  const tt = g.data.board.tileTypes[n.type];
  if (n.type !== 'land') {
    const where = n.type === 'altar' ? '秘境中心' : n.road ? `问道之路 ${node}` : n.region ? `${g.data.board.regions[n.region].name} ${node}` : node;
    return { title: `${n.name} · ${where}`, body: tt.desc };
  }
  const t = state.tiles[node];
  const region = g.data.board.regions[n.region!];
  const what = g.data.board.buildings[t.level].name;
  const lines = [`${region.name} · ${t.owner === null ? '无主灵田' : `${g.pn(t.owner)} 的${what}`}`];
  if (t.owner === null) lines.push(`售价 ${n.price}`);
  else {
    const rent = rentFor(state, g.board, g.data, node);
    const now = rent.zeroReason ? `0（${rent.zeroReason}）` : `${rent.amount}`;
    lines.push(`售价 ${n.price} · 当前租金 ${now}`);
  }
  if (n.street) {
    const street = g.board.streetOf(node);
    const owner = t.owner;
    const tail = owner === null ? '' : ` · 已占 ${street.filter((id) => state.tiles[id].owner === owner).length}/${street.length}`;
    lines.push(`${g.board.streetName(n.street)}（${street.length} 块）${tail}`);
  }
  for (let lv = 0; lv <= maxLevel(g.data); lv++) {
    lines.push(`${t.level === lv && t.owner !== null ? '▶' : '　'} Lv${lv} ${g.data.board.buildings[lv].name}  租 ${nominalRent(g.data, n.price!, lv)}`);
  }
  lines.push(region.element);
  return { title: n.name, body: lines.join('\n') };
}
