import { describe, expect, it } from 'vitest';
import { AIController } from '../src/ai/ai';
import type { PendingChoice } from '../src/core/choices';
import { Game } from '../src/core/engine';
import type { NodeId } from '../src/core/types';
import { isPickKind, pickPlan, ROUTE_KINDS, type PickCell } from '../src/ui/pickPlan';
import { newGame, ringGame } from './helpers';

const SEEDS = [1, 2, 3, 6, 8, 21];
const ASKS_PER_SEED = 40;

function routeAsk(g: Game, seat: number): boolean {
  return !!g.pending && g.pending.player === seat && ROUTE_KINDS.includes(g.pending.kind);
}

/** Answer the cell's option on a copy of the game, then its route, then defaults; where the walk ended, the 过路费 it paid and what was left over. */
function takeCell(g: Game, cell: PickCell): { end: NodeId; toll: number; left: string[]; defaults: number } {
  const seat = g.pending!.player;
  const copy = Game.replay(g.setup, [...g.history, cell.id], g.data);
  const left = [...cell.route];
  while (left.length && routeAsk(copy, seat)) copy.answer(left.shift()!);
  let defaults = 0;
  for (; routeAsk(copy, seat); defaults++) copy.answer(copy.pending!.defaultId ?? copy.pending!.options[0].id);
  const toll = copy.log.slice(g.log.length).filter((e) => e.type === 'passToll' && e.player === seat).reduce((a, e) => a + e.amount!, 0);
  return { end: copy.state.turn.lastPath.at(-1)!, toll, left, defaults };
}

/** Every cell the engine's walk can end on from this ask, over every answer to it and to the asks after it. */
function engineEnds(g: Game): Set<NodeId> {
  const seat = g.pending!.player;
  const ends = new Set<NodeId>();
  const explore = (answers: string[]): void => {
    const copy = Game.replay(g.setup, [...g.history, ...answers], g.data);
    if (answers.length > 0 && !routeAsk(copy, seat)) ends.add(copy.state.turn.lastPath.at(-1)!);
    else for (const o of copy.pending!.options) explore([...answers, o.id]);
  };
  explore([]);
  return ends;
}

/** 迷魂丹, 逆行, a 镇山 mountain or 御骰符 in play: the walks most likely to drift from the engine's. */
function unusual(g: Game, c: PendingChoice): boolean {
  return g.state.players[c.player].dazed || g.state.turn.reverse || g.state.roadblock !== null || c.kind === 'rollValue';
}

/** Every ask `keep` takes from AI games over SEEDS, each on its own replayed copy; `keep` sees the asks taken so far in that game. */
function aiAsks(keep: (g: Game, c: PendingChoice, taken: number) => boolean): { g: Game; c: PendingChoice }[] {
  const found: { g: Game; c: PendingChoice }[] = [];
  for (const seed of SEEDS) {
    const g = newGame(seed);
    const ais = g.state.players.map((_, i) => new AIController(g, i, { difficulty: 'normal', personality: 'steady', seed }));
    g.start();
    for (let n = 0; !g.over;) {
      const c = g.pending!;
      if (keep(g, c, n)) {
        n++;
        found.push({ g: Game.replay(g.setup, g.history, g.data), c });
      }
      g.answer(ais[c.player].decide(c));
    }
  }
  return found;
}

/** Walk asks (rifts teleport and 镇山 places a mountain, they are checked on their own): the first few, and every unusual one. */
function walkAsks(): { g: Game; c: PendingChoice }[] {
  return aiAsks((g, c, n) => isPickKind(c.kind) && c.kind !== 'node' && c.kind !== 'target' && (n < ASKS_PER_SEED || unusual(g, c)));
}

