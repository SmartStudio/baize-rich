import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { nominalRent, upgradeCost } from '../src/core/rules';
import { dockPlan } from '../src/ui/dockPlan';
import { ringGame, script } from './helpers';

function askAction(g: Game): PendingChoice {
  const seen: PendingChoice[] = [];
  g.runFlow(g.testActionPhase(0), script({ action: 'end' }, seen));
  return seen[0];
}

describe('action dock plan', () => {
  it('lists an affordable upgrade with its rent change and keeps 结束 quiet', () => {
    const g = ringGame();
    g.state.tiles.R1 = { owner: 0, level: 0 };
    const plan = dockPlan(g, askAction(g));
    const price = g.board.node('R1').price!;
    expect(plan.offers.find((row) => row.t === 'upgrade')).toMatchObject({
      id: 'upgrade:R1',
      key: '1',
      node: 'R1',
      title: '1  竹溪村  灵田→药圃',
      detail: `${upgradeCost(g.data, price, 1)} 灵石 · 租 ${nominalRent(g.data, price, 0)}→${nominalRent(g.data, price, 1)}`,
    });
    expect(plan.endLoud).toBe(false);
    expect(plan.nodes).toEqual(['R1']);
    expect(plan.hint).toContain('升级');
  });

  it('keeps 结束 loud when the action phase has nothing else to do', () => {
    const g = ringGame();
    g.state.players[0].skillReadyTurn = 99;
    const plan = dockPlan(g, askAction(g));
    expect(plan.offers).toEqual([]);
    expect(plan.end).toBe(true);
    expect(plan.endLoud).toBe(true);
    expect(plan.roll).toBe(false);
  });

  it('keeps 结束 quiet when a skill is still worth using', () => {
    const g = ringGame();
    const plan = dockPlan(g, askAction(g));
    expect(plan.offers).toEqual([]);
    expect(plan.cast).toBe(true);
    expect(plan.endLoud).toBe(false);
    expect(plan.hint).toContain('出符');
  });

  it('puts 服丹 and 闭关 on the same list, after the lands', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pills = 2;
    p.cult = g.data.config.realms[0].bar;
    p.pos = 'R1';
    g.state.tiles.R1 = { owner: 0, level: 1 };
    const plan = dockPlan(g, askAction(g));
    const gain = g.data.config.cultivation.pill;
    expect(plan.offers.map((row) => row.t)).toEqual(['upgrade', 'eat', 'closure']);
    expect(plan.offers[1]).toMatchObject({ id: 'eat', key: '2', detail: `+${gain} 修为 · 丹药 2→1` });
    expect(plan.offers[2].title).toContain('闭关');
    expect(plan.offers[2].title).toContain('练气→筑基');
    expect(plan.endLoud).toBe(false);
  });

  it('shows three upgrade rows and keeps the rest clickable', () => {
    const g = ringGame();
    for (const id of ['R1', 'R2', 'R3', 'R5', 'R7']) g.state.tiles[id] = { owner: 0, level: 0 };
    const plan = dockPlan(g, askAction(g));
    const nodes = plan.clicks.map((click) => click.node);
    expect(nodes).toHaveLength(5);
    expect(plan.nodes).toEqual(nodes);
    expect(plan.more).toBe(2);
    expect(plan.offers.filter((row) => row.t === 'upgrade').map((row) => row.node)).toEqual(nodes.slice(0, 3));
  });

  it('tells a pre-roll what the action phase will open, without listing it as a button yet', () => {
    const g = ringGame();
    g.state.tiles.R1 = { owner: 0, level: 0 };
    g.state.players[0].pills = 1;
    const plan = dockPlan(g, {
      seq: 1,
      player: 0,
      kind: 'preRoll',
      title: '掷骰前',
      options: [{ id: 'roll', label: '掷骰子', value: { t: 'roll' } }],
      defaultId: 'roll',
      ctx: {},
    });
    const price = g.board.node('R1').price!;
    expect(plan.roll).toBe(true);
    expect(plan.offers).toEqual([]);
    expect(plan.hint).toContain('竹溪村');
    expect(plan.hint).toContain(`${upgradeCost(g.data, price, 1)} 灵石`);
    expect(plan.hint).toContain(`租 ${nominalRent(g.data, price, 0)}→${nominalRent(g.data, price, 1)}`);
    expect(plan.hint).toContain(`服丹 +${g.data.config.cultivation.pill} 修为`);
    expect(plan.end).toBe(false);
  });
});
