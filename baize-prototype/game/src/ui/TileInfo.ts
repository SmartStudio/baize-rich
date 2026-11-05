import type { Game } from '../core/engine';
import { nominalRent, ownsStreet, rentFor } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import type { TipContent } from './Tooltip';

/**
 * Popover text for a board node: owner, price, rent (with its multipliers), street and rent ladder for
 * land, the rule text otherwise; plus whatever stands on it in public (spirits, 路障).
 */
export function tileTip(g: Game, state: GameState, node: NodeId): TipContent {
  const n = g.board.node(node);
  const tt = g.data.board.tileTypes[n.type];
  const extras = onTile(g, state, node);
  if (n.type !== 'land') {
    const where = n.type === 'altar' ? '秘境中心' : n.road ? `问道之路 ${node}` : n.region ? `${g.data.board.regions[n.region].name} ${node}` : node;
    const game = n.type === 'minigame' && n.game ? g.data.board.games?.[n.game] : undefined;
    return { title: `${n.name} · ${where}`, body: [game ? `${game.name}：${game.desc}` : tt.desc, ...extras].join('\n') };
  }
  const t = state.tiles[node];
  const region = g.data.board.regions[n.region!];
  const special = t.special ? g.data.board.specials?.[t.special] : undefined;
  const what = special?.name ?? g.data.board.buildings[t.level].name;
  const lines = [`${region.name} · ${t.owner === null ? '无主灵田' : `${g.pn(t.owner)} 的${what}`}`];
  if (special) lines.push(special.desc);
  if (t.owner === null) lines.push(`售价 ${n.price}`);
  else {
    const rent = rentFor(state, g.board, g.data, node);
    const mults = rent.mults.filter((m) => !m.label.startsWith('Lv') && m.mult !== 1).map((m) => `${m.label}×${m.mult}`);
    const now = rent.zeroReason ? `0（${rent.zeroReason}）` : `${rent.amount}${mults.length ? `（${mults.join(' ')}）` : ''}`;
    lines.push(`售价 ${n.price} · 当前租金 ${now}`);
  }
  if (n.street) {
    const street = g.board.streetOf(node);
    const owner = t.owner;
    const tail = owner === null ? ''
      : ownsStreet(state, g.board, node, owner) ? ` · 已整街，租金 ×${g.data.config.rules.streetRentMult}`
      : ` · 已占 ${street.filter((id) => state.tiles[id].owner === owner).length}/${street.length}`;
    lines.push(`${g.board.streetName(n.street)}（${street.length} 块）${tail}`);
  }
  if (!special) {
    for (let lv = 0; lv <= 4; lv++) {
      lines.push(`${t.level === lv && t.owner !== null ? '▶' : '　'} Lv${lv} ${g.data.board.buildings[lv].name}  租 ${nominalRent(g.data, n.price!, lv)}`);
    }
  }
  lines.push(`${region.element} · ${region.ruleName}`, ...extras);
  return { title: n.name, body: lines.join('\n') };
}

/** Public things standing on a tile. Hidden 爆炎阵 stay out on purpose. */
function onTile(g: Game, state: GameState, node: NodeId): string[] {
  const out = state.spirits.filter((sp) => sp.node === node).map((sp) => `此处游荡着${g.spiritName(sp.kind)}：走过或停下会被附身`);
  const bar = state.barriers.find((b) => b.node === node);
  if (bar) out.push(`${g.pn(bar.seat)} 的路障：他人走到这里必须停下`);
  return out;
}
