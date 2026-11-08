import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/ui/layout';
import { overlap, placeTags, type TagSpot } from '../src/ui/pickLayout';
import { TD, TW } from '../src/ui/world';

const face = (c: number, r: number): Rect => ({ x: c * TW, y: r * TD, w: TW, h: TD });
const clear = (boxes: Rect[]): boolean => boxes.every((a, i) => boxes.every((b, j) => i === j || overlap(a, b) === 0));
const shrunk = (s: TagSpot, zoom: number): Rect => ({
  x: s.anchor.x + (s.box.x - s.anchor.x) / zoom, y: s.anchor.y + (s.box.y - s.anchor.y) / zoom, w: s.box.w / zoom, h: s.box.h / zoom,
});

describe('pick tag layout', () => {
  it('keeps a tag on its own cell while it fits there', () => {
    const [s] = placeTags([face(3, 2)], [{ w: 50, h: 30 }], []);
    expect(overlap(s.box, face(3, 2))).toBe(50 * 30);
  });

  it('staggers tags wider than a cell along a row so none covers another', () => {
    const faces = [0, 1, 2, 3].map((c) => face(c, 2));
    const spots = placeTags(faces, faces.map(() => ({ w: 90, h: 37 })), []);
    expect(clear(spots.map((s) => s.box))).toBe(true);
  });

  it('moves a tag off a token standing on its cell', () => {
    const token = { x: TW * 3 + 16, y: TD * 2 - 14, w: 32, h: 52 };
    const [s] = placeTags([face(3, 2)], [{ w: 60, h: 37 }], [token]);
    expect(overlap(s.box, token)).toBe(0);
  });

  it('stays clear at zoom 2 when clear at zoom 1: each tag shrinks inside its own box', () => {
    const faces = [face(0, 0), face(1, 0), face(1, 1), face(2, 1)];
    const spots = placeTags(faces, faces.map(() => ({ w: 88, h: 28 })), []);
    expect(clear(spots.map((s) => s.box))).toBe(true);
    for (const s of spots) {
      const half = shrunk(s, 2);
      expect(overlap(half, s.box)).toBe(half.w * half.h);
    }
  });
});
