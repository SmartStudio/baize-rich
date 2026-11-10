// The world under the path: a flat plane FACE px below the path's top faces, one region per grid cell (the
// nearest regional node, ragged by a hash), a few steps darker than the path with only light, sparse texture,
// a soft contact shadow under every block's front face, and scenery props on empty cells. Everything is a pure
// function of board.json, so the same board always looks the same.
import Phaser from 'phaser';
import type { BoardData, RegionId } from '../core/types';
import { addImg } from './assets';
import type { Rect } from './layout';
import { DEPTH, FACE, TD, terrainRect, TW, type WorldMap } from './world';

/** Rows of contact shadow on the ground under a block's front face. */
const SHADOW_ROWS = 5;
/** How far a cell's region seed may wander, in cells; borders follow the cell seams but stay ragged. */
const JITTER = 1.4;

type Rgb = [number, number, number];
interface Shade { base: Rgb; alt: Rgb; border: Rgb; fleck: Rgb; shadow: Rgb }

const rgb = (hex: string): Rgb => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const shade = (base: string, alt: string, border: string, fleck: string): Shade => {
  const b = rgb(base);
  return { base: b, alt: rgb(alt), border: rgb(border), fleck: rgb(fleck), shadow: b.map((v) => Math.round(v * 0.62)) as Rgb };
};

/** Each region's ground, a few steps darker than its path blocks so the path reads on top of it. */
const PALETTE: Record<RegionId, Shade> = {
  wood: shade('#2c4a2a', '#30502e', '#253f23', '#4a7338'),
  fire: shade('#40252a', '#462a2e', '#361e22', '#8e3c26'),
  water: shade('#45515e', '#4a5764', '#3c4651', '#94aebe'),
  earth: shade('#32294a', '#372e50', '#2a223f', '#5e4b86'),
};

function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Region of every grid cell: the nearest node that has one, measured in cells with a per-cell jitter. */
function regionOf(data: BoardData): (c: number, r: number) => RegionId {
  const seeds = data.nodes.filter((n) => n.region).map((n, i) => ({ region: n.region!, c: n.pos[0], r: n.pos[1], i }));
  const memo = new Map<number, RegionId>();
  return (c, r) => {
    const key = (c + 2048) * 4096 + (r + 2048);
    let g = memo.get(key);
    if (!g) {
      let best = Infinity;
      for (const s of seeds) {
        const d = Math.hypot(s.c - c, s.r - r) + (hash(c, r, s.i) - 0.5) * JITTER;
        if (d < best) { best = d; g = s.region; }
      }
      memo.set(key, g!);
    }
    return g!;
  };
}

/** The ground cell under world pixel (x, y): the plane is the grid shifted FACE px down. */
const groundCell = (x: number, y: number): [number, number] => [Math.floor(x / TW), Math.floor((y - FACE) / TD)];

/** One ground pixel: a region border, a block's contact shadow, or the region's calm texture. */
function groundPixel(world: WorldMap, region: (c: number, r: number) => RegionId, x: number, y: number): Rgb {
  const [c, r] = groundCell(x, y);
  const g = region(c, r);
  const s = PALETTE[g];
  const [rc, rr] = groundCell(x + 1, y);
  const [bc, br] = groundCell(x, y + 1);
  if (region(rc, rr) !== g || region(bc, br) !== g) return s.border;
  if (y - FACE - r * TD < SHADOW_ROWS && world.nodeAtCell(c, r - 1)) return s.shadow;
  if (hash(x >> 1, y >> 1, 99) > 0.993) return s.fleck;
  return hash(x >> 3, y >> 3, 7) < 0.35 && ((x ^ y) & 1) === 1 ? s.alt : s.base;
}

function paintPlane(scene: Phaser.Scene, world: WorldMap, area: Rect, region: (c: number, r: number) => RegionId): string {
  const key = 'world_ground';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, area.w, area.h)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(area.w, area.h);
  for (let ty = 0; ty < area.h; ty++) {
    for (let tx = 0; tx < area.w; tx++) {
      const px = groundPixel(world, region, area.x + tx, area.y + ty);
      const o = (ty * area.w + tx) * 4;
      img.data[o] = px[0];
      img.data[o + 1] = px[1];
      img.data[o + 2] = px[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

/**
 * Scenery: about one empty ground cell in four gets its region's prop. Cells just in front of a block stay bare,
 * so no prop covers a front face.
 */
function scatterProps(scene: Phaser.Scene, world: WorldMap, region: (c: number, r: number) => RegionId, area: Rect): void {
  const [c0, r0] = groundCell(area.x, area.y);
  const [c1, r1] = groundCell(area.x + area.w, area.y + area.h);
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      if (hash(c, r, 3) > 0.26) continue;
      if (world.nodeAtCell(c, r) || world.nodeAtCell(c, r - 1)) continue;
      const x = Math.round(c * TW + TW / 2 + (hash(c, r, 4) - 0.5) * 28);
      const y = Math.round(r * TD + FACE + TD / 2 + (hash(c, r, 5) - 0.5) * 10);
      if (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) continue;
      addImg(scene, x, y, `decor_${region(c, r)}`).setOrigin(0.5, 1).setDepth(DEPTH.stand(y));
    }
  }
}

/** The ground plane and its props. It runs past the board so the viewport never shows empty backdrop. */
export function drawGround(scene: Phaser.Scene, world: WorldMap, data: BoardData): void {
  const area = terrainRect(world.bounds);
  const region = regionOf(data);
  scene.add.image(area.x, area.y, paintPlane(scene, world, area, region)).setOrigin(0, 0).setDepth(DEPTH.ground);
  scatterProps(scene, world, region, area);
}
