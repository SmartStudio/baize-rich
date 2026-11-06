import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import { Game } from '../src/core/engine';
import { rentFor, upgradeCost, winRealm } from '../src/core/rules';
import { AIController } from '../src/ai/ai';
import { newGame, ringGame, rngFor, script } from './helpers';

// Seats: 0 A 体修(body), 1 B 法修(magic), 2 C 剑修(sword), 3 D 丹师(alch).
// Ring fixture prices: R1 100, R2 110, R3 120, R9 260.

/** Seat on `node` with a full bar at `realm`. */
function readyToClose(g: Game, seat: number, node: string, realm = 0): void {
  const p = g.state.players[seat];
  p.realm = realm;
  p.cult = g.data.config.realms[realm].bar;
  p.pos = node;
}

describe('灵田', () => {
  it('rent is price × rentRate × the level multiplier', () => {
    const g = ringGame();
    const st = g.state;
    st.tiles.R1 = { owner: 1, level: 0 };
    g.data.config.landLevels.forEach((lv, i) => {
      st.tiles.R1.level = i;
      expect(rentFor(st, g.board, g.data, 'R1', 0).amount).toBe(10 * lv.rentMult);
    });
    expect(rentFor(st, g.board, g.data, 'R1', 1).amount).toBe(0);
  });

  it('payRent transfers stones, and 避劫符 waives it for the card alone', () => {
    const g = ringGame();
    const [a, b] = g.state.players;
    g.state.tiles.R9 = { owner: 1, level: 1 }; // 26 × 3 = 78
    const [a0, b0] = [a.stones, b.stones];
    g.runFlow(g.testPayRent(0, 'R9'), script({}));
    expect([a.stones, b.stones]).toEqual([a0 - 78, b0 + 78]);
    a.hand = ['evade'];
    a.pills = 2;
    g.runFlow(g.testPayRent(0, 'R9'), script({ rentReact: 'evade' }));
    expect(a.stones).toBe(a0 - 78);
    expect(a.pills).toBe(2);
    expect(a.hand).toEqual([]);
  });

  it('upgrading costs price × upgradeCostP and is limited to one per turn', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.stones = 5000;
    g.state.tiles.R1 = { owner: 0, level: 0 };
    g.state.tiles.R2 = { owner: 0, level: 0 };
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: ['upgrade:R1', 'end'] }, seen));
    expect(g.state.tiles.R1.level).toBe(1);
    expect(p.stones).toBe(5000 - upgradeCost(g.data, 100, 1));
    expect(seen[1].options.some((o) => o.id.startsWith('upgrade'))).toBe(false);
  });

  it('each round starts with herbs from every owned 药圃 and 洞府', () => {
    const g = ringGame();
    const p = g.state.players[0];
    g.state.round = 2;
    g.state.tiles.R1 = { owner: 0, level: 2 };
    g.state.tiles.R2 = { owner: 0, level: 3 };
    g.state.tiles.R3 = { owner: 0, level: 1 };
    const lv = g.data.config.landLevels;
    g.runFlow(g.testRoundStart(), script({}));
    expect(p.herbs).toBe(lv[1].herbs + lv[2].herbs + lv[3].herbs);
  });
});

describe('修为', () => {
  it('吐纳 +1 every turn end, 打坐 adds the own land sit value', () => {
    const g = ringGame();
    const p = g.state.players[0];
    const lv = g.data.config.landLevels;
    g.state.tiles.R1 = { owner: 0, level: 3 };
    p.pos = 'R2';
    g.testTurnEnd(0);
    expect(p.cult).toBe(1);
    p.pos = 'R1';
    g.testTurnEnd(0);
    expect(p.cult).toBe(Math.min(1 + 1 + lv[3].sit, g.data.config.realms[0].bar));
  });

  it('the bar caps 修为; the overflow is wasted and counted', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.cult = g.data.config.realms[0].bar - 1;
    g.state.tiles.R1 = { owner: 0, level: 3 };
    p.pos = 'R1';
    g.testTurnEnd(0); // +1 吐纳, +2 打坐: only 1 fits
    expect(p.cult).toBe(g.data.config.realms[0].bar);
    expect(p.stats.cultWasted).toBe(2);
  });

  it('灵泉 gives 修为 and a herb; 法修 gets +1 more', () => {
    const g = ringGame();
    const c = g.data.config;
    g.runFlow(g.testSettle(0, 'S2'), script({}));
    g.runFlow(g.testSettle(1, 'S2'), script({}));
    expect(g.state.players[0].cult).toBe(c.cultivation.spring);
    expect(g.state.players[1].cult).toBe(c.cultivation.spring + c.cultivation.magicBonus);
    expect(g.state.players[1].herbs).toBe(c.spring.herbs);
  });

  it('服丹 turns one pill into 修为, once per turn', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pills = 3;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: ['eat', 'end'] }, seen));
    expect(p.pills).toBe(2);
    expect(p.cult).toBe(g.data.config.cultivation.pill);
    expect(seen[1].options.map((o) => o.id)).not.toContain('eat');
  });
});

