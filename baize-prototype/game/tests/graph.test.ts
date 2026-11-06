import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import { cloneData } from '../src/core/data';
import type { BoardNodeData } from '../src/core/types';
import { newGame, placeAll, script } from './helpers';

// A loop A0..A5 with a fork at A2: the main line goes A3, A4; the shortcut B1, B2 rejoins at A5.
//
//   A0 → A1 → A2 → A3 → A4 → A5 → A0
//              ↘ B1 → B2 ↗
// The 妖兽谷 and the altar the engine requires sit off the loop.
function loopWithShortcut() {
  const data = cloneData();
  const land = (id: string, next: string[]): BoardNodeData => ({ id, type: 'land', pos: [0, 0], region: 'wood', name: id, price: 100, next });
  data.board.nodes = [
    { id: 'A0', type: 'start', pos: [0, 0], next: ['A1'] },
    land('A1', ['A2']),
    { id: 'A2', type: 'gate', pos: [0, 0], next: ['A3', 'B1'] },
    { id: 'A3', type: 'market', pos: [0, 0], next: ['A4'] },
    land('A4', ['A5']),
    land('A5', ['A0']),
    land('B1', ['B2']),
    land('B2', ['A5']),
    { id: 'C0', type: 'beast', pos: [0, 0], next: ['ALTAR'] },
    { id: 'ALTAR', type: 'altar', pos: [0, 0], next: ['C0'] },
  ];
  const g = newGame(1, data);
  placeAll(g, 'C0');
  return g;
}

describe('movement on a general road graph', () => {
  it('follows next forward and asks at a fork, offering the main line first', () => {
    const g = loopWithShortcut();
    const p = g.state.players[0];
    p.pos = 'A1';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 3), script({ fork: 'B1', buy: 'no' }, seen));
    const fork = seen.find((c) => c.kind === 'fork')!;
    expect(fork.ctx.node).toBe('A2');
    expect(fork.options.map((o) => o.id)).toEqual(['A3', 'B1']);
    expect(fork.defaultId).toBe('A3');
    expect(g.state.turn.lastPath).toEqual(['A1', 'A2', 'B1', 'B2']);

    p.pos = 'A1';
    g.runFlow(g.debugMove(0, 4), script({ buy: 'no' }));
    expect(g.state.turn.lastPath).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  });

  it('the shortcut rejoins the loop and passes the start', () => {
    const g = loopWithShortcut();
    const p = g.state.players[0];
    p.pos = 'B1';
    const s0 = p.stones;
    g.runFlow(g.debugMove(0, 4), script({ buy: 'no' }));
    expect(g.state.turn.lastPath).toEqual(['B1', 'B2', 'A5', 'A0', 'A1']);
    expect(p.stones).toBe(s0 + g.data.config.salaryPass);
  });

  it('moves in reverse along prev, where the merge point becomes a fork', () => {
    const g = loopWithShortcut();
    const p = g.state.players[0];
    p.pos = 'A0';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 3, -1), script({ fork: 'B2', buy: 'no' }, seen));
    const fork = seen.find((c) => c.kind === 'fork')!;
    expect(fork.ctx.node).toBe('A5');
    expect(fork.options.map((o) => o.id)).toEqual(['A4', 'B2']);
    expect(g.state.turn.lastPath).toEqual(['A0', 'A5', 'B2', 'B1']);
  });

  it('records the players passed on the branch actually taken', () => {
    const g = loopWithShortcut();
    g.state.players[0].pos = 'A1';
    g.state.players[1].pos = 'B1';
    g.state.players[3].pos = 'A3';
    g.runFlow(g.debugMove(0, 4), script({ fork: 'B1', buy: 'no' }));
    expect(g.state.turn.lastPath).toEqual(['A1', 'A2', 'B1', 'B2', 'A5']);
    expect(g.state.turn.passed).toEqual([1]);
  });
});
