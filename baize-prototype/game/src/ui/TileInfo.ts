import type { Game } from '../core/engine';
import { landLevel, maxLevel, nominalRent, passToll, rentFor } from '../core/rules';
import type { GameData, GameState, NodeId, TileType } from '../core/types';
import { homeClosureNote } from './hudReadout';
import type { TipContent } from './Tooltip';

/**
 * Popover for a board node. Land rows come from the level table.
 * Other tiles quote the config numbers, not a stale sentence in board.json.
 */
export function tileTip(g: Game, state: GameState, node: NodeId): TipContent {
  const n = g.board.node(node);
  const where = placeName(g, node);
  if (n.type === 'land') return { title: n.name, body: landBody(g, state, node) };
  return { title: `${n.name} · ${where}`, body: typeFacts(g.data, n.type) };
}

function placeName(g: Game, node: NodeId): string {
  const n = g.board.node(node);
  if (n.type === 'altar') return '秘境中心';
  if (n.road) return `问道之路 ${node}`;
  if (n.region) return `${g.data.board.regions[n.region].name} ${node}`;
  return node;
}

function landBody(g: Game, state: GameState, node: NodeId): string {
  const n = g.board.node(node);
  const t = state.tiles[node];
  if (n.region === undefined || n.price === undefined || !t) return g.data.board.tileTypes.land.desc;
  const region = g.data.board.regions[n.region];
  const lines = [`${region.name}（${region.element}） · ${ownerLine(g, state, node)}`];
  lines.push(priceLine(g, state, node, n.price));
  const street = streetLine(g, state, node);
  if (street) lines.push(street);
  lines.push(g.data.board.tileTypes.land.desc);
  for (let lv = 0; lv <= maxLevel(g.data); lv++) lines.push(levelLine(g, n.price, lv, t.level === lv && t.owner !== null));
  const home = homeClosureNote(g.data);
  if (home) lines.push(home);
  return lines.join('\n');
}

function ownerLine(g: Game, state: GameState, node: NodeId): string {
  const t = state.tiles[node];
  if (t.owner === null) return '无主灵田';
  return `${g.pn(t.owner)} 的${g.data.board.buildings[t.level].name}`;
}

function priceLine(g: Game, state: GameState, node: NodeId, price: number): string {
  const t = state.tiles[node];
  if (t.owner === null) return `售价 ${price}`;
  const rent = rentFor(state, g.board, g.data, node);
  const now = rent.zeroReason ? `0（${rent.zeroReason}）` : `${rent.amount}`;
  return `售价 ${price} · 当前租金 ${now} · 过路费 ${passToll(state, g.board, g.data, node)}`;
}

function streetLine(g: Game, state: GameState, node: NodeId): string {
  const n = g.board.node(node);
  if (!n.street) return '';
  const street = g.board.streetOf(node);
  const owner = state.tiles[node].owner;
  const owned = owner === null ? '' : ` · 已占 ${street.filter((id) => state.tiles[id].owner === owner).length}/${street.length}`;
  return `${g.board.streetName(n.street)}（${street.length} 块）${owned}`;
}

function levelLine(g: Game, price: number, lv: number, current: boolean): string {
  const row = landLevel(g.data, lv);
  const name = g.data.board.buildings[lv].name;
  const mark = current ? '▶' : '　';
  const close = row.closureBonus === null ? '不可闭关' : `可闭关 +${row.closureBonus}`;
  return `${mark} Lv${lv} ${name}  租 ${nominalRent(g.data, price, lv)}  灵草 ${row.herbs}  打坐 +${row.sit}  ${close}`;
}

function typeFacts(data: GameData, type: TileType): string {
  const c = data.config;
  const desc = data.board.tileTypes[type].desc;
  switch (type) {
    case 'land':
      return desc;
    case 'start':
      return `经过 +${c.salaryPass} 灵石，停下 +${c.salaryLand} 灵石`;
    case 'gate':
      return desc;
    case 'alchemy':
      return `每 ${c.alchemy.herbsPerPill} 灵草炼 1 颗丹药，可连炼。第一炉火候正中多 ${c.alchemy.perfectBonus} 颗。`;
    case 'market':
      return `丹药 ${c.market.pillPrice} 灵石一颗，每次最多 ${c.market.pillMax} 颗。符箓 ${c.market.cardPrice} 灵石一张，每次最多 ${c.market.cardMax} 张。`;
    case 'secret':
      return desc;
    case 'spring':
      return `+${c.cultivation.spring} 修为、+${c.spring.herbs} 灵草`;
    case 'beast':
      return `掷 2D6 + 境界序数，≥ ${c.beast.target} 得 ${c.beast.herbs} 灵草，否则失 ${c.beast.loss} 灵石`;
    case 'ruins':
      return desc;
    case 'eye':
      return `+${c.cultivation.eye} 修为`;
    case 'altar':
      return `公共闭关地，突破 +${c.breakthrough.altarBonus}。停下而不突破 +${c.cultivation.altarCalm} 修为。借道消耗 ${c.altarToll} 颗丹药。`;
    default: {
      const never: never = type;
      return never;
    }
  }
}
