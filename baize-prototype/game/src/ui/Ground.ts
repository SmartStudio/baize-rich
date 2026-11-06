// The world under the path: a flat iso plane DROP px below the raised path blocks, one region per grid cell
// (the nearest regional node, ragged by a hash), darker than the path with dithered noise and faint cell
// seams, and scenery props on empty cells. Everything is a pure function of board.json, so the same board
// always looks the same.
import Phaser from 'phaser';
import type { BoardData, RegionId } from '../core/types';
import { addImg } from './assets';
import type { Rect } from './layout';
import { cellAt, DEPTH, project, terrainRect, unproject, type Point, type WorldMap } from './world';

/** Height of the path blocks' walls: the plane lies this far below their top faces. */
const DROP = 24;
const OUTLINE: Rgb = [0x0f, 0x0e, 0x1a];
/** How far a cell's region seed may wander, in cells; borders follow the cell seams but stay ragged. */
const JITTER = 1.4;

type Rgb = [number, number, number];
interface Shade { base: Rgb; seam: Rgb; dark: Rgb; fleck: Rgb }

/** Each region's ground, a few steps darker than its path blocks so the path reads on top of it. */
const PALETTE: Record<RegionId, Shade> = {
  wood: { base: rgb('#2c4a2a'), seam: rgb('#243e23'), dark: rgb('#1f361f'), fleck: rgb('#4a7338') },
  fire: { base: rgb('#3e2124'), seam: rgb('#341b1e'), dark: rgb('#2b1518'), fleck: rgb('#8e3c26') },
  water: { base: rgb('#45515e'), seam: rgb('#3b4652'), dark: rgb('#333c47'), fleck: rgb('#94aebe') },
  earth: { base: rgb('#28213a'), seam: rgb('#211b31'), dark: rgb('#1b1629'), fleck: rgb('#463765') },
};

function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Region of every grid cell: the nearest node that has one, measured in cells with a per-cell jitter. */
function regionOf(data: BoardData): (c: number, r: number) => RegionId {
  const seeds = data.nodes.filter((n) => n.region).map((n, i) => ({ region: n.region!, c: n.pos[0], r: n.pos[1], i }));
  const memo = new Map<number, RegionId>();
  return (c, r) => {
    const key = c * 4096 + r;
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

/** The ground cell under world point p: the plane is the grid shifted DROP px down. */
const groundCell = (p: Point): { c: number; r: number } => cellAt({ x: p.x, y: p.y - DROP });

function paintPlane(scene: Phaser.Scene, area: Rect, region: (c: number, r: number) => RegionId): string {
  const w = Math.ceil(area.w);
  const h = Math.ceil(area.h);
  const key = 'world_ground';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const x0 = area.x;
  const y0 = area.y;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const wx = x0 + tx;
      const wy = y0 + ty;
      const cell = groundCell({ x: wx + 0.5, y: wy + 0.5 });
      const right = groundCell({ x: wx + 1.5, y: wy + 0.5 });
      const below = groundCell({ x: wx + 0.5, y: wy + 1.5 });
      const g = region(cell.c, cell.r);
      const shade = PALETTE[g];
      const seamTo = (o: { c: number; r: number }): boolean => o.c !== cell.c || o.r !== cell.r;
      const border = (seamTo(right) && region(right.c, right.r) !== g) || (seamTo(below) && region(below.c, below.r) !== g);
      const n = hash(wx >> 1, wy >> 1, 99);
      const dithered = hash(cell.c, cell.r, 7) < 0.4 && (wx & 1) === 0 && (wy & 1) === 0;
      const px = border ? OUTLINE
        : seamTo(right) || seamTo(below) ? shade.seam
          : n < 0.05 || dithered ? shade.dark
            : n > 0.985 ? shade.fleck
              : shade.base;
      const o = (ty * w + tx) * 4;
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
 * Scenery: about one empty cell in four gets its region's prop. Cells just in front of a path block stay bare,
 * so no prop stands over the path's top faces.
 */
function scatterProps(scene: Phaser.Scene, world: WorldMap, region: (c: number, r: number) => RegionId, area: Rect): void {
  const corners = [unproject({ x: area.x, y: area.y }), unproject({ x: area.x + area.w, y: area.y }),
    unproject({ x: area.x, y: area.y + area.h }), unproject({ x: area.x + area.w, y: area.y + area.h })];
  const span = (k: 'c' | 'r'): [number, number] => [Math.floor(Math.min(...corners.map((p) => p[k]))), Math.ceil(Math.max(...corners.map((p) => p[k])))];
  const [c0, c1] = span('c');
  const [r0, r1] = span('r');
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      if (hash(c, r, 3) > 0.26) continue;
      if (world.nodeAtCell(c, r) || world.nodeAtCell(c - 1, r) || world.nodeAtCell(c, r - 1)) continue;
      const centre = project(c, r);
      const x = Math.round(centre.x + (hash(c, r, 4) - 0.5) * 28);
      const y = Math.round(centre.y + DROP + (hash(c, r, 5) - 0.5) * 10);
      if (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) continue;
      addImg(scene, x, y, `decor_${region(c, r)}`).setOrigin(0.5, 1).setDepth(DEPTH.stand(centre.y));
    }
  }
}

/** The ground plane and its props. It runs past the board so the viewport never shows empty backdrop. */
export function drawGround(scene: Phaser.Scene, world: WorldMap, data: BoardData): void {
  const area = terrainRect(world.bounds);
  const region = regionOf(data);
  scene.add.image(area.x, area.y, paintPlane(scene, area, region)).setOrigin(0, 0).setDepth(DEPTH.ground);
  scatterProps(scene, world, region, area);
}
