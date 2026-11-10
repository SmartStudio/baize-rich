import { describe, expect, it } from 'vitest';
import { compareStanding } from '../src/core/rules';
import type { GameSetup } from '../src/core/types';
import { runHeadless } from '../src/sim/headless';
import { decidingStat, raceView, roundChip, standings } from '../src/ui/raceReadout';
import { newGame } from './helpers';

const SETUP = (seed: number): GameSetup => ({ seed, players: newGame().setup.players });

describe('realm race', () => {
  it('orders seats exactly as the engine ranks them, and names a stat that separates each neighbour', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const { game } = runHeadless(SETUP(seed), [{}, {}, {}, {}]);
      const order = standings(game.state, game.board, game.data);
      expect(order).toEqual(game.ranking());
      for (let k = 0; k + 1 < order.length; k++) {
        const stat = decidingStat(game.state, game.board, game.data, order[k], order[k + 1]);
        const p = game.state.players[order[k]];
        const q = game.state.players[order[k + 1]];
        if (stat === 'realm') expect(p.realm).toBeGreaterThan(q.realm);
        if (stat === 'cult') expect([p.realm === q.realm, p.cult > q.cult]).toEqual([true, true]);
        expect(compareStanding(game.state, game.board, game.data, order[k], order[k + 1])).toBeLessThan(0);
      }
    }
  });

  it('fills passed realms, the current realm up to its 修为, and nothing beyond', () => {
    const g = newGame();
    const a = g.state.players[0];
    a.realm = 1;
    a.cult = 2;
    const view = raceView(g.state, g.board, g.data);
    expect(view.realms.map((r) => r.name)).toEqual(['练气', '筑基', '结丹', '元婴']);
    expect(view.goal).toBe('化神');
    expect(view.rows[0]).toEqual({ seat: 0, cells: [4, 2, 0, 0], ascended: false });
    expect(view.lead).toBe('A 领先：境界最高');
  });

  it('says why the leader leads, down to the tie-break', () => {
    const g = newGame();
    for (const p of g.state.players) p.stones = 1000;
    expect(raceView(g.state, g.board, g.data).lead).toBe('众人并肩，尚无人领先');
    g.state.players[2].cult = 3;
    expect(raceView(g.state, g.board, g.data).lead).toBe('C 领先：同境界中修为最多');
    g.state.players[1].cult = 3;
    g.state.players[1].stones += 100;
    expect(raceView(g.state, g.board, g.data).lead).toBe('B 领先：境界修为相同，资产最多');
  });
});

describe('round chip', () => {
  it('names the next milestone and when it comes', () => {
    const g = newGame();
    const st = g.state;
    st.round = 1;
    expect(roundChip(st, g.data).text).toBe('5轮后白泽现世');
    st.round = 6;
    st.manifested = true;
    expect(roundChip(st, g.data)).toMatchObject({ text: '白泽现世·落后先挑', tone: 'gold' });
    st.round = 9;
    expect(roundChip(st, g.data).text).toBe('3轮后秘境关闭');
    st.round = 12;
    expect(roundChip(st, g.data)).toMatchObject({ text: '本轮结束秘境关闭', tone: 'gold' });
  });
});
