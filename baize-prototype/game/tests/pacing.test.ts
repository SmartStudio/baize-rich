import { describe, expect, it } from 'vitest';
import { Game, type Flow } from '../src/core/engine';
import type { GameEventType } from '../src/core/events';
import { breakthroughBeats, nextSpeed, PACE, SPEEDS, speedNote, tempoOf, type Tempo } from '../src/ui/pacing';
import { ringData, script } from './helpers';

const HUMAN = new Set([0]);

function table(): Game {
  const g = new Game({
    seed: 1,
    players: [{ name: 'A', hero: 'body' }, { name: 'B', hero: 'magic' }, { name: 'C', hero: 'sword' }, { name: 'D', hero: 'alch' }],
  }, ringData(), { snapshots: true });
  ['R20', 'R24', 'R28', 'R16'].forEach((n, i) => Object.assign(g.state.players[i], { pos: n, hand: [] }));
  return g;
}

/** Plays `flow` as seat `turn`'s turn and returns each event with the tempo it would play at. */
function played(g: Game, turn: number, flow: Flow<unknown>, answers: Parameters<typeof script>[0] = {}): [GameEventType, Tempo][] {
  g.state.current = turn;
  const from = g.log.length;
  let prev = structuredClone(g.state);
  g.runFlow(flow, script(answers));
  return g.log.slice(from).map((e) => {
    const t = tempoOf(e, prev, HUMAN);
    prev = e.snap!;
    return [e.type, t];
  });
}

describe('AI turns skim unless the beat touches the human', () => {
  it('rent paid to the human is watched; rent between AIs is skimmed', () => {
    const g = table();
    g.state.tiles.R5 = { owner: 0, level: 0 };
    g.state.tiles.R7 = { owner: 2, level: 0 };
    expect(played(g, 1, g.testPayRent(1, 'R5'))).toContainEqual(['rent', 'watch']);
    expect(played(g, 1, g.testPayRent(1, 'R7'))).toContainEqual(['rent', 'skim']);
  });

  it('a duel with the human in it is watched; one between AIs is skimmed', () => {
    const g = table();
    expect(played(g, 1, g.testDuel(1, 0))).toContainEqual(['duel', 'watch']);
    expect(played(g, 1, g.testDuel(1, 2))).toContainEqual(['duel', 'skim']);
  });

  it('夺灵符 taking the human\'s pills is watched', () => {
    const g = table();
    g.state.players[0].pills = 2;
    g.state.players[1].hand = ['drain'];
    const beats = played(g, 1, g.testActionPhase(1), { action: ['cast:drain', 'end'], target: 'p0' });
    expect(beats).toContainEqual(['pills', 'watch']);
  });

  it('an AI walking and buying on its own is skimmed', () => {
    const g = table();
    const beats = played(g, 1, g.testMove(1, 3), { buy: 'yes' });
    expect(beats.map(([t]) => t)).toEqual(expect.arrayContaining(['step', 'buy']));
    expect(beats.every(([, t]) => t === 'skim')).toBe(true);
  });

  it('白泽现世 and everything on the human\'s own turn are watched', () => {
    const g = table();
    g.state.round = g.data.config.manifest.round;
    g.state.current = 1;
    expect(played(g, 1, g.testRoundStart())).toContainEqual(['manifest', 'watch']);
    expect(played(g, 0, g.testMove(0, 3), { buy: 'no' }).every(([, t]) => t === 'watch')).toBe(true);
  });
});

describe('beat lengths', () => {
  const total = (o: object) => Object.values(o).reduce((a: number, v: number) => a + v, 0);

  it('skims every beat faster than it watches', () => {
    for (const k of Object.keys(PACE.watch) as (keyof typeof PACE.watch)[]) expect(PACE.skim[k]).toBeLessThan(PACE.watch[k]);
  });

  it('plays an AI 闭关 cutscene shorter than the human\'s, both scaled by 倍速', () => {
    expect(total(breakthroughBeats(false, 1))).toBeLessThan(total(breakthroughBeats(true, 1)));
    expect(total(breakthroughBeats(true, 2))).toBe(total(breakthroughBeats(true, 1)) / 2);
  });

  it('cycles 倍速 through every setting, each saying what it does', () => {
    let s = 1;
    const seen = new Set<number>();
    for (let i = 0; i < SPEEDS.length; i++) {
      seen.add(s);
      s = nextSpeed(s);
    }
    expect([...seen].sort()).toEqual(SPEEDS.map((x) => x.speed).sort());
    expect(new Set(SPEEDS.map((x) => speedNote(x.speed))).size).toBe(SPEEDS.length);
  });
});
