import { describe, expect, it } from 'vitest';
import type { BoardData } from '../src/core/types';
import { CELL, SAFE } from '../src/ui/layout';
import { keepInside, terrainRect, toScreen, viewRect, WorldMap, ZOOMS } from '../src/ui/world';
import { ringData } from './helpers';

/** The 9×9 ring fixture: small enough to fit the screen, altar at cells (3,3)–(5,5). */
const board = ringData().board;

/** The shipped board: 11×11, wider than the HUD-free area and narrower than the screen. */
function arena(): BoardData {
  return { ...board, grid: { cols: 11, rows: 11, tile: 64 }, nodes: [{ id: 'A', type: 'land', pos: [0, 0], next: [] }] };
}

/** A board twice as wide and tall as the screen: a 24×18 ring of one-way edges plus one two-way spur. */
function bigBoard(): BoardData {
  const ring: [number, number][] = [];
  for (let c = 0; c < 24; c++) ring.push([c, 0]);
  for (let r = 1; r < 18; r++) ring.push([23, r]);
  for (let c = 22; c >= 0; c--) ring.push([c, 17]);
  for (let r = 16; r >= 1; r--) ring.push([0, r]);
  const nodes = ring.map((pos, i) => ({ id: `R${i}`, type: 'land' as const, pos, next: [`R${(i + 1) % ring.length}`] }));
  nodes[0].next.push('X');
  return { ...board, grid: { cols: 24, rows: 18, tile: 64 }, nodes: [...nodes, { id: 'X', type: 'spring' as const, pos: [1, 1] as [number, number], next: ['R0'] }] };
}

describe('WorldMap', () => {
  it('gives the altar its whole rect and every other node its pos cell', () => {
    const w = new WorldMap(board);
    expect(w.cellRect('ALTAR')).toEqual({ x: 3 * CELL, y: 3 * CELL, w: 3 * CELL, h: 3 * CELL });
    const n = board.nodes.find((x) => x.id !== 'ALTAR')!;
    expect(w.cellRect(n.id)).toEqual({ x: n.pos[0] * CELL, y: n.pos[1] * CELL, w: CELL, h: CELL });
    expect(w.nodeAt({ x: 4.5 * CELL, y: 3.2 * CELL })).toBe('ALTAR');
    expect(w.bounds).toEqual({ x: 0, y: 0, w: 9 * CELL, h: 9 * CELL });
  });

  it('draws one road per connection and marks those written both ways', () => {
    const w = new WorldMap(bigBoard());
    const spur = w.edges.filter((e) => e.from === 'X' || e.to === 'X');
    expect(spur).toHaveLength(1);
    expect(spur[0].twoWay).toBe(true);
    expect(w.edges.filter((e) => !e.twoWay)).toHaveLength(80);
  });

  it('centres an axis that fits the HUD-free area and pans a longer one into it', () => {
    const w = new WorldMap(board);
    const v = w.clamp({ cx: -1e6, cy: 1e6, zoom: 1 });
    expect(toScreen(v, { x: w.bounds.w / 2, y: 0 }).x).toBeCloseTo(SAFE.x + SAFE.w / 2);
    const edge = toScreen(v, { x: 0, y: w.bounds.h }).y;
    expect(edge - CELL * v.zoom).toBeGreaterThanOrEqual(SAFE.y);
    expect(edge).toBeLessThanOrEqual(SAFE.y + SAFE.h);
  });

  it('pans an 11-wide board at zoom 1 so the outer column sits inside the HUD-free area', () => {
    const w = new WorldMap(arena());
    const midY = w.bounds.h / 2;
    const left = w.clamp({ cx: -1e6, cy: midY, zoom: 1 });
    const leftEdge = toScreen(left, { x: 0, y: 0 }).x;
    expect(leftEdge).toBeGreaterThanOrEqual(SAFE.x);
    expect(leftEdge + CELL * left.zoom).toBeLessThanOrEqual(SAFE.x + SAFE.w);

    const right = w.clamp({ cx: 1e6, cy: midY, zoom: 1 });
    const rightEdge = toScreen(right, { x: w.bounds.w, y: 0 }).x;
    expect(rightEdge - CELL * right.zoom).toBeGreaterThanOrEqual(SAFE.x);
    expect(rightEdge).toBeLessThanOrEqual(SAFE.x + SAFE.w);
  });

  it('centres the 11×11 board vertically on the HUD-free area at zoom 1', () => {
    const w = new WorldMap(arena());
    const z = 1;
    const centre = { x: w.bounds.w / 2, y: w.bounds.h / 2 };
    const framed = toScreen(w.clamp({ cx: centre.x, cy: centre.y, zoom: z }), centre);
    expect(framed.y).toBeCloseTo(SAFE.y + SAFE.h / 2);
  });

  it('keeps a clamped 11×11 view inside the painted ground', () => {
    const w = new WorldMap(arena());
    const ground = terrainRect(w.bounds);
    for (const zoom of ZOOMS) {
      for (const cx of [-1e9, 1e9]) {
        for (const cy of [-1e9, 1e9]) {
          const seen = viewRect(w.clamp({ cx, cy, zoom }));
          expect(seen.x).toBeGreaterThanOrEqual(ground.x);
          expect(seen.y).toBeGreaterThanOrEqual(ground.y);
          expect(seen.x + seen.w).toBeLessThanOrEqual(ground.x + ground.w);
          expect(seen.y + seen.h).toBeLessThanOrEqual(ground.y + ground.h);
        }
      }
    }
  });

  it('lets a big world pan only until its edge reaches the HUD-free area', () => {
    const w = new WorldMap(bigBoard());
    const v = w.clamp({ cx: -5000, cy: -5000, zoom: 1 });
    const corner = toScreen(v, { x: 0, y: 0 });
    expect(corner.x).toBeCloseTo(SAFE.x + CELL / 2);
    expect(corner.y).toBeCloseTo(SAFE.y + CELL / 2);
  });

  it('frames a target rect at the largest resting zoom that fits the HUD-free area', () => {
    const w = new WorldMap(bigBoard());
    expect(w.fitZoom({ x: 0, y: 0, w: CELL, h: CELL }, 2)).toBe(2);
    expect(w.fitZoom({ x: 0, y: 0, w: CELL, h: CELL }, 1)).toBe(1);
    expect(w.fitZoom({ x: 0, y: 0, w: SAFE.w / 2, h: CELL }, 2)).toBe(1);
    expect(w.fitZoom({ x: 0, y: 0, w: SAFE.w, h: CELL }, 2)).toBeNull();
  });
});

describe('keepInside', () => {
  it('moves the view only as far as needed to bring a point into the box', () => {
    const box = { x: 400, y: 200, w: 480, h: 320 };
    const v = keepInside({ cx: 0, cy: 0, zoom: 2 }, { x: 300, y: 0 }, box);
    expect(toScreen(v, { x: 300, y: 0 }).x).toBeCloseTo(box.x + box.w);
    expect(v.cy).toBe(0);
    const still = { cx: 0, cy: 0, zoom: 1 };
    expect(keepInside(still, { x: 0, y: 0 }, box)).toEqual(still);
  });
});
