// The world under the tiles: region ground painted procedurally from node positions, scenery props in
// empty cells, and the roads (with direction chevrons on one-way edges) between each node and its `next`.
// Everything is a pure function of board.json, so the same board always looks the same.
import Phaser from 'phaser';
import type { BoardData, RegionId } from '../core/types';
import { addImg } from './assets';
import { CELL, INSET, type Rect } from './layout';
import { rectCentre, type Point, type WorldMap } from './world';

/** World px per ground texel; the texture is drawn small and scaled up with nearest filtering. */
const TEXEL = 2;
/** Region membership is decided per block of BLOCK×BLOCK texels. */
const BLOCK = 4;
const OUTLINE = [0x0f, 0x0e, 0x1a];
const ROAD_EDGE = 0x3a2c22;
const ROAD_FILL = 0xc9b58a;

type Ground = RegionId | 'none';

/** Colours sampled from the hand-painted centre art (centre_bg), so painted ground matches it. */
const PALETTE: Record<Ground, { base: string; dark: string; fleck: string; hatch: boolean }> = {
  wood: { base: '#6dbe52', dark: '#3f8f4a', fleck: '#b8e07a', hatch: false },
  fire: { base: '#5e3a42', dark: '#3a2228', fleck: '#e0663a', hatch: true },
  water: { base: '#d6f2fb', dark: '#8fcdeb', fleck: '#ffffff', hatch: false },
  earth: { base: '#4a3e5c', dark: '#3e3450', fleck: '#3fa8a0', hatch: true },
  none: { base: '#2e2b4a', dark: '#23213a', fleck: '#3c3860', hatch: false },
};

export const DEPTH = { ground: -30, roads: -20, arrows: 1.5 };

function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Which region's ground lies under each block: the nearest node that has a region, with a ragged border. */
function regionField(world: WorldMap, data: BoardData, cols: number, rows: number): Ground[] {
  const seeds = data.nodes.filter((n) => n.region).map((n) => ({ region: n.region!, ...world.centre(n.id) }));
  const field: Ground[] = new Array(cols * rows);
  const b = world.bounds;
  const size = TEXEL * BLOCK;
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x = b.x + (bx + 0.5) * size;
      const y = b.y + (by + 0.5) * size;
      let best: Ground = 'none';
      let bestD = Infinity;
      seeds.forEach((s, i) => {
        const d = Math.hypot(s.x - x, s.y - y) + (hash(bx >> 1, by >> 1, i) - 0.5) * CELL * 0.35;
        if (d < bestD) { bestD = d; best = s.region; }
      });
      field[by * cols + bx] = best;
    }
  }
  return field;
}

