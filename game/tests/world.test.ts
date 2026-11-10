import { describe, expect, it } from 'vitest';
import { cloneData } from '../src/core/data';
import type { BoardData } from '../src/core/types';
import { BOARD_COL, SAFE } from '../src/ui/layout';
import {
  DEPTH, FACE, facingFor, keepInside, seam, TD, terrainRect, tokenSpots, toScreen, TW, viewRect, WorldMap, ZOOMS,
} from '../src/ui/world';
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

describe('front-tilt projection', () => {
  const w = new WorldMap(board);

  it('lays each cell top face out on an axis-aligned TW×TD grid', () => {
    expect(w.rect(nodeAtPos(0, 0))).toEqual({ x: 0, y: 0, w: TW, h: TD });
    expect(w.rect(nodeAtPos(3, 10))).toEqual({ x: 3 * 64, y: 10 * 48, w: 64, h: 48 });
    expect(w.rect('ALTAR')).toEqual({ x: 4 * TW, y: 4 * TD, w: 3 * TW, h: 3 * TD });
    expect(w.centre('ALTAR')).toEqual({ x: 5.5 * TW, y: 5.5 * TD });
  });

  it('draws rows further front later, and everything standing on a row between its block and the next', () => {
    for (let r = 0; r < 10; r++) {
      const feet = [r * TD + 1, r * TD + TD - 1];
      for (const y of feet) {
        expect(DEPTH.stand(y)).toBeGreaterThan(DEPTH.face(r));
        expect(DEPTH.token(y, 3)).toBeLessThan(DEPTH.block(r + 1));
      }
      expect(DEPTH.face(r)).toBeGreaterThan(DEPTH.block(r));
    }
  });

  it('fits the whole 11×11 board inside the board column at zoom 1', () => {
    const v = w.clamp({ cx: 0, cy: 0, zoom: 1 });
    const tl = toScreen(v, { x: w.bounds.x, y: w.bounds.y });
    const br = toScreen(v, { x: w.bounds.x + w.bounds.w, y: w.bounds.y + w.bounds.h });
    expect(tl.x).toBeGreaterThanOrEqual(BOARD_COL.x);
    expect(br.x).toBeLessThanOrEqual(BOARD_COL.x + BOARD_COL.w);
    expect(tl.y).toBeGreaterThanOrEqual(SAFE.y);
    expect(br.y).toBeLessThanOrEqual(SAFE.y + SAFE.h);
  });
});

describe('hit testing', () => {
  const w = new WorldMap(board);

  it('hits every node at its own top-face centre and nothing on an empty cell', () => {
    for (const n of board.nodes) expect(w.nodeAt(w.centre(n.id))).toBe(n.id);
    expect(w.nodeAt({ x: 3.5 * TW, y: 3.5 * TD })).toBeNull();
  });

  it('splits a shared edge exactly between the two cells', () => {
    const edge = 2 * TW;
    expect(w.nodeAt({ x: edge - 0.01, y: TD / 2 })).toBe(nodeAtPos(1, 0));
    expect(w.nodeAt({ x: edge, y: TD / 2 })).toBe(nodeAtPos(2, 0));
  });

  it('counts a front face that nothing hides, and hands a hidden one to the block in front', () => {
    const s1 = nodeAtPos(1, 0);
    expect(w.hitRect(s1)).toEqual({ ...w.rect(s1), h: TD + FACE });
    expect(w.nodeAt({ x: 1.5 * TW, y: TD + FACE - 1 })).toBe(s1);
    expect(w.nodeAt({ x: 1.5 * TW, y: TD + FACE })).toBeNull();
    const s2 = nodeAtPos(2, 0);
    expect(w.hitRect(s2)).toEqual(w.rect(s2));
    expect(w.nodeAt({ x: 2.5 * TW, y: TD + 2 })).toBe(nodeAtPos(2, 1));
  });

  it('agrees with the hit rects everywhere, which never overlap', () => {
    const ids = w.nodeIds();
    for (let y = -20; y < 11 * TD + 20; y += 7) {
      for (let x = -20; x < 11 * TW + 20; x += 7) {
        const owners = ids.filter((id) => {
          const r = w.hitRect(id);
          return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        });
        expect(owners.length).toBeLessThanOrEqual(1);
        expect(w.nodeAt({ x, y })).toBe(owners[0] ?? null);
      }
    }
  });
});

