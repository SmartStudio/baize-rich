import { describe, expect, it } from 'vitest';
import { AIController } from '../src/ai/ai';
import { cloneData, defaultData } from '../src/core/data';
import { parseRecord, replayRecord, toRecord, type GameRecord, type SeatControl } from '../src/core/record';
import { newGame, script } from './helpers';

const SEATS: SeatControl[] = [
  { human: true, difficulty: 'normal', personality: 'steady' },
  { human: false, difficulty: 'easy', personality: 'aggressive' },
  { human: false, difficulty: 'normal', personality: 'miser' },
  { human: false, difficulty: 'hard', personality: 'steady' },
];

function roundTrip(r: GameRecord): unknown {
  return JSON.parse(JSON.stringify(r));
}

describe('对局记录', () => {
  it('round-trips a game in progress through JSON to the same state and pending choice', () => {
    const g = newGame(7);
    const answer = script({ buy: 'yes', preRoll: 'roll', action: 'end' });
    g.start();
    for (let i = 0; i < 60 && !g.over; i++) g.answer(answer(g.pending!));
    const parsed = parseRecord(roundTrip(toRecord(g, SEATS)));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.record.finished).toBe(false);
    expect(parsed.record.seats).toEqual(SEATS);
    const r = replayRecord(parsed.record);
    expect(r.state).toEqual(g.state);
    expect(r.pending).toEqual(g.pending);
    expect(r.history).toEqual(g.history);
  });

  it('marks a finished AI game and replays it to the same winner', () => {
    const g = newGame(11);
    const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed: 11 }));
    g.start();
    while (!g.over) g.answer(ais[g.pending!.player].decide(g.pending!));
    const parsed = parseRecord(roundTrip(toRecord(g, SEATS)));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.record.finished).toBe(true);
    const r = replayRecord(parsed.record);
    expect(r.over).toBe(true);
    expect(r.state).toEqual(g.state);
  });

  it('rejects files that are not a record of this version and data', () => {
    const g = newGame(3);
    g.start();
    const good = roundTrip(toRecord(g, SEATS)) as Record<string, unknown>;
    expect(parseRecord(good).ok).toBe(true);
    const errorOf = (v: unknown, data = defaultData) => {
      const r = parseRecord(v, data);
      return r.ok ? null : r.error;
    };
    expect(errorOf(null)).toMatch('不是白泽秘境的对局记录');
    expect(errorOf({ ...good, format: 'other' })).toMatch('不是白泽秘境的对局记录');
    expect(errorOf({ ...good, version: 1 })).toMatch('不支持的记录版本 1');
    expect(errorOf({ ...good, dataVersion: '0.1' })).toMatch('数据版本不符');
    const newer = cloneData();
    newer.config.version = '9.9';
    expect(errorOf(good, newer)).toMatch('当前为 9.9');
    expect(errorOf({ ...good, seats: SEATS.slice(1) })).toMatch('席位数与玩家数不一致');
    expect(errorOf({ ...good, seats: [{ ...SEATS[0], difficulty: 'godlike' }, ...SEATS.slice(1)] })).toMatch('席位设置无效');
    expect(errorOf({ ...good, history: [1, 2] })).toMatch('回答历史无效');
  });

  it('reports a history that no longer replays in Chinese', () => {
    const g = newGame(5);
    g.start();
    const rec = { ...toRecord(g, SEATS), history: ['not-an-option'] };
    expect(() => replayRecord(rec)).toThrow('对局记录无法复现');
  });
});
