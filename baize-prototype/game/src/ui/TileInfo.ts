import type { Game } from '../core/engine';
import { nominalRent, rentFor } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import type { TipContent } from './Tooltip';

/** Popover text for a board node: owner, price and rent ladder for land, the rule text otherwise. */
export function tileTip(g: Game, state: GameState, node: NodeId): TipContent {
  const n = g.board.node(node);
  const tt = g.data.board.tileTypes[n.type];
  if (n.type !== 'land') {
    const where = n.ringIndex >= 0 ? `外环 ${node}` : n.type === 'altar' ? '秘境中心' : `问道之路 ${node}`;
    return { title: `${n.name} · ${where}`, body: tt.desc };
  }
  const t = state.tiles[node];
  const region = g.data.board.regions[n.region!];
  const lines = [
    `${region.name} · ${t.owner === null ? '无主灵田' : `${g.pn(t.owner)} 的${g.data.board.buildings[t.level].name}`}`,
    `售价 ${n.price}${t.owner !== null ? ` · 当前租金 ${rentFor(state, g.board, g.data, node).amount}` : ''}`,
  ];
  for (let lv = 0; lv <= 4; lv++) {
    lines.push(`${t.level === lv && t.owner !== null ? '▶' : '　'} Lv${lv} ${g.data.board.buildings[lv].name}  租 ${nominalRent(g.data, n.price!, lv)}`);
  }
  lines.push(`${region.element} · ${region.ruleName}`);
  return { title: n.name, body: lines.join('\n') };
}
