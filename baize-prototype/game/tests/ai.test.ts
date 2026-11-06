import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { winRealm } from '../src/core/rules';
import { AIController } from '../src/ai/ai';
import { matchup } from '../src/sim/matchup';
import { ringGame } from './helpers';

// Seats: 0 体修, 1 法修, 2 剑修, 3 丹师.

/** Answers with the AI for `seat`, recording every choice and the answer given. */
function aiAnswers(g: Game, seat: number, log: [PendingChoice, string][]) {
  const ai = new AIController(g, seat, { seed: 1 });
  return (c: PendingChoice) => {
    const a = ai.decide(c);
    log.push([c, a]);
    return a;
  };
}

const answerOf = (log: [PendingChoice, string][], kind: PendingChoice['kind']) => log.find(([c]) => c.kind === kind)?.[1];

describe('AI decisions', () => {
  it('closes at the altar as soon as the bar is full', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.pos = 'ALTAR';
    p.cult = g.data.config.realms[0].bar;
    const log: [PendingChoice, string][] = [];
    g.runFlow(g.testActionPhase(0), aiAnswers(g, 0, log));
    expect(log[0][1]).toBe('closure');
  });

  it('stakes every pill it needs for near certainty on the last breakthrough', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.realm = winRealm(g.data) - 1;
    p.cult = g.data.config.realms[p.realm].bar;
    p.pos = 'ALTAR';
    p.pills = 3;
    const log: [PendingChoice, string][] = [];
    g.runFlow(g.testClosure(0), aiAnswers(g, 0, log));
    expect(answerOf(log, 'stake')).toBe('s3');
  });

  it('keeps pills on an early breakthrough that is already likely', () => {
    const g = ringGame();
    const p = g.state.players[0];
    p.cult = g.data.config.realms[0].bar;
    p.pos = 'ALTAR';
    p.pills = 3;
    p.mind = 3;
    const log: [PendingChoice, string][] = [];
    g.runFlow(g.testClosure(0), aiAnswers(g, 0, log));
    expect(answerOf(log, 'stake')).toBe('s0');
  });

  it('always answers 夺灵符 with 金光符', () => {
    const g = ringGame();
    g.state.round = 1;
    const [d, b] = [g.state.players[3], g.state.players[1]];
    d.hand = ['drain'];
    b.hand = ['goldlight'];
    b.pills = 1;
    const log: [PendingChoice, string][] = [];
    const ai = aiAnswers(g, 1, log);
    g.runFlow(g.testActionPhase(3), (c) => (c.player === 1 ? ai(c) : c.kind === 'action' ? (c.options.some((o) => o.id === 'cast:drain') ? 'cast:drain' : 'end') : 'p1'));
    expect(answerOf(log, 'guardReact')).toBe('goldlight');
    expect(b.pills).toBe(1);
  });

  it('challenges a glowing player standing on its landing tile', () => {
    const g = ringGame();
    g.state.round = 1;
    const [c, b] = [g.state.players[2], g.state.players[1]];
    g.state.players.forEach((p, i) => { p.pos = ['R20', 'R5', 'R1', 'R28'][i]; });
    b.pills = 3;
    const log: [PendingChoice, string][] = [];
    g.runFlow(g.testMove(2, 4), aiAnswers(g, 2, log));
    expect(c.pos).toBe('R5');
    expect(answerOf(log, 'duel')).toBe('p1');
  });

  it('a bar one point short and far from the altar takes 白泽指路', () => {
    const g = ringGame();
    const st = g.state;
    st.round = g.data.config.manifest.round;
    st.players.forEach((p) => { p.pos = 'R16'; });
    const me = st.players[3];
    me.cult = g.data.config.realms[0].bar - 1;
    st.players[0].realm = 1;
    st.players[1].realm = 1;
    st.players[2].realm = 1;
    const log: [PendingChoice, string][] = [];
    const ai = aiAnswers(g, 3, log);
    g.runFlow(g.testRoundStart(), (c) => (c.player === 3 ? ai(c) : c.options[0].id));
    expect(answerOf(log, 'manifestPick')).toBe('guide');
    expect(me.pos).toBe('ALTAR');
  });
});

describe('AI difficulty', () => {
  it('hard and normal beat easy at a mixed table', () => {
    const r = matchup('difficulty', 200, 3);
    expect(r.hard).toBeGreaterThan(r.easy);
    expect(r.normal).toBeGreaterThan(r.easy);
  });
});
