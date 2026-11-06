import { describe, expect, it } from 'vitest';
import { cloneData } from '../src/core/data';
import type { BoardData } from '../src/core/types';
import { SAFE } from '../src/ui/layout';
import { keepInside, project, terrainRect, TH, toScreen, TW, unproject, viewRect, WorldMap, ZOOMS } from '../src/ui/world';
import { ringData } from './helpers';

/** The shipped 11×11 board, altar at cells (4,4)–(6,6). */
const board = cloneData().board;

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

const nodeAtPos = (c: number, r: number): string => board.nodes.find((n) => n.pos[0] === c && n.pos[1] === r && !n.rect)!.id;

describe('iso projection', () => {
  it('puts cell (0,0) on the origin and steps half a diamond per cell', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(project(1, 0)).toEqual({ x: TW / 2, y: TH / 2 });
    expect(project(0, 1)).toEqual({ x: -TW / 2, y: TH / 2 });
    expect(project(3, 7)).toEqual({ x: (3 - 7) * 48, y: (3 + 7) * 24 });
  });

  it('inverts exactly', () => {
    for (const [c, r] of [[0, 0], [10, 0], [4.25, 6.5], [-3, 12]]) expect(unproject(project(c, r))).toEqual({ c, r });
  });
});

describe('WorldMap', () => {
  it('centres each node on its cell and the altar on its 3×3 footprint', () => {
    const w = new WorldMap(board);
    const w2 = board.nodes.find((n) => n.id === 'W2')!;
    expect(w.centre('W2')).toEqual(project(w2.pos[0], w2.pos[1]));
    expect(w.rect('W2')).toEqual({ x: w.centre('W2').x - TW / 2, y: w.centre('W2').y - TH / 2, w: TW, h: TH });
    expect(w.centre('ALTAR')).toEqual(project(5, 5));
    expect(w.rect('ALTAR')).toEqual({ x: -1.5 * TW, y: project(5, 5).y - 1.5 * TH, w: 3 * TW, h: 3 * TH });
  });

  it('hits every node at its own diamond centre', () => {
    const w = new WorldMap(board);
    for (const n of board.nodes) expect(w.nodeAt(w.centre(n.id))).toBe(n.id);
  });

  it('hit-tests the diamond, not its bounding box', () => {
    const w = new WorldMap(board);
    const id = nodeAtPos(0, 5);
    const [top, right, bottom, left] = w.diamond(id);
    const inside = 2;
    expect(w.nodeAt({ x: top.x, y: top.y + inside })).toBe(id);
    expect(w.nodeAt({ x: right.x - inside * 2, y: right.y })).toBe(id);
    expect(w.nodeAt({ x: bottom.x, y: bottom.y - inside })).toBe(id);
    expect(w.nodeAt({ x: left.x + inside * 2, y: left.y })).toBe(id);
    const r = w.rect(id);
    expect(w.nodeAt({ x: r.x + 3, y: r.y + 3 })).not.toBe(id);
    expect(w.nodeAt({ x: r.x + r.w - 3, y: r.y + r.h - 3 })).not.toBe(id);
  });

  it('splits a shared edge between the two cells either side of it', () => {
    const w = new WorldMap(board);
    const a = w.centre(nodeAtPos(1, 0));
    const b = w.centre(nodeAtPos(2, 0));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const toward = (p: { x: number; y: number }, k: number) => ({ x: mid.x + (p.x - mid.x) * k, y: mid.y + (p.y - mid.y) * k });
    expect(w.nodeAt(toward(a, 0.05))).toBe(nodeAtPos(1, 0));
    expect(w.nodeAt(toward(b, 0.05))).toBe(nodeAtPos(2, 0));
  });

  it('gives the altar all nine cells of its footprint and nothing past its edge', () => {
    const w = new WorldMap(board);
    for (let c = 4; c <= 6; c++) for (let r = 4; r <= 6; r++) expect(w.nodeAt(project(c, r))).toBe('ALTAR');
    const [top, right, bottom, left] = w.diamond('ALTAR');
    expect([top, right, bottom, left].map((p) => ({ x: p.x - w.centre('ALTAR').x, y: p.y - w.centre('ALTAR').y })))
      .toEqual([{ x: 0, y: -1.5 * TH }, { x: 1.5 * TW, y: 0 }, { x: 0, y: 1.5 * TH }, { x: -1.5 * TW, y: 0 }]);
    expect(w.nodeAt({ x: top.x, y: top.y + 2 })).toBe('ALTAR');
    expect(w.nodeAt({ x: top.x, y: top.y - 2 })).not.toBe('ALTAR');
    expect(w.nodeAt(project(7, 5))).toBe('E18');
    expect(w.nodeAt(project(3, 3))).toBeNull();
  });

  it('draws one road per connection and marks those written both ways', () => {
    const w = new WorldMap(bigBoard());
    const spur = w.edges.filter((e) => e.from === 'X' || e.to === 'X');
    expect(spur).toHaveLength(1);
    expect(spur[0].twoWay).toBe(true);
    expect(w.edges.filter((e) => !e.twoWay)).toHaveLength(80);
  });
});