function paintGround(scene: Phaser.Scene, world: WorldMap, data: BoardData): { key: string; field: (p: Point) => Ground } {
  const b = world.bounds;
  const tw = Math.ceil(b.w / TEXEL);
  const th = Math.ceil(b.h / TEXEL);
  const cols = Math.ceil(tw / BLOCK);
  const rows = Math.ceil(th / BLOCK);
  const field = regionField(world, data, cols, rows);
  const at = (tx: number, ty: number): Ground => field[Math.min(rows - 1, Math.floor(ty / BLOCK)) * cols + Math.min(cols - 1, Math.floor(tx / BLOCK))];
  const colours = Object.fromEntries(Object.entries(PALETTE).map(([k, p]) => [k, { base: rgb(p.base), dark: rgb(p.dark), fleck: rgb(p.fleck), hatch: p.hatch }]));

  const key = 'world_ground';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, tw, th)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(tw, th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const g = at(tx, ty);
      const c = colours[g];
      const border = (tx + 1 < tw && at(tx + 1, ty) !== g) || (ty + 1 < th && at(tx, ty + 1) !== g);
      const n = hash(tx >> 1, ty >> 1, 99);
      const px = border ? OUTLINE
        : c.hatch && (tx + ty) % 8 < 2 ? c.dark
          : n < 0.07 ? c.dark
            : n > 0.975 ? c.fleck
              : c.base;
      const o = (ty * tw + tx) * 4;
      img.data[o] = px[0];
      img.data[o + 1] = px[1];
      img.data[o + 2] = px[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return { key, field: (p) => at(Math.floor((p.x - b.x) / TEXEL), Math.floor((p.y - b.y) / TEXEL)) };
}

/** Distance from a rect's centre to its edge along unit direction (ux, uy). */
function exitDistance(r: Rect, ux: number, uy: number): number {
  const hx = Math.abs(ux) > 1e-6 ? r.w / 2 / Math.abs(ux) : Infinity;
  const hy = Math.abs(uy) > 1e-6 ? r.h / 2 / Math.abs(uy) : Infinity;
  return Math.min(hx, hy);
}

/** A node's drawn tile: its footprint minus the INSET gap the roads show through. */
export function tileRect(world: WorldMap, id: string): Rect {
  const r = world.cellRect(id);
  return { x: r.x + INSET, y: r.y + INSET, w: r.w - 2 * INSET, h: r.h - 2 * INSET };
}

function drawRoads(scene: Phaser.Scene, world: WorldMap): void {
  const roads = scene.add.graphics().setDepth(DEPTH.roads);
  const arrows = scene.add.graphics().setDepth(DEPTH.arrows);
  for (const [width, colour] of [[18, ROAD_EDGE], [12, ROAD_FILL]] as const) {
    roads.lineStyle(width, colour, 1);
    for (const e of world.edges) {
      const a = world.centre(e.from);
      const c = world.centre(e.to);
      roads.lineBetween(a.x, a.y, c.x, c.y);
    }
  }
  for (const e of world.edges) {
    if (e.twoWay) continue;
    const a = world.centre(e.from);
    const c = world.centre(e.to);
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len === 0) continue;
    const ux = (c.x - a.x) / len;
    const uy = (c.y - a.y) / len;
    const t0 = exitDistance(tileRect(world, e.from), ux, uy);
    const t1 = len - exitDistance(tileRect(world, e.to), ux, uy);
    const m = { x: a.x + ux * (t0 + t1) / 2, y: a.y + uy * (t0 + t1) / 2 };
    const pts = [
      { x: m.x + ux * 5, y: m.y + uy * 5 },
      { x: m.x - ux * 4 - uy * 6, y: m.y - uy * 4 + ux * 6 },
      { x: m.x - ux * 4 + uy * 6, y: m.y - uy * 4 - ux * 6 },
    ];
    arrows.fillStyle(0xf4e9d0, 1).fillTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    arrows.lineStyle(1.5, 0x0f0e1a, 1).strokeTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
  }
}

/** Scenery: one in three empty cells gets its region's prop, placed by a hash of the cell. */
function scatterProps(scene: Phaser.Scene, world: WorldMap, field: (p: Point) => Ground): void {
  const b = world.bounds;
  for (let r = Math.floor(b.y / CELL); r < (b.y + b.h) / CELL; r++) {
    for (let c = Math.floor(b.x / CELL); c < (b.x + b.w) / CELL; c++) {
      const centre = rectCentre({ x: c * CELL, y: r * CELL, w: CELL, h: CELL });
      if (world.nodeAt(centre) || hash(c, r, 3) > 0.34) continue;
      const g = field(centre);
      if (g === 'none') continue;
      const x = c * CELL + 18 + hash(c, r, 4) * (CELL - 36);
      const y = r * CELL + 36 + hash(c, r, 5) * (CELL - 44);
      addImg(scene, x, y, `decor_${g}`).setOrigin(0.5, 1).setDepth(y);
    }
  }
}

/** Ground, world frame, roads and scenery for a board. */
export function drawWorld(scene: Phaser.Scene, world: WorldMap, data: BoardData): void {
  const b = world.bounds;
  const ground = paintGround(scene, world, data);
  scene.add.image(b.x, b.y, ground.key).setOrigin(0, 0).setScale(TEXEL).setDepth(DEPTH.ground);
  scene.add.rectangle(b.x, b.y, b.w, b.h).setOrigin(0, 0).setStrokeStyle(4, 0x0f0e1a).setDepth(DEPTH.ground + 1);
  drawRoads(scene, world);
  scatterProps(scene, world, ground.field);
}
