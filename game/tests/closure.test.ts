import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { chance2d6 } from '../src/core/rules';
import { ringGame, rngFor, script } from './helpers';

function quiet(g: Game): void {
  g.state.round = 1;
  ['R20', 'R24', 'R28', 'R16'].forEach((n, i) => { g.state.players[i].pos = n; });
}

function fullBar(g: Game, seat: number, pos: string, pills: number): void {
  const p = g.state.players[seat];
  p.pos = pos;
  p.cult = g.data.config.realms[p.realm].bar;
  p.pills = pills;
}

const tries = (g: Game) => g.log.filter((e) => e.type === 'breakthrough').length;
const ids = (c: PendingChoice) => c.options.map((o) => o.id);

describe('返回 from the 押丹 step', () => {
  it('goes back to 掷骰前 with nothing spent, and the 闭关 taken next is the same one', () => {
    const g = ringGame();
    quiet(g);
    fullBar(g, 0, 'ALTAR', 2);
    const p = g.state.players[0];
    p.hand = ['calm'];
    g.state.rng = rngFor([6, 6, 1, 1]);
    const asked: { pills: number; hand: string[]; rng: number; tries: number; closable: boolean }[] = [];
    const preRoll = (c: PendingChoice) => {
      asked.push({ pills: p.pills, hand: [...p.hand], rng: g.state.rng, tries: tries(g), closable: ids(c).includes('closure') });
      return ['closure', 'closure', 'roll'][asked.length - 1];
    };
    const seen: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(0), script({ preRoll, stake: ['back', 's1'], exitRoad: 'W2', buy: 'no', action: 'end' }, seen));
    expect(seen.slice(0, 5).map((c) => c.kind)).toEqual(['preRoll', 'stake', 'preRoll', 'stake', 'calm']);
    expect(asked[1]).toEqual(asked[0]);
    expect(asked[1].closable).toBe(true);
    expect([p.realm, p.pills, p.hand]).toEqual([1, 1, []]);
    expect(tries(g)).toBe(1);
  });

  it('goes back to the action phase, which still offers 闭关', () => {
    const g = ringGame();
    fullBar(g, 0, 'ALTAR', 1);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: ['closure', 'end'], stake: 'back' }, seen));
    const actions = seen.filter((c) => c.kind === 'action');
    expect(actions).toHaveLength(2);
    expect(ids(actions[1])).toContain('closure');
    expect([tries(g), g.state.turn.closed, g.state.players[0].pills]).toEqual([0, false, 1]);
  });

  it('引雷破境 backed out keeps the skill ready and spends nothing', () => {
    const g = ringGame();
    quiet(g);
    fullBar(g, 1, 'R14', 1);
    const b = g.state.players[1];
    b.turnsTaken = 1;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(1), script({ action: ['skill', 'end'], stake: 'back' }, seen));
    expect(g.log.some((e) => e.type === 'skill')).toBe(false);
    expect(g.skillReady(1)).toBe(true);
    expect([tries(g), b.pills, b.realm]).toEqual([0, 1, 0]);
    expect(ids(seen.filter((c) => c.kind === 'action')[1])).toContain('skill');
  });
});

describe('清心符 ask', () => {
  it('says what the chance is with and without the card for the stake just picked', () => {
    const g = ringGame();
    fullBar(g, 0, 'ALTAR', 1);
    g.state.players[0].hand = ['calm'];
    const seen: PendingChoice[] = [];
    g.runFlow(g.testClosure(0), script({ stake: 's1' }, seen));
    const stake = seen.find((c) => c.kind === 'stake')!;
    const calm = seen.find((c) => c.kind === 'calm')!;
    const { target, bonus } = stake.ctx as { target: number; bonus: number };
    const b = g.data.config.breakthrough;
    const pct = (need: number) => `${Math.round(chance2d6(need) * 100)}%`;
    const need = target - bonus - b.pillBonus;
    expect(calm.desc).toContain(`用：成功 ${pct(need)}；不用：${pct(need + b.calmBonus)}`);
  });
});