describe('camera clamp', () => {
  const w = new WorldMap(board);
  const b = w.bounds;
  const far = 1e6;

  it('centres the board vertically at zoom 1 and pans its wide axis to the SAFE edge', () => {
    const left = w.clamp({ cx: -far, cy: -far, zoom: 1 });
    expect(toScreen(left, { x: b.x, y: b.y + b.h / 2 }).y).toBeCloseTo(SAFE.y + SAFE.h / 2);
    expect(toScreen(left, { x: b.x, y: 0 }).x).toBeCloseTo(SAFE.x + TW / 2);
    const right = w.clamp({ cx: far, cy: far, zoom: 1 });
    expect(toScreen(right, { x: b.x + b.w, y: 0 }).x).toBeCloseTo(SAFE.x + SAFE.w - TW / 2);
    expect(right.cy).toBe(left.cy);
  });

  it('pans both axes at zoom 2 until the board edge plus a margin meets SAFE', () => {
    const corner = w.clamp({ cx: -far, cy: -far, zoom: 2 });
    expect(toScreen(corner, { x: b.x, y: b.y })).toEqual({ x: SAFE.x + TW, y: SAFE.y + TW });
    const opposite = w.clamp({ cx: far, cy: far, zoom: 2 });
    expect(toScreen(opposite, { x: b.x + b.w, y: b.y + b.h })).toEqual({ x: SAFE.x + SAFE.w - TW, y: SAFE.y + SAFE.h - TW });
  });

  it('keeps every clamped view at both resting zooms inside the painted ground', () => {
    const ground = terrainRect(b);
    for (const zoom of ZOOMS) {
      for (const cx of [-far, far]) {
        for (const cy of [-far, far]) {
          const seen = viewRect(w.clamp({ cx, cy, zoom }));
          expect(seen.x).toBeGreaterThanOrEqual(ground.x);
          expect(seen.y).toBeGreaterThanOrEqual(ground.y);
          expect(seen.x + seen.w).toBeLessThanOrEqual(ground.x + ground.w);
          expect(seen.y + seen.h).toBeLessThanOrEqual(ground.y + ground.h);
        }
      }
    }
  });

  it('never lets a view leave the resting zoom range', () => {
    expect(w.clamp({ cx: 0, cy: 0, zoom: 0.3 }).zoom).toBe(1);
    expect(w.clamp({ cx: 0, cy: 0, zoom: 5 }).zoom).toBe(2);
  });

  it('frames a target rect at the largest resting zoom that fits the HUD-free area', () => {
    const ring = new WorldMap(ringData().board);
    expect(ring.fitZoom(ring.rect('ALTAR'), 2)).toBe(2);
    expect(ring.fitZoom(ring.rect('ALTAR'), 1)).toBe(1);
    expect(w.fitZoom({ x: 0, y: 0, w: SAFE.w / 2, h: TH }, 2)).toBe(1);
    expect(w.fitZoom(b, 2)).toBeNull();
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
