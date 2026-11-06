import { describe, expect, it } from 'vitest';
import { cultivation, rentFor } from '../src/core/rules';
import { AIController } from '../src/ai/ai';
import { newGame, ringGame, script } from './helpers';

describe('rent', () => {
  it('applies level multipliers', () => {
    const g = ringGame();
    const st = g.state;
    st.round = 1;
    st.tiles.R1 = { owner: 1, level: 0 };
    expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10); // P=100, R=10
    for (const [lv, mult] of g.data.config.levelRentMult.entries()) {
      st.tiles.R1.level = lv;
      expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10 * mult);
    }
  });


  it('is halved during the Baize manifest round', () => {
    const g = ringGame();
    const st = g.state;
    st.tiles.R9 = { owner: 1, level: 1 }; // P=260 R=26 ×3 = 78
    st.round = g.data.config.baizeManifestRound;
    st.manifested = true;
    expect(rentFor(st, g.board, g.data, 'R9', 0).amount).toBe(39);
  });

  it('payRent offers 避劫符 and transfers stones', () => {
    const g = ringGame();
    const st = g.state;
    st.round = 2;
    st.tiles.R9 = { owner: 1, level: 1 };
    const a = st.players[0];
    const b = st.players[1];
    const a0 = a.stones;
    const b0 = b.stones;
    g.runFlow(g.testPayRent(0, 'R9'), script({}));
    expect(a.stones).toBe(a0 - 78);
    expect(b.stones).toBe(b0 + 78);
    expect(b.stats.rentCollected).toBe(78);
    a.hand = ['evade'];
    a.pills = 2;
    g.runFlow(g.testPayRent(0, 'R9'), script({ rentReact: 'evade' }));
    expect(a.stones).toBe(a0 - 78);
    expect(a.pills).toBe(0);
    expect(a.hand).toEqual([]);
  });
});

describe('breakthrough', () => {
  it('crossing thresholds grants opportunities based on peak cultivation', () => {
    const g = ringGame();
    const st = g.state;
    g.runFlow((function* () { g.addCult(0, 3, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(1);
    g.runFlow((function* () { g.addCult(0, -2, 'test'); g.addCult(0, 2, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(1); // peak 3 -> no new threshold crossed back at 3
    g.runFlow((function* () { g.addCult(0, 1, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(2);
  });
});

describe('buildings', () => {
  it('Lv3 / Lv4 grant 修为 only the first time', () => {
    const g = ringGame();
    const st = g.state;
    const p = st.players[0];
    p.stones = 5000;
    p.pills = 10;
    st.tiles.R1 = { owner: 0, level: 2 };
    g.runFlow((function* () { g.upgrade(0, 'R1'); })(), script({}));
    expect(p.cultBase).toBe(1);
    st.tiles.R1.level = 2;
    g.runFlow((function* () { g.upgrade(0, 'R1'); })(), script({}));
    expect(p.cultBase).toBe(1);
    g.runFlow((function* () { g.upgrade(0, 'R1'); })(), script({}));
    expect(p.cultBase).toBe(2);
    expect(p.pills).toBe(10 - g.data.config.lv4PillCost);
  });
});

describe('bankruptcy', () => {
  it('破产重整: pays everything, loses lands, resets stones, loses 修为', () => {
    const g = ringGame();
    const st = g.state;
    const a = st.players[0];
    const b = st.players[1];
    st.round = 2;
    a.stones = 50;
    a.cultBase = 3;
    st.tiles.R1 = { owner: 0, level: 3 };
    st.tiles.R2 = { owner: 0, level: 1 };
    st.tiles.R9 = { owner: 1, level: 1 }; // rent 78
    const b0 = b.stones;
    g.runFlow(g.testPayRent(0, 'R9'), script({}));
    expect(b.stones).toBe(b0 + 50);
    expect(a.stones).toBe(g.data.config.bankrupt.resetStones);
    expect(a.cultBase).toBe(1);
    expect(st.tiles.R1).toEqual({ owner: null, level: 0 });
    expect(st.tiles.R2).toEqual({ owner: null, level: 0 });
    expect(a.stats.bankruptcies).toBe(1);
    a.stones = 10;
    a.cultBase = 1;
    g.runFlow(g.testPayRent(0, 'R9'), script({}));
    expect(a.cultBase).toBe(0); // min 0
  });
});

describe('win detection', () => {
  it('reaching the 修为 win line wins immediately', () => {
    const g = newGame(5);
    g.start();
    const p = g.state.players[0];
    p.cultBase = g.data.config.winCultivation - 1;
    p.stones = 5000;
    g.state.tiles[g.board.lands[0]] = { owner: 0, level: 2 };
    const upgrade = (c: { options: { id: string }[] }) => c.options.find((o) => o.id.startsWith('upgrade'))?.id ?? 'end';
    const ans = script({ buy: 'no', action: upgrade });
    let guard = 0;
    while (!g.over && guard++ < 200) g.answer(ans(g.pending!));
    expect(g.over).toBe(true);
    expect(g.state.winner).toBe(0);
    expect(g.state.endReason).toBe('cultivation');
    expect(g.state.round).toBe(1);
    expect(g.pending).toBeNull();
  });

  it('a full AI game ends by the 修为 win line or at the round cap with the ranking leader as winner', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const g = newGame(seed);
      const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed }));
      g.start();
      while (!g.over) g.answer(ais[g.pending!.player].decide(g.pending!));
      if (g.state.endReason === 'roundCap') {
        expect(g.state.round).toBe(g.data.config.rounds);
        expect(g.state.winner).toBe(g.ranking()[0]);
      } else {
        expect(cultivation(g.state, g.data, g.state.winner!)).toBeGreaterThanOrEqual(g.data.config.winCultivation);
      }
    }
  });

  it('is deterministic: replaying the answer history reproduces the game', () => {
    const g = newGame(42);
    const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed: 42 }));
    g.start();
    while (!g.over) g.answer(ais[g.pending!.player].decide(g.pending!));
    const r = (g.constructor as typeof import('../src/core/engine').Game).replay(g.setup, g.history);
    expect(r.state).toEqual(g.state);
  });
});

describe('balance rules (2026-11 phase 1)', () => {
  it('later seats start with config.seatBonusStones on top of startStones', () => {
    const g = ringGame();
    const cfg = g.data.config;
    expect(g.state.players.map((p) => p.stones)).toEqual(cfg.seatBonusStones.map((b) => cfg.startStones + b));
    expect(cfg.seatBonusStones[0]).toBe(0);
    expect(cfg.seatBonusStones.every((v, i, a) => i === 0 || v > a[i - 1])).toBe(true);
  });


  it('灵息 gives the magic hero a pill on a spring but not on a furnace', () => {
    const g = ringGame();
    const magic = g.state.players[1];
    const pills = (to: string) => {
      const before = magic.pills;
      (g as any).enterNode(1, 'R0', to, 1, false);
      return magic.pills - before;
    };
    expect(pills('S2')).toBe(g.data.config.rules.magicPassivePills);
    expect(pills('R6')).toBe(0);
  });
});