describe('闭关突破', () => {
  it('is offered only with a full bar on the altar or an own 药圃+', () => {
    const g = ringGame();
    const p = g.state.players[0];
    const offered = () => {
      const seen: PendingChoice[] = [];
      g.state.turn.closed = false;
      g.runFlow(g.testActionPhase(0), script({ action: 'end' }, seen));
      return seen[0].options.some((o) => o.id === 'closure');
    };
    g.state.tiles.R1 = { owner: 0, level: 1 };
    g.state.tiles.R2 = { owner: 0, level: 2 };
    readyToClose(g, 0, 'R1');
    expect(offered()).toBe(false); // 灵田 Lv1 is not a closure site
    p.pos = 'R2';
    expect(offered()).toBe(true);
    p.pos = 'ALTAR';
    expect(offered()).toBe(true);
    p.cult--;
    expect(offered()).toBe(false);
  });

  it('2D6 + altar + 心境 + staked pills ≥ target breaks through; staked pills are spent', () => {
    const g = ringGame();
    const p = g.state.players[0];
    const b = g.data.config.breakthrough;
    readyToClose(g, 0, 'ALTAR');
    p.mind = 1;
    p.pills = 4;
    g.state.rng = rngFor([1, 1]);
    g.runFlow(g.testClosure(0), script({ stake: 's2' }));
    const r = g.log.find((e) => e.type === 'breakthrough')!.breakthrough!;
    expect(r.bonuses).toEqual({ pills: 2 * b.pillBonus, site: b.altarBonus, mind: b.mindBonus, guidance: 0, calm: 0 });
    expect(r.total).toBe(2 + 2 * b.pillBonus + b.altarBonus + b.mindBonus);
    expect(r.success).toBe(r.total >= g.data.config.realms[0].target);
    expect([p.realm, p.cult, p.mind, p.pills]).toEqual([1, 0, 0, 2]);
  });

  it('走火入魔 halves the bar (rounded down) and adds 1 心境', () => {
    const g = ringGame();
    const p = g.state.players[0];
    g.state.tiles.R2 = { owner: 0, level: 2 };
    readyToClose(g, 0, 'R2');
    p.pills = 1;
    g.state.rng = rngFor([1, 2]);
    g.runFlow(g.testClosure(0), script({ stake: 's1' }));
    expect(p.realm).toBe(0);
    expect(p.cult).toBe(Math.floor(g.data.config.realms[0].bar / 2));
    expect(p.mind).toBe(1);
    expect(p.pills).toBe(0);
    expect(p.stats.breakthroughFails).toBe(1);
  });

  it('stakes at most maxPills and never more than owned', () => {
    const g = ringGame();
    const p = g.state.players[0];
    readyToClose(g, 0, 'ALTAR');
    const stakes = (pills: number) => {
      p.pills = pills;
      const seen: PendingChoice[] = [];
      g.runFlow(g.testClosure(0), script({}, seen));
      p.realm = 0;
      p.cult = g.data.config.realms[0].bar;
      return seen.find((c) => c.kind === 'stake')!.options.map((o) => o.value);
    };
    expect(stakes(5)).toEqual([0, 1, 2, 3]);
    expect(stakes(1)).toEqual([0, 1]);
  });

  it('清心符 and 前辈指点 each add their bonus and are used up', () => {
    const g = ringGame();
    const p = g.state.players[0];
    const b = g.data.config.breakthrough;
    readyToClose(g, 0, 'ALTAR');
    p.hand = ['calm'];
    p.guidance = 2;
    g.state.rng = rngFor([1, 1]);
    g.runFlow(g.testClosure(0), script({ calm: 'calm' }));
    const r = g.log.find((e) => e.type === 'breakthrough')!.breakthrough!;
    expect(r.bonuses.calm).toBe(b.calmBonus);
    expect(r.bonuses.guidance).toBe(b.guidanceBonus);
    expect(p.hand).toEqual([]);
    expect(p.guidance).toBe(1);
  });

  it('breaking through to 化神 ends the game at once', () => {
    const g = ringGame();
    readyToClose(g, 2, 'ALTAR', winRealm(g.data) - 1);
    g.state.rng = rngFor([6, 6]);
    g.runFlow(g.testClosure(2), script({}));
    expect(g.state.over).toBe(true);
    expect(g.state.winner).toBe(2);
    expect(g.state.endReason).toBe('ascend');
  });
});

