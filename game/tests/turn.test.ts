import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { ringGame, rngFor, script } from './helpers';

// Ring fixture: R4 is a gate forking to 神道 S1 → S2 → ALTAR; the altar leads out to S2 / W2 / N2 / E2.

/** Everyone parked far from the test area on round 1. */
function quiet(g: Game): void {
  g.state.round = 1;
  ['R20', 'R24', 'R28', 'R16'].forEach((n, i) => { g.state.players[i].pos = n; });
}

const kinds = (seen: PendingChoice[]) => seen.map((c) => c.kind);
const altarCalm = (g: Game) => g.log.filter((e) => e.cult?.source === 'altar').length;

describe('掷骰后调整', () => {
  it('筑基 御器 offers ±1; 神行符 adds +1..+3 on top, cheapest way first', () => {
    const g = ringGame();
    const p = g.state.players[0];
    expect(g.adjustOptions(0, 7).map((o) => o.value.steps)).toEqual([7]);
    p.realm = 1;
    expect(g.adjustOptions(0, 7).map((o) => o.value.steps)).toEqual([6, 7, 8]);
    p.hand = ['swiftstep'];
    const opts = g.adjustOptions(0, 7);
    expect(opts.map((o) => o.value.steps)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(opts.find((o) => o.value.steps === 8)!.value).toEqual({ steps: 8, card: false, steer: 1 });
  });

  it('spending 神行符 after the real dice moves the extra steps and discards the card', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'R5';
    p.hand = ['swiftstep'];
    g.state.rng = rngFor([3, 4]);
    g.runFlow(g.testPlayTurn(0), script({ adjust: 'n9', buy: 'no', action: 'end' }));
    expect(p.pos).toBe('R14');
    expect(p.hand).toEqual([]);
  });
});

describe('闭关的时机', () => {
  it('a full bar on a closure site can close before rolling, once per turn', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'ALTAR';
    p.cult = g.data.config.realms[0].bar;
    const seen: PendingChoice[] = [];
    g.state.rng = rngFor([6, 6, 1, 1]);
    g.runFlow(g.testPlayTurn(0), script({ preRoll: ['closure', 'roll'], exitRoad: 'W2', buy: 'no', action: 'end' }, seen));
    const pre = seen.filter((c) => c.kind === 'preRoll');
    expect(pre[0].options.map((o) => o.id)).toContain('closure');
    expect(pre[1].options.map((o) => o.id)).not.toContain('closure');
    expect(p.realm).toBe(1);
  });

  it('白泽问心: ending the turn on the altar without closing gives +1 修为', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'R1';
    g.state.rng = rngFor([3, 3]);
    g.runFlow(g.testPlayTurn(0), script({ fork: 'S1', action: 'end' }));
    expect(p.pos).toBe('ALTAR');
    expect(altarCalm(g)).toBe(1);
    expect(p.cult).toBe(g.data.config.cultivation.breath + g.data.config.cultivation.altarCalm);
  });

  it('no 白泽问心 after a closure attempt on the altar', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'R1';
    p.cult = g.data.config.realms[0].bar;
    g.state.rng = rngFor([3, 3, 1, 1]);
    g.runFlow(g.testPlayTurn(0), script({ fork: 'S1', action: ['closure', 'end'] }));
    expect(p.stats.breakthroughs).toBe(1);
    expect(altarCalm(g)).toBe(0);
  });
});

describe('移动', () => {
  it('借道: paying a pill at the altar keeps walking out along the chosen road', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'R1';
    p.pills = 2;
    g.runFlow(g.debugMove(0, 8), script({ fork: 'S1', altarPass: 'W2', buy: 'no' }));
    expect(p.pos).toBe('W1');
    expect(p.pills).toBe(2 - g.data.config.altarToll);
  });

  it('定身 skips rolling and moving but keeps the action phase', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'R1';
    p.bound = true;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(0), script({ action: 'end' }, seen));
    expect(kinds(seen)).toEqual(['action']);
    expect(p.pos).toBe('R1');
    expect(p.bound).toBe(false);
  });
});

describe('机缘', () => {
  it('秘境裂隙 moves to another 秘境 of your choice and draws again there', () => {
    const g = ringGame();
    quiet(g);
    const p = g.state.players[0];
    p.pos = 'S1';
    const seen: PendingChoice[] = [];
    g.runFlow(g.testFortune(0, 'rift'), script({ node: 'W1' }, seen));
    const pick = seen.find((c) => c.kind === 'node')!;
    expect(pick.options.map((o) => o.id).sort()).toEqual(['E1', 'N1', 'W1']);
    expect(p.pos).toBe('W1');
    expect(g.log.filter((e) => e.type === 'event').length).toBeGreaterThanOrEqual(2);
  });

  it('古修洞府 draws two 机缘 and keeps the chosen one', () => {
    const g = ringGame();
    quiet(g);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'R16'), script({ fortunePick: 'f1' }, seen));
    const pick = seen.find((c) => c.kind === 'fortunePick')!;
    expect(pick.options).toHaveLength(2);
    expect(g.log.filter((e) => e.type === 'event')[0].text).toContain(g.data.events.events.find((e) => e.id === pick.options[1].value)!.name);
  });

  it('妖兽袭击 costs stones below 元婴 and is shrugged off from 元婴 on', () => {
    const g = ringGame();
    const [a, b] = g.state.players;
    const [a0, b0] = [a.stones, b.stones];
    b.realm = 3;
    g.runFlow(g.testFortune(0, 'beasts'), script({}));
    g.runFlow(g.testFortune(1, 'beasts'), script({}));
    expect(a.stones).toBe(a0 - 150);
    expect(b.stones).toBe(b0);
  });
});
