import { describe, expect, it } from 'vitest';
import { cloneData, defaultData } from '../src/core/data';
import type { BoardData } from '../src/core/types';
import { checkBoard, mainLap, renderBoard } from '../src/sim/boardcheck';

const board = (): BoardData => cloneData().board;
// A road fork (not a 神道 or the altar): the cases below break one without naming ids from data/board.json.
const firstFork = (b: BoardData) => b.nodes.find((n) => n.next.length > 1 && !n.road && n.id !== 'ALTAR')!;
const problems = (b: BoardData) => checkBoard(b).join('\n');

describe('data/board.json', () => {
  it('passes the board checker', () => {
    expect(checkBoard(defaultData.board)).toEqual([]);
  });

  it('is a big map (76–88 nodes) with a 40–56 step main lap', () => {
    const n = defaultData.board.nodes.length;
    expect(n).toBeGreaterThanOrEqual(76);
    expect(n).toBeLessThanOrEqual(88);
    expect(mainLap(defaultData.board)).toBeGreaterThanOrEqual(40);
    expect(mainLap(defaultData.board)).toBeLessThanOrEqual(56);
    expect(renderBoard(defaultData.board)).toContain('ALTAR');
  });
});

describe('board checker catches', () => {
  it('an unknown next id', () => {
    const b = board();
    firstFork(b).next.push('NOPE');
    expect(problems(b)).toMatch(/unknown NOPE/);
  });

  it('a branch cut off from the start', () => {
    const b = board();
    const f = firstFork(b);
    const branch = f.next[1];
    f.next = [f.next[0]];
    expect(problems(b)).toMatch(new RegExp(`${branch} is not reachable`));
  });

  it('a second 妖兽谷', () => {
    const b = board();
    b.nodes.find((n) => n.type === 'land')!.type = 'beast';
    expect(problems(b)).toMatch(/expected 1 beast, found 2/);
  });

  it('overlapping cells and a land without a street', () => {
    const b = board();
    const lands = b.nodes.filter((n) => n.type === 'land');
    lands[1].pos = [...lands[2].pos];
    delete lands[3].street;
    expect(problems(b)).toMatch(/overlaps/);
    expect(problems(b)).toMatch(new RegExp(`land ${lands[3].id} has no valid street`));
  });

  it('a district without a market', () => {
    const b = board();
    const m = b.nodes.find((n) => n.type === 'market')!;
    m.type = 'secret';
    expect(problems(b)).toMatch(new RegExp(`${m.region}: no market`));
  });
});