describe('WorldMap', () => {
  it('draws one road per connection and marks those written both ways', () => {
    const w = new WorldMap(bigBoard());
    const spur = w.edges.filter((e) => e.from === 'X' || e.to === 'X');
    expect(spur).toHaveLength(1);
    expect(spur[0].twoWay).toBe(true);
    expect(w.edges.filter((e) => !e.twoWay)).toHaveLength(80);
  });

  it('puts every one-way arrow on the edge its two ends share', () => {
    const w = new WorldMap(board);
    for (const e of w.edges.filter((x) => !x.twoWay)) {
      const p = seam(w.rect(e.from), w.rect(e.to));
      const onEdge = Number.isInteger(p.x / TW) || Number.isInteger(p.y / TD);
      expect(onEdge, `${e.from}>${e.to}`).toBe(true);
    }
  });
});

describe('tokens', () => {
  it('face the way each step goes and keep facing when they do not move', () => {
    const o = { x: 0, y: 0 };
    expect(facingFor(o, { x: 0, y: TD }, 'up')).toBe('down');
    expect(facingFor(o, { x: 0, y: -TD }, 'down')).toBe('up');
    expect(facingFor(o, { x: TW, y: 0 }, 'down')).toBe('right');
    expect(facingFor(o, { x: -TW, y: 0 }, 'down')).toBe('left');
    expect(facingFor(o, o, 'left')).toBe('left');
  });

  it('give every token on a shared cell its own spot in front of the landmark, inside the row', () => {
    for (let k = 1; k <= 4; k++) {
      const spots = tokenSpots(k);
      expect(new Set(spots.map((p) => p.x)).size).toBe(k);
      for (const p of spots) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(TW / 2 - 8);
        expect(p.y).toBeGreaterThan(10);
        expect(p.y).toBeLessThan(TD / 2);
      }
    }
    expect(tokenSpots(1)).toEqual([{ x: 0, y: 14 }]);
  });
});

describe('camera clamp', () => {
  const w = new WorldMap(board);
  const b = w.bounds;
  const far = 1e6;

  it('centres the whole board at zoom 1', () => {
    for (const cx of [-far, far]) {
      const v = w.clamp({ cx, cy: cx, zoom: 1 });
      expect(v.cx).toBe(b.x + b.w / 2);
      expect(v.cy).toBe(b.y + b.h / 2);
    }
  });

  it('pans both axes at zoom 2 until the board edge plus a margin meets SAFE', () => {
    const corner = w.clamp({ cx: -far, cy: -far, zoom: 2 });
    expect(toScreen(corner, { x: b.x, y: b.y })).toEqual({ x: SAFE.x + TW, y: SAFE.y + TW });
    const opposite = w.clamp({ cx: far, cy: far, zoom: 2 });
    expect(toScreen(opposite, { x: b.x + b.w, y: b.y + b.h })).toEqual({ x: SAFE.x + SAFE.w - TW, y: SAFE.y + SAFE.h - TW });
  });

  it('keeps every clamped view at both resting zooms inside the painted ground', () => {
    for (const map of [w, new WorldMap(bigBoard())]) {
      const ground = terrainRect(map.bounds);
      for (const zoom of ZOOMS) {
        for (const cx of [-far, far]) {
          for (const cy of [-far, far]) {
            const seen = viewRect(map.clamp({ cx, cy, zoom }));
            expect(seen.x).toBeGreaterThanOrEqual(ground.x);
            expect(seen.y).toBeGreaterThanOrEqual(ground.y);
            expect(seen.x + seen.w).toBeLessThanOrEqual(ground.x + ground.w);
            expect(seen.y + seen.h).toBeLessThanOrEqual(ground.y + ground.h);
          }
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
    expect(w.fitZoom({ x: 0, y: 0, w: SAFE.w / 2, h: TD }, 2)).toBe(1);
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