describe('board picks', () => {
  const asks = walkAsks();

  it('lights every cell the walk can end on while they fit the number keys, each reached by its option and route', () => {
    const whole = asks.filter(({ g, c }) => !pickPlan(g, c)!.asksLater);
    for (const { g, c } of whole) {
      const plan = pickPlan(g, c)!;
      expect(new Set(plan.cells.map((x) => x.node))).toEqual(engineEnds(g));
      for (const cell of plan.cells) {
        const r = takeCell(g, cell);
        expect({ kind: c.kind, id: cell.id, end: r.end, toll: r.toll, left: r.left, defaults: r.defaults }).toEqual({
          kind: c.kind, id: cell.id, end: cell.node, toll: cell.toll, left: [], defaults: 0,
        });
      }
    }
    expect(new Set(whole.map((a) => a.c.kind))).toEqual(new Set(['fork', 'exitRoad', 'adjust', 'altarPass']));
    expect(whole.some(({ g, c }) => pickPlan(g, c)!.cells.some((x) => x.toll > 0))).toBe(true);
  }, 60000);

  it('past nine landings shows where each option goes by its default way, and leaves the later forks to ask', () => {
    const crowded = asks.filter(({ g, c }) => pickPlan(g, c)!.asksLater);
    for (const { g, c } of crowded) {
      for (const cell of pickPlan(g, c)!.cells) {
        expect(cell.route).toEqual([]);
        expect({ id: cell.id, end: takeCell(g, cell).end }).toEqual({ id: cell.id, end: cell.node });
      }
    }
    expect(crowded.length).toBeGreaterThan(0);
  }, 60000);

  it('lights each cell once, keys them 1–9 in order and makes the engine default the one Space picks', () => {
    for (const { g, c } of asks) {
      const cells = pickPlan(g, c)!.cells;
      expect(new Set(cells.map((x) => x.node)).size).toBe(cells.length);
      if (c.kind !== 'rollValue') expect(cells.map((x) => x.key)).toEqual(cells.map((_, i) => (i < 9 ? String(i + 1) : null)));
      expect(cells.filter((x) => x.primary)).toHaveLength(1);
      if (c.defaultId && cells.some((x) => x.id === c.defaultId)) expect(cells.find((x) => x.primary)!.id).toBe(c.defaultId);
    }
  });

  it('shows a mountain on the next cell as the only landing, whatever the step count', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R1';
    p.hand = ['swiftstep'];
    g.state.roadblock = { node: 'R2', seat: 1 };
    const options = g.adjustOptions(0, 6);
    const c = { seq: 1, player: 0, kind: 'adjust', title: '', options, defaultId: 'n6', ctx: { base: 6 } } as PendingChoice;
    expect(options.length).toBeGreaterThan(1);
    expect(pickPlan(g, c)!.cells).toEqual([expect.objectContaining({ node: 'R2', id: 'n6', primary: true })]);
  });

  it('walks a 逆行 move backwards', () => {
    const g = ringGame();
    g.state.players[0].pos = 'R7';
    g.state.turn.reverse = true;
    const c = { seq: 1, player: 0, kind: 'adjust', title: '', options: g.adjustOptions(0, 3), defaultId: 'n3', ctx: { base: 3 } } as PendingChoice;
    expect(pickPlan(g, c)!.cells.map((x) => x.node)).toEqual(['R4']);
  });

  it('marks a step count that spends 神行符 on its cell', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R1';
    p.hand = ['swiftstep'];
    const c = { seq: 1, player: 0, kind: 'adjust', title: '', options: g.adjustOptions(0, 4), defaultId: 'n4', ctx: { base: 4 } } as PendingChoice;
    const cells = pickPlan(g, c)!.cells;
    expect(cells.find((x) => x.id === 'n4')).toMatchObject({ label: '4 步', sub: undefined, primary: true });
    expect(cells.find((x) => x.id === 'n5')).toMatchObject({ label: '5 步', sub: '神行符 +1' });
  });

  it('puts the 过路费 a way pays on its cell, capped by the stones in hand', () => {
    const g = ringGame();
    g.state.players.forEach((p) => { p.pos = 'R16'; });
    const p = g.state.players[0];
    p.pos = 'R0';
    g.state.tiles.R1 = { owner: 1, level: 1 }; // toll 15
    g.state.tiles.R2 = { owner: 2, level: 0 }; // toll 5
    const c = { seq: 1, player: 0, kind: 'adjust', title: '', options: g.adjustOptions(0, 3), defaultId: 'n3', ctx: { base: 3 } } as PendingChoice;
    expect(pickPlan(g, c)!.cells).toEqual([expect.objectContaining({ node: 'R3', toll: 20, sub: '过路费 20' })]);
    p.stones = 17;
    expect(pickPlan(g, c)!.cells).toEqual([expect.objectContaining({ node: 'R3', toll: 17, sub: '过路费 17' })]);
  });

  it('keys 御骰符 cells by the value itself, 10 by 0, and leaves 11 and 12 to the mouse', () => {
    const g = ringGame();
    g.state.players[0].pos = 'R1';
    const options = Array.from({ length: 11 }, (_, i) => ({ id: `v${i + 2}`, label: `${i + 2} 点`, value: i + 2 }));
    const c = { seq: 1, player: 0, kind: 'rollValue', title: '御骰符', options, ctx: {} } as unknown as PendingChoice;
    const cells = pickPlan(g, c)!.cells;
    expect(cells.map((x) => [x.label, x.key])).toEqual(options.map((o) => [o.label, o.value <= 9 ? String(o.value) : o.value === 10 ? '0' : null]));
  });

  it('puts a 秘境裂隙 on the board: one cell per 秘境, named', () => {
    const g = newGame();
    const secrets = g.board.allNodeIds().filter((id) => g.board.node(id).type === 'secret');
    const options = secrets.map((id) => ({ id, label: id, value: id, node: id }));
    const c = { seq: 1, player: 0, kind: 'node', title: '秘境裂隙', desc: '选择要去的秘境', options, ctx: { purpose: 'rift' } } as PendingChoice;
    const cells = pickPlan(g, c)!.cells;
    expect(cells.map((x) => [x.node, x.id, x.label])).toEqual(secrets.map((id) => [id, id, g.nodeName(id)]));
  });

  it('puts 镇山 on the board: lights exactly the cells the engine lets the mountain fall on, each placing it there, Esc backing out', () => {
    const asks = aiAsks((_g, c) => c.kind === 'target' && c.ctx.purpose === 'roadblock');
    for (const { g, c } of asks) {
      const plan = pickPlan(g, c)!;
      expect(plan.cells.map((x) => x.node)).toEqual(g.skillTargets(c.player));
      for (const cell of plan.cells) {
        expect(Game.replay(g.setup, [...g.history, cell.id], g.data).state.roadblock).toEqual({ node: cell.node, seat: c.player });
      }
      const backed = Game.replay(g.setup, [...g.history, plan.cancelId!], g.data);
      expect(backed.state.roadblock).toBeNull();
      expect(backed.skillTargets(c.player)).toEqual(g.skillTargets(c.player));
    }
    expect(asks.length).toBeGreaterThan(0);
  }, 60000);

  it('leaves a target ask naming players (迷魂丹, 夺丹) to the modal', () => {
    const g = newGame();
    const options = [{ id: 'p1', label: 'B', value: { t: 'player', seat: 1 } }, { id: 'cancel', label: '取消', value: { t: 'cancel' } }];
    const c = { seq: 1, player: 0, kind: 'target', title: '迷魂丹', options, cancelId: 'cancel', ctx: { purpose: 'daze' } } as PendingChoice;
    expect(pickPlan(g, c)).toBeNull();
  });

  it('leaves every other kind to the modal', () => {
    const g = newGame();
    const c = { seq: 1, player: 0, kind: 'buy', title: '', options: [], ctx: {} } as unknown as PendingChoice;
    expect(pickPlan(g, c)).toBeNull();
  });
});
