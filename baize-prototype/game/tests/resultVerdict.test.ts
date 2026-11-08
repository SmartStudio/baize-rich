import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/engine';
import type { GameEvent } from '../src/core/events';
import { resultView } from '../src/ui/resultReadout';
import { verdict } from '../src/ui/resultVerdict';
import type { SeatControl } from '../src/core/record';
import { newGame } from './helpers';

const AI: SeatControl = { human: false, difficulty: 'normal', personality: 'steady' };
const HUMAN: SeatControl = { ...AI, human: true };

function duelLost(g: Game, seat: number): void {
  const duel = { attacker: 1, defender: seat, rolls: [6, 1], bonus: [0, 0], totals: [6, 1], winner: 1, loser: seat, pills: 1, stones: 0, escaped: false };
  g.log.push({ seq: g.log.length, round: 3, text: '', type: 'duel', player: 1, duel } as GameEvent);
}

/** Human at seat 0, the winner at seat 1 two realms up; the human closed once and owns a 药圃, so no early tip fits. */
function lostGame(): Game {
  const g = newGame();
  g.state.players[1].realm = 2;
  const p = g.state.players[0];
  p.stats.breakthroughs = 1;
  p.stats.pillsMade = 3;
  g.state.tiles[g.board.lands[0]] = { owner: 0, level: 1 };
  return g;
}

describe('result verdict', () => {
  it('says the human place and the gap to the winner on the stat that decided it', () => {
    const g = lostGame();
    expect(verdict(g, g.ranking(), 0)!.standing).toBe(`你位列第 ${g.ranking().indexOf(0) + 1}，境界落后冠军 2 阶。`);
    g.state.players[1].realm = 0;
    g.state.players[1].cult = 7;
    g.state.players[0].cult = 2;
    expect(verdict(g, [1, 0, 2, 3], 0)!.standing).toBe('你位列第 2，境界相同，修为落后冠军 5 点。');
    expect(verdict(g, [0, 1, 2, 3], 0)!.standing).toBe('你位列第 1，夺得魁首。');
  });

  it('picks the tip from this game: no closure first, then failed closures, no closure land, no pills, lost duels', () => {
    const g = lostGame();
    const p = g.state.players[0];
    const tip = (): string => verdict(g, g.ranking(), 0)!.tip;
    expect(tip()).toBe('多停在自家灵田打坐，修为长得更快，闭关也更早。');
    duelLost(g, 0);
    duelLost(g, 0);
    expect(tip()).toMatch(/^这局斗法输了 2 场。/);
    p.stats.pillsMade = 0;
    expect(tip()).toMatch(/^这局一颗丹药没炼。带 2 株灵草去丹房/);
    g.state.tiles[g.board.lands[0]] = { owner: 0, level: 0 };
    expect(tip()).toBe('把一块自家灵田升到药圃，就能就地闭关，不必赶回白泽灵台。');
    p.stats.breakthroughFails = 2;
    expect(tip()).toMatch(/^这局走火入魔 2 次。/);
    p.stats.breakthroughs = 0;
    p.stats.cultWasted = 6;
    expect(tip()).toBe('修为条一满就去白泽灵台或自家药圃以上的灵田闭关，境界只靠闭关升。这局修为条满后白白溢出 6 点。');
  });

  it('is part of the result view only when a seat is human', () => {
    const g = lostGame();
    expect(resultView(g, [HUMAN, AI, AI, AI]).verdict).toEqual(verdict(g, g.ranking(), 0));
    expect(resultView(g, [AI, AI, AI, AI]).verdict).toBeNull();
  });
});
