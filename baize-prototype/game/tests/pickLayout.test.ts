import { describe, expect, it } from 'vitest';
import { H, LEFT, W, type Rect } from '../src/ui/layout';
import { boardFrame, overlap, placeTags, type BoardFrame } from '../src/ui/pickLayout';
import { TD, TW } from '../src/ui/world';

const face = (c: number, r: number): Rect => ({ x: c * TW, y: r * TD, w: TW, h: TD });
const clear = (boxes: Rect[]): boolean => boxes.every((a, i) => boxes.every((b, j) => i === j || overlap(a, b) === 0));
const OPEN: BoardFrame = { zoom: 1, visible: { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }, blocked: [] };
const inside = (a: Rect, b: Rect): boolean => overlap(a, b) === a.w * a.h;

describe('pick tag layout', () => {
  it('keeps a tag on its own cell while it fits there', () => {
    const [s] = placeTags([face(3, 2)], [[{ w: 50, h: 30 }]], [], OPEN);
    expect(overlap(s.box, face(3, 2))).toBe(50 * 30);
  });

  it('staggers tags wider than a cell along a row so none covers another', () => {
    const faces = [0, 1, 2, 3].map((c) => face(c, 2));
    const spots = placeTags(faces, faces.map(() => [{ w: 90, h: 37 }]), [], OPEN);
    expect(clear(spots.map((s) => s.box))).toBe(true);
  });

  it('moves a tag off a token standing on its cell', () => {
    const token = { x: TW * 3 + 16, y: TD * 2 - 14, w: 32, h: 52 };
    const [s] = placeTags([face(3, 2)], [[{ w: 60, h: 37 }]], [token], OPEN);
    expect(overlap(s.box, token)).toBe(0);
  });

  it('sizes tags for the zoom it solves at: screen size over zoom in world space', () => {
    const [s] = placeTags([face(3, 2)], [[{ w: 88, h: 28 }]], [], { ...OPEN, zoom: 2 });
    expect([s.box.w, s.box.h]).toEqual([44, 14]);
  });

  it('keeps a long tag on a cell by the left player cards out from under them, fully on the board', () => {
    const frame = boardFrame({ cx: W / 2, cy: H / 2, zoom: 1 });
    const cell = { x: LEFT.x + LEFT.w + 4, y: 200, w: TW, h: TD };
    const [s] = placeTags([cell], [[{ w: 210, h: 52 }, { w: 210, h: 37 }, { w: 190, h: 28 }]], [], frame);
    expect(frame.blocked.map((r) => overlap(s.box, r))).toEqual(frame.blocked.map(() => 0));
    expect(inside(s.box, frame.visible)).toBe(true);
    expect(s.variant).toBe(0);
  });

  it('drops cost lines before it would sit under a panel, and covers the least panel when nothing fits', () => {
    const frame: BoardFrame = { zoom: 1, visible: { x: 0, y: 0, w: 400, h: H }, blocked: [{ x: 0, y: 0, w: 100, h: H }] };
    const cell = { x: 150, y: 300, w: TW, h: TD };
    const [compact] = placeTags([cell], [[{ w: 280, h: 52 }, { w: 120, h: 28 }]], [], frame);
    expect(compact.variant).toBe(1);
    expect(overlap(compact.box, frame.blocked[0])).toBe(0);
    const [squeezed] = placeTags([cell], [[{ w: 380, h: 52 }, { w: 330, h: 28 }]], [], frame);
    expect(squeezed.variant).toBe(1);
    expect(inside(squeezed.box, frame.visible)).toBe(true);
  });
});
