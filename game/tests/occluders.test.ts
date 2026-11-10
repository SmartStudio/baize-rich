import { describe, expect, it } from 'vitest';
import { covers, type Coverable, type Stand } from '../src/ui/Occluders';
import { DEPTH, TD, TW } from '../src/ui/world';

const token = (x: number, y: number): Coverable => ({ box: { x: x - 16, y: y - 52, w: 32, h: 52 }, depth: DEPTH.token(y, 0), setCovered: () => {} });
const landmark = (x: number, footY: number, w = 60, h = 64, visible = true): Stand =>
  ({ x, y: footY, displayWidth: w, displayHeight: h, originX: 0.5, originY: 1, depth: DEPTH.stand(footY), visible });

describe('a token behind tall art', () => {
  it('is covered by the landmark on the cell in front of it', () => {
    expect(covers(landmark(32, TD + 34), token(32, 38))).toBe(true);
  });

  it('is not covered by the landmark on its own cell, which it stands in front of', () => {
    expect(covers(landmark(32, 34), token(32, 38))).toBe(false);
  });

  it('is not covered by a hidden building', () => {
    expect(covers(landmark(32, TD + 34, 60, 64, false), token(32, 38))).toBe(false);
  });

  it('is not covered when art in front only grazes its side', () => {
    expect(covers(landmark(32 + TW, TD + 34), token(32 + 24, 38))).toBe(false);
  });
});
