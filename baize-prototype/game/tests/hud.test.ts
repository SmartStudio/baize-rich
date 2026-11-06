import { describe, expect, it } from 'vitest';
import { chance2d6 } from '../src/core/rules';
import { H, LEFT } from '../src/ui/layout';
import { barSegments, closeReadout } from '../src/ui/hudReadout';
import { tileTip } from '../src/ui/TileInfo';
import { newGame, ringGame, script } from './helpers';
import type { PendingChoice } from '../src/core/choices';

describe('seat column', () => {
  it('four chips sit between the round line and the ticker at 1280×720', () => {
    expect(LEFT.chipY).toBeGreaterThanOrEqual(LEFT.lineY + LEFT.lineH);
    const bottom = LEFT.chipY + 4 * LEFT.chipH + 3 * LEFT.chipGap;
    expect(bottom).toBeLessThanOrEqual(LEFT.tickerY);
    expect(LEFT.tickerY + LEFT.tickerH).toBeLessThanOrEqual(H);
    expect(LEFT.chipH % 2).toBe(0);
  });

  it('修为 segments fill the chip track on whole pixels', () => {
    const width = LEFT.w - 52 - 8;
    expect(Number.isInteger(width)).toBe(true);
    const parts = barSegments(width, 4, 2);
    expect(parts.every((w) => Number.isInteger(w) && w > 0)).toBe(true);
    expect(parts.reduce((sum, w) => sum + w, 0) + 2 * 3).toBe(width);
  });
});

describe('闭关 readout', () => {
  it('shows the unstaked chance only on a closable site', () => {
    const g = ringGame();
    const altarBonus = g.data.config.breakthrough.altarBonus;
    const target = g.data.config.realms[0].target;
    const a = g.state.players[0];
    a.realm = 0;
    a.cult = g.data.config.realms[0].bar;
    a.pos = 'R1';
    g.state.tiles.R1 = { owner: 0, level: 1 };
    const home = closeReadout(g.state, g.data, 0);
    expect(home?.label).toBe(`可闭关 ${Math.round(chance2d6(target) * 100)}%`);

    a.cult = 1;
    expect(closeReadout(g.state, g.data, 0)).toBeNull();

    const b = g.state.players[1];
    b.realm = 0;
    b.cult = g.data.config.realms[0].bar;
    b.pos = 'R1';
    g.state.tiles.R1 = { owner: 1, level: 0 };
    expect(closeReadout(g.state, g.data, 1)).toBeNull();

    b.pos = 'ALTAR';
    expect(closeReadout(g.state, g.data, 1)?.label).toBe(`可闭关 ${Math.round(chance2d6(target - altarBonus) * 100)}%`);
  });

  it('counts a held 清心符 only for a seat whose hand the viewer sees', () => {
    const g = ringGame();
    const { altarBonus, calmBonus } = g.data.config.breakthrough;
    const target = g.data.config.realms[0].target;
    Object.assign(g.state.players[0], { cult: g.data.config.realms[0].bar, pos: 'ALTAR', hand: ['calm'] });
    expect(closeReadout(g.state, g.data, 0, true)?.label).toBe(`可闭关 ${Math.round(chance2d6(target - altarBonus - calmBonus) * 100)}%`);
    expect(closeReadout(g.state, g.data, 0)?.label).toBe(`可闭关 ${Math.round(chance2d6(target - altarBonus) * 100)}%`);
  });

  it('action menu offers eat and closure under those ids', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pills = 1;
    p.realm = 0;
    p.cult = g.data.config.realms[0].bar;
    p.pos = 'R1';
    g.state.tiles.R1 = { owner: 0, level: 1 };
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: 'end' }, seen));
    const ids = seen[0].options.map((o) => o.id);
    expect(ids).toContain('eat');
    expect(ids).toContain('closure');
  });
});

describe('tile tip', () => {
  it('quotes v0.9 tile numbers and each land level from config', () => {
    const g = newGame();
    const c = g.data.config;
    const byType = new Map<string, string>();
    for (const id of g.board.allNodeIds()) {
      const type = g.board.node(id).type;
      if (!byType.has(type)) byType.set(type, tileTip(g, g.state, id).body);
    }
    expect([...byType.keys()].sort()).toEqual(
      ['alchemy', 'altar', 'beast', 'eye', 'gate', 'land', 'market', 'ruins', 'secret', 'spring', 'start'],
    );
    expect(byType.get('altar')).toContain(`突破 +${c.breakthrough.altarBonus}`);
    expect(byType.get('altar')).toContain(`+${c.cultivation.altarCalm}`);
    expect(byType.get('altar')).not.toContain('突破 +2');
    expect(byType.get('start')).toContain(`+${c.salaryPass}`);
    expect(byType.get('start')).toContain(`+${c.salaryLand}`);
    expect(byType.get('alchemy')).toContain(`${c.alchemy.herbsPerPill}`);
    expect(byType.get('alchemy')).toContain(`${c.alchemy.perfectBonus}`);
    expect(byType.get('market')).toContain(`${c.market.pillPrice}`);
    expect(byType.get('market')).toContain(`${c.market.cardPrice}`);
    expect(byType.get('spring')).toContain(`+${c.cultivation.spring}`);
    expect(byType.get('spring')).toContain(`+${c.spring.herbs}`);
    expect(byType.get('beast')).toContain(`${c.beast.target}`);
    expect(byType.get('beast')).toContain(`${c.beast.herbs}`);
    expect(byType.get('eye')).toContain(`+${c.cultivation.eye}`);

    const land = byType.get('land') ?? '';
    c.landLevels.forEach((row, lv) => {
      expect(land).toContain(g.data.board.buildings[lv].name);
      expect(land).toContain(`灵草 ${row.herbs}`);
      expect(land).toContain(`打坐 +${row.sit}`);
      expect(land).toContain(row.closureBonus === null ? '不可闭关' : `可闭关 +${row.closureBonus}`);
    });
    const home = g.data.heroes.find((h) => h.passive.traits.includes('homeClosure'));
    expect(land).toContain(home?.name ?? '');
  });
});
