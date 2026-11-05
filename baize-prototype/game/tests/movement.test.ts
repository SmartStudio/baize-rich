import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import { placeAll, ringData, ringGame, script } from './helpers';

describe('movement: fork, road, altar', () => {
  it('turns into the road at a gate, pays the altar toll and exits outward onto the ring', () => {
    const g = ringGame();
    placeAll(g, 'R0');
    const p = g.state.players[0];
    p.pos = 'R4';
    p.pills = 2;
    const seen: PendingChoice[] = [];
    // 7 steps: S1, S2, ALTAR (4 left) -> toll via E: E2, E1, R28(gate, no fork), R29
    g.runFlow(g.debugMove(0, 7), script({ fork: 'S1', altarPass: 'E2', buy: 'no' }, seen));
    // no fork at R28 when coming out of the road; landing on unowned R29 offers a buy
    expect(seen.map((c) => c.kind)).toEqual(['fork', 'altarPass', 'buy']);
    expect(g.state.turn.lastPath).toEqual(['R4', 'S1', 'S2', 'ALTAR', 'E2', 'E1', 'R28', 'R29']);
    expect(p.pos).toBe('R29');
    expect(p.pills).toBe(1); // paid altarToll
    expect(p.stats.roadEntries).toBe(1);
  });

  it('can stay on the ring at a gate', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R4';
    g.runFlow(g.debugMove(0, 2), script({ fork: 'R5' }));
    expect(p.pos).toBe('R6');
  });

  it('offers the fork when passing a gate mid-move, and roads only go inward', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R2';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 4), script({ fork: 'S1' }, seen));
    expect(seen[0].kind).toBe('fork');
    expect(seen[0].ctx.remaining).toBe(2);
    expect(p.pos).toBe('S2');
    // next move from S2 continues inward to the altar
    p.pills = 0;
    g.runFlow(g.debugMove(0, 3), script({}));
    expect(g.state.turn.lastPath).toEqual(['S2', 'ALTAR']);
  });

  it('must stop at the altar when out of 灵丹 even with steps left', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R4';
    p.pills = 0;
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 8), script({ fork: 'S1' }, seen));
    expect(p.pos).toBe('ALTAR');
    expect(seen.map((c) => c.kind)).toEqual(['fork', 'altar']); // no altarPass offered
  });

  it('stops at the altar when the move ends exactly there', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R4';
    p.pills = 5;
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 3), script({ fork: 'S1' }, seen));
    expect(p.pos).toBe('ALTAR');
    expect(seen.map((c) => c.kind)).toEqual(['fork', 'altar']);
    expect(p.pills).toBe(5);
  });

  it('can choose to stop at the altar with steps left', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R4';
    p.pills = 3;
    g.runFlow(g.debugMove(0, 9), script({ fork: 'S1', altarPass: 'stop' }));
    expect(p.pos).toBe('ALTAR');
    expect(p.pills).toBe(3);
  });

  it('leaves the altar next turn by any road and continues clockwise on the ring', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'ALTAR';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 5), script({ exitRoad: 'N2' }, seen));
    expect(seen[0].kind).toBe('exitRoad');
    expect(g.state.turn.lastPath).toEqual(['ALTAR', 'N2', 'N1', 'R20', 'R21', 'R22']);
  });

  it('迷踪: counter-clockwise movement also forks at gates', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R5';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 2, -1), script({ fork: 'S1' }, seen));
    expect(seen[0].kind).toBe('fork');
    expect(g.state.turn.lastPath).toEqual(['R5', 'R4', 'S1']);
  });

  it('passing the start gives salaryPass, landing gives salaryLand', () => {
    const g = ringGame();
    const p = g.state.players[0];
    const cfg = g.data.config;
    p.pos = 'R31';
    const s0 = p.stones;
    g.runFlow(g.debugMove(0, 2), script({ buy: 'no' })); // R0 (pass), R1
    expect(p.stones).toBe(s0 + cfg.salaryPass);
    p.pos = 'R30';
    const s1 = p.stones;
    // R31 is earth: mire eats one step, so 3 steps end exactly on R0
    g.runFlow(g.debugMove(0, 3), script({ buy: 'no' }));
    expect(p.pos).toBe('R0');
    expect(p.stones).toBe(s1 + cfg.salaryLand);
  });
});

describe('terrain', () => {
  it('寒冰滑行: ending on water slides one more cell (only once)', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R16';
    g.runFlow(g.debugMove(0, 2), script({ buy: 'no' }));
    // R17, R18 (water) -> slide to R19 (water, no second slide)
    expect(g.state.turn.lastPath).toEqual(['R16', 'R17', 'R18', 'R19']);
    expect(p.pos).toBe('R19');
  });

  it('寒冰滑行 onto a gate does not trigger the fork', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R18';
    const seen: PendingChoice[] = [];
    g.runFlow(g.debugMove(0, 1), script({ buy: 'no' }, seen));
    expect(p.pos).toBe('R20');
    expect(seen.some((c) => c.kind === 'fork')).toBe(false);
  });

  it('瘴泽泥沼: first earth land entered this turn costs 1 remaining step, once per turn', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R24';
    g.runFlow(g.debugMove(0, 3), script({ buy: 'no' }));
    expect(p.pos).toBe('R26'); // R25 (mire -1) -> R26
    // same turn: no second mire
    g.state.turn.lastPath = [];
    const walk = g.walk(0, 2, 1);
    g.runFlow(walk, script({ buy: 'no' }));
    expect(p.pos).toBe('R28');
  });

  it('瘴泽泥沼 never reduces a move below 1 step', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'R24';
    g.runFlow(g.debugMove(0, 1), script({ buy: 'no' }));
    expect(p.pos).toBe('R25');
  });
});

describe('rules config', () => {
  it('a ringData() copy with a tweaked rules value changes the 丹炉 payout', () => {
    const data = ringData();
    data.config.rules.furnacePills = 5;
    for (const [g, gain] of [[ringGame(1), 2], [ringGame(1, data), 5]] as const) {
      const p = g.state.players[0];
      p.pos = 'R5';
      const pills0 = p.pills;
      g.runFlow(g.debugMove(0, 1), script({}));
      expect(p.pos).toBe('R6');
      expect(p.pills).toBe(pills0 + gain);
    }
  });

  it('rules.chartDraw sets how many talismans the 白泽图 blessing draws', () => {
    const data = ringData();
    data.config.rules.chartDraw = 2;
    for (const [g, drawn] of [[ringGame(1), 1], [ringGame(1, data), 2]] as const) {
      const p = g.state.players[0];
      p.hand = [];
      const cult0 = p.cultBase;
      g.runFlow((g as any).applyHeaven(0, 'chart'), script({}));
      expect(p.hand.length).toBe(drawn);
      expect(p.cultBase).toBe(cult0 + 1);
    }
  });
});