describe('丹房', () => {
  const brew = (seat: number, herbs: number, tier: string) => {
    const g = ringGame();
    const p = g.state.players[seat];
    p.herbs = herbs;
    g.runFlow(g.testSettle(seat, 'R6'), script({ miniGame: tier }));
    return [p.pills, p.herbs];
  };

  it('turns every 2 herbs into a pill; the first 炉 plays 火候', () => {
    expect(brew(0, 5, 'ok')).toEqual([2, 1]);
    expect(brew(0, 4, 'perfect')).toEqual([3, 0]);
    expect(brew(0, 4, 'fail')).toEqual([1, 0]);
  });

  it('丹道: the 丹师 makes one more pill per visit', () => {
    expect(brew(3, 4, 'ok')).toEqual([3, 0]);
  });

  it('without herbs nothing is asked', () => {
    const g = ringGame();
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'R6'), script({}, seen));
    expect(seen).toEqual([]);
  });
});

describe('妖兽谷', () => {
  it('2D6 + realm ≥ target wins herbs, else costs stones; 体修 always wins', () => {
    const g = ringGame();
    const b = g.data.config.beast;
    const [a, c] = [g.state.players[0], g.state.players[2]];
    const c0 = c.stones;
    g.state.rng = rngFor([1, 1]);
    g.runFlow(g.testSettle(0, 'R8'), script({}));
    expect(a.herbs).toBe(b.herbs);
    g.state.rng = rngFor([1, 1]);
    g.runFlow(g.testSettle(2, 'R8'), script({}));
    expect(c.stones).toBe(c0 - b.loss);
    g.state.rng = rngFor([4, 4]);
    g.runFlow(g.testSettle(2, 'R8'), script({}));
    expect(c.herbs).toBe(b.herbs);
  });
});

describe('白泽现世', () => {
  it('the trailing player picks first and each gift goes once', () => {
    const g = ringGame();
    const st = g.state;
    const m = g.data.config.manifest;
    st.round = m.round;
    st.players[0].realm = 2;
    st.players[1].realm = 1;
    st.players[1].cult = 3;
    st.players[2].realm = 1;
    st.players[2].cult = 1;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testRoundStart(), script({}, seen));
    const picks = seen.filter((c) => c.kind === 'manifestPick');
    expect(picks.map((c) => c.player)).toEqual([3, 2, 1, 0]);
    expect(picks.map((c) => c.options.length)).toEqual([4, 3, 2, 1]);
    expect(st.players[3].cult).toBe(m.chartCult);
    expect(st.players[0].pos).toBe('ALTAR');
    expect(st.manifested).toBe(true);
  });
});

describe('破产重整', () => {
  it('pays what it can, returns the lands, resets stones and clears the bar but keeps the realm', () => {
    const g = ringGame();
    const st = g.state;
    const [a, b] = st.players;
    a.stones = 50;
    a.realm = 1;
    a.cult = 3;
    st.tiles.R1 = { owner: 0, level: 3 };
    st.tiles.R9 = { owner: 1, level: 1 }; // rent 78
    const b0 = b.stones;
    g.runFlow(g.testPayRent(0, 'R9'), script({}));
    expect(b.stones).toBe(b0 + 50);
    expect(a.stones).toBe(g.data.config.bankrupt.resetStones);
    expect([a.realm, a.cult]).toEqual([1, 0]);
    expect(st.tiles.R1).toEqual({ owner: null, level: 0 });
    expect(a.stats.bankruptcies).toBe(1);
  });
});

describe('胜负', () => {
  it('standing is realm, then bar, then total assets', () => {
    const g = ringGame();
    const st = g.state;
    st.players[1].realm = 2;
    st.players[3].realm = 2;
    st.players[3].cult = 1;
    st.players[0].stones += 1000;
    expect(g.ranking()).toEqual([3, 1, 0, 2]);
  });

  it('a full AI game ends by 化神 or at the round cap with the ranking leader as winner', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed);
      const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed }));
      g.start();
      while (!g.over) g.answer(ais[g.pending!.player].decide(g.pending!));
      if (g.state.endReason === 'roundCap') {
        expect(g.state.round).toBe(g.data.config.rounds);
        expect(g.state.winner).toBe(g.ranking()[0]);
      } else {
        expect(g.state.players[g.state.winner!].realm).toBe(winRealm(g.data));
      }
    }
  });

  it('is deterministic: replaying the answer history reproduces the game', () => {
    const g = newGame(42);
    const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed: 42 }));
    g.start();
    while (!g.over) g.answer(ais[g.pending!.player].decide(g.pending!));
    expect(Game.replay(g.setup, g.history).state).toEqual(g.state);
  });

  it('later seats start with config.seatBonusStones on top of startStones', () => {
    const g = ringGame();
    const cfg = g.data.config;
    expect(g.state.players.map((p) => p.stones)).toEqual(cfg.seatBonusStones.map((b) => cfg.startStones + b));
  });
});
