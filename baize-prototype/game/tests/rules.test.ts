import { describe, expect, it } from 'vitest';
import { breakthroughCost, cultivation, rentFor } from '../src/core/rules';
import { AIController } from '../src/ai/ai';
import { newGame, script } from './helpers';

describe('rent', () => {
  it('applies level multipliers', () => {
    const g = newGame();
    const st = g.state;
    st.round = 1;
    st.tiles.R1 = { owner: 1, level: 0 };
    expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10); // P=100, R=10
    for (const [lv, mult] of g.data.config.levelRentMult.entries()) {
      st.tiles.R1.level = lv;
      expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10 * mult);
    }
  });

  it('doubles for 一域独占 and ×1.5 in the endgame, floored after multiplying', () => {
    const g = newGame();
    const st = g.state;
    st.round = 3;
    for (const id of g.board.landsInRegion('wood')) st.tiles[id] = { owner: 1, level: 0 };
    st.tiles.R1.level = 2;
    expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10 * 6 * 2);
    st.round = 13;
    expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10 * 6 * 2 * 1.5);
    // floor: R2 P=110 R=11, Lv1 ×3 = 33, monopoly ×2 = 66, endgame ×1.5 = 99
    st.tiles.R2.level = 1;
    expect(rentFor(st, g.board, g.data, 'R2', 0).amount).toBe(99);
    st.tiles.R7.owner = 2; // break monopoly: 11*3*1.5 = 49.5 -> 49
    expect(rentFor(st, g.board, g.data, 'R2', 0).amount).toBe(49);
  });

  it('is halved during the Baize manifest round and 0 on the demon tile', () => {
    const g = newGame();
    const st = g.state;
    st.tiles.R9 = { owner: 1, level: 1 }; // P=260 R=26 ×3 = 78
    st.round = 8;
    st.manifested = true;
    expect(rentFor(st, g.board, g.data, 'R9', 0).amount).toBe(39);
    st.demon = { node: 'R9', hp: 6, maxHp: 6, spawnRound: 5, leaveRound: 9 };
    expect(rentFor(st, g.board, g.data, 'R9', 0).amount).toBe(0);
  });

  it('payRent offers 避劫符 and transfers stones', () => {
    const g = newGame();
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
  it('costs = n-th breakthrough, −1 with 祠印, +1 with the demon, min 0', () => {
    const g = newGame();
    const st = g.state;
    const p = st.players[0];
    expect(breakthroughCost(st, g.data, 0)).toBe(1);
    p.seal = true;
    expect(breakthroughCost(st, g.data, 0)).toBe(0);
    st.demon = { node: 'R1', hp: 6, maxHp: 6, spawnRound: 5, leaveRound: 8 };
    expect(breakthroughCost(st, g.data, 0)).toBe(1);
    p.seal = false;
    expect(breakthroughCost(st, g.data, 0)).toBe(2);
    p.btUsed = 3;
    expect(breakthroughCost(st, g.data, 0)).toBe(5);
    p.seal = true;
    expect(breakthroughCost(st, g.data, 0)).toBe(4);
  });

  it('altar breakthrough pays pills, consumes the seal, lowest player sees 4 divines', () => {
    const g = newGame();
    const st = g.state;
    const p = st.players[0];
    p.btEarned = 1;
    p.pills = 3;
    p.seal = true;
    p.btUsed = 1; // second breakthrough: base cost 2, seal -> 1
    p.btEarned = 2;
    for (const o of st.players) o.cultBase = 4;
    p.cultBase = 2; // lowest
    let offered = 0;
    g.runFlow(g.testAltar(0), script({ altar: 'break', divinePick: (c) => { offered = c.options.length; return c.options[0].id; } }));
    expect(p.pills).toBe(2);
    expect(p.seal).toBe(false);
    expect(p.btUsed).toBe(2);
    expect(p.divines.length).toBe(1);
    expect(offered).toBe(g.data.config.breakthroughDrawLowest);
  });

  it('crossing thresholds grants opportunities based on peak cultivation', () => {
    const g = newGame();
    const st = g.state;
    g.runFlow((function* () { g.addCult(0, 3, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(1);
    g.runFlow((function* () { g.addCult(0, -2, 'test'); g.addCult(0, 2, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(1); // peak 3 -> no new threshold crossed back at 3
    g.runFlow((function* () { g.addCult(0, 1, 'test'); })(), script({}));
    expect(st.players[0].btEarned).toBe(2);
  });
});

describe('vein lord & buildings', () => {
  it('灵脉之主 gives +2 dynamically and is lost when overtaken', () => {
    const g = newGame();
    const st = g.state;
    for (const id of ['R1', 'R2', 'R3']) st.tiles[id] = { owner: 0, level: 0 };
    g.testUpdateVeinLords();
    expect(cultivation(st, g.data, 0)).toBe(2);
    // B ties at 3: A keeps it (先达成者保持)
    for (const id of ['R5', 'R7']) st.tiles[id] = { owner: 1, level: 0 };
    st.tiles.R3.owner = 1; // A drops to 2, B has 3
    g.testUpdateVeinLords();
    expect(cultivation(st, g.data, 0)).toBe(0);
    expect(cultivation(st, g.data, 1)).toBe(2);
  });

  it('Lv3 / Lv4 grant 修为 only the first time', () => {
    const g = newGame();
    const st = g.state;
    const p = st.players[0];
    p.stones = 5000;
    p.pills = 10;
    st.tiles.R1 = { owner: 0, level: 2 };
    g.runFlow((function* () { g.upgrade(0, 'R1', false); })(), script({}));
    expect(p.cultBase).toBe(1);
    st.tiles.R1.level = 2;
    g.runFlow((function* () { g.upgrade(0, 'R1', false); })(), script({}));
    expect(p.cultBase).toBe(1);
    g.runFlow((function* () { g.upgrade(0, 'R1', false); })(), script({}));
    expect(p.cultBase).toBe(2);
    expect(p.pills).toBe(10 - g.data.config.lv4PillCost);
  });
});

describe('bankruptcy', () => {
  it('破产重整: pays everything, loses lands, resets stones, loses 修为', () => {
    const g = newGame();
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
  it('reaching 10 修为 wins immediately', () => {
    const g = newGame(5);
    g.start();
    const p = g.state.players[0];
    p.cultBase = 9;
    p.hand = ['thunder', 'drain', 'bind', 'evade'];
    p.tasks = [{ id: 't_hand4', base: 0 }];
    const ans = script({ buy: 'no' });
    let guard = 0;
    while (!g.over && guard++ < 200) g.answer(ans(g.pending!));
    expect(g.over).toBe(true);
    expect(g.state.winner).toBe(0);
    expect(g.state.endReason).toBe('cultivation');
    expect(g.state.round).toBe(1);
    expect(g.pending).toBeNull();
  });

  it('a full AI game ends by 10 修为 or at the round cap with the ranking leader as winner', () => {
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
    const g = newGame();
    const cfg = g.data.config;
    expect(g.state.players.map((p) => p.stones)).toEqual(cfg.seatBonusStones.map((b) => cfg.startStones + b));
    expect(cfg.seatBonusStones).toEqual([0, 75, 150, 225]);
  });

  it('only the 五雷符 card earns the bounty; the 五雷正法 ult does not', () => {
    for (const [kind, gain] of [['thunder', 1], ['fivethunder', 0]] as const) {
      const g = newGame();
      const st = g.state;
      st.players[2].cultBase = 5;
      st.tiles.R1 = { owner: 2, level: 2 };
      const before = st.players[1].cultBase;
      g.runFlow((g as any).attackLand(1, 'R1', kind), script({}));
      expect(st.tiles.R1.level).toBe(1);
      expect(st.players[1].cultBase).toBe(before + gain);
    }
  });

  it('灵息 gives the magic hero a pill on a spring but not on a furnace', () => {
    const g = newGame();
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
