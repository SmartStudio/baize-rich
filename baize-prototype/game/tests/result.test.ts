import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/engine';
import type { BreakthroughResult, GameEvent } from '../src/core/events';
import type { SeatControl } from '../src/core/record';
import type { GameSetup } from '../src/core/types';
import { runHeadless } from '../src/sim/headless';
import { decidingStat } from '../src/ui/raceReadout';
import { recap, resultView } from '../src/ui/resultReadout';
import { newGame } from './helpers';

const AI: SeatControl = { human: false, difficulty: 'normal', personality: 'steady' };
const HUMAN: SeatControl = { ...AI, human: true };
const SETUP = (seed: number): GameSetup => ({ seed, players: newGame().setup.players });

function push(g: Game, round: number, e: Omit<GameEvent, 'seq' | 'round' | 'text'>): void {
  g.log.push({ seq: g.log.length, round, text: '', ...e });
}

function closure(from: number, success: boolean, cultLost = 0): BreakthroughResult {
  const bonuses = { pills: 0, site: 0, mind: 0, guidance: 0, insight: 0, momentum: 0, calm: 0 };
  return { from, dice: [3, 3], stake: 0, bonuses, total: 6, target: 9, success, cultLost };
}

describe('result rows', () => {
  it('rank seats as the engine does and box the one stat that settled each place', () => {
    for (const seed of [2, 7, 11]) {
      const { game } = runHeadless(SETUP(seed), [{}, {}, {}, {}]);
      const view = resultView(game, [AI, AI, AI, AI]);
      expect(view.rows.map((r) => r.seat)).toEqual(game.ranking());
      view.rows.forEach((row, k) => {
        const other = view.rows[k + 1 < view.rows.length ? k + 1 : k - 1].seat;
        const stat = decidingStat(game.state, game.board, game.data, row.seat, other);
        const boxed = row.stats.filter((s) => s.deciding).map((s) => s.text.split(' ')[0]);
        const expected = game.state.endReason === 'ascend' && k === 0 ? ['境界'] : stat === 'seat' ? [] : [{ realm: '境界', cult: '修为', assets: '总资产' }[stat]];
        expect(boxed).toEqual(expected);
      });
    }
  });

  it('say the ranking rule and why the winner won a round-cap game', () => {
    const g = newGame();
    g.state.over = true;
    g.state.endReason = 'roundCap';
    g.state.players[1].realm = 1;
    g.state.winner = 1;
    const view = resultView(g, [HUMAN, AI, AI, AI]);
    expect(view.rule).toBe('排名：12 轮内无人化神，比境界，境界相同比修为，再相同比总资产。');
    expect(view.sub).toBe('12 轮已尽，无人化神。沈青砚境界最高，夺得魁首。');
    expect(view.rows[0].note).toBe('境界比第 2 名高');
    expect(view.rows[0].stats[0]).toEqual({ text: '境界 筑基', deciding: true });
  });
});

describe('recap', () => {
  it('tells the human seat its key moments in round order, at most five', () => {
    const g = newGame();
    const [land, other] = g.board.lands;
    push(g, 2, { type: 'rent', player: 0, payee: 1, node: land, amount: 120 });
    push(g, 4, { type: 'rent', player: 0, payee: 3, node: other, amount: 300 });
    push(g, 3, { type: 'breakthrough', player: 0, breakthrough: closure(0, true) });
    push(g, 5, { type: 'rent', player: 2, payee: 0, node: other, amount: 90 });
    push(g, 6, { type: 'manifest' });
    push(g, 6, { type: 'salary', player: 2, amount: 400 });
    push(g, 6, { type: 'cult', player: 0, amount: 3 });
    push(g, 6, { type: 'turnStart', player: 0 });
    push(g, 8, { type: 'breakthrough', player: 0, breakthrough: closure(1, false, 2) });
    const r = recap(g, 0, true);
    expect(r.title).toBe('你的这一局');
    expect(r.lines).toEqual([
      '第 3 轮 · 闭关成功，踏入筑基。',
      '第 4 轮 · 停在陈半夏的「' + g.board.node(other).name + '」，付了 300 灵石租金，是最大的一笔。',
      '第 5 轮 · 燕回停在你的「' + g.board.node(other).name + '」，交来 90 灵石租金。',
      '第 6 轮 · 白泽现世，落后的先挑。你第 2 个挑，拿了白泽图。',
      '第 8 轮 · 冲击结丹失败，走火入魔，修为散去 2 点。',
    ]);
  });

  it('adds up the 过路费 others paid walking past the seat\'s land into one line', () => {
    const g = newGame();
    const [land, other] = g.board.lands;
    push(g, 2, { type: 'passToll', player: 1, payee: 0, node: land, amount: 15 });
    push(g, 4, { type: 'passToll', player: 2, payee: 0, node: other, amount: 30 });
    push(g, 4, { type: 'passToll', player: 0, payee: 2, node: other, amount: 99 });
    expect(recap(g, 0, true).lines).toContain('第 2 轮起 · 别人路过你的灵田 2 次，共交来 45 灵石过路费。');
  });

  it('pads a quiet game to three lines and says closure was never tried', () => {
    const g = newGame();
    const r = recap(g, 0, true);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toMatch(/^整局没有闭关。/);
  });

  it('recaps the winner when no seat is human, three to five lines for any finished game', () => {
    for (const seed of [1, 3, 7]) {
      const { game } = runHeadless(SETUP(seed), [{}, {}, {}, {}]);
      const view = resultView(game, [AI, AI, AI, AI]);
      const winner = game.data.heroes.find((h) => h.id === game.state.players[game.ranking()[0]].hero)!.name;
      expect(view.recap.title).toBe(`魁首${winner}的这一局`);
      expect(view.recap.lines.length).toBeGreaterThanOrEqual(3);
      expect(view.recap.lines.length).toBeLessThanOrEqual(5);
    }
  });
});
