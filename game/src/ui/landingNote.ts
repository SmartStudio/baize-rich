// What ending a walk on a cell does, in a few characters for its board-pick tag: "丹房 · 可炼丹", "燕回的地 · 交 40".
// The words follow Game.settle for that tile type; numbers come from the config, never from board.json prose.
import type { Game } from '../core/engine';
import { barFull, closureSite, landLevel, rentFor } from '../core/rules';
import type { NodeId, TileType } from '../core/types';
import { heroNameForSeat } from './narration';

/** The walker, where it stops and the stones it holds on arrival (after 过路费 and 宗门 pay on the way). */
export interface Arrival {
  seat: number;
  node: NodeId;
  stones: number;
}

type Note = (g: Game, a: Arrival) => [place: string, effect: string];

const named = (effect: (g: Game, a: Arrival) => string): Note => (g, a) => [g.nodeName(a.node), effect(g, a)];

const NOTES: Record<TileType, Note> = {
  land: landNote,
  start: named((g) => `领 ${g.data.config.salaryLand}`),
  alchemy: named((g, a) => (g.state.players[a.seat].herbs >= g.data.config.alchemy.herbsPerPill ? '可炼丹' : '灵草不够')),
  market: named(() => '买丹符'),
  secret: named(() => '抽机缘'),
  ruins: named(() => '两张机缘选一'),
  spring: named((g) => `修为 +${g.data.config.cultivation.spring}`),
  eye: named((g) => `修为 +${g.data.config.cultivation.eye}`),
  beast: named(() => '斗妖兽'),
  altar: named((g) => `修为 +${g.data.config.cultivation.altarCalm}`),
  gate: named(() => '歇脚'),
};

export function landingLabel(g: Game, a: Arrival): string {
  const [place, effect] = NOTES[g.board.node(a.node).type](g, a);
  return `${place} · ${canCloseAt(g, a) ? '可闭关' : effect}`;
}

function landNote(g: Game, a: Arrival): [string, string] {
  const t = g.state.tiles[a.node];
  if (t.owner === null) return ['空地', a.stones >= g.board.node(a.node).price! ? '可买' : '买不起'];
  if (t.owner === a.seat) return [`自家${g.data.board.buildings[t.level].name}`, `打坐 +${landLevel(g.data, t.level).sit}`];
  return [`${heroNameForSeat(g, t.owner)}的地`, `交 ${rentFor(g.state, g.board, g.data, a.node, a.seat).amount}`];
}

function canCloseAt(g: Game, a: Arrival): boolean {
  return barFull(g.data, g.state.players[a.seat]) && closureSite(g.state, g.data, a.seat, a.node) !== null;
}
