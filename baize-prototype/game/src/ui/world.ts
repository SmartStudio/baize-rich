// Board geometry on a 2:1 isometric grid and camera math, kept free of Phaser so it can be unit-tested.
//
// Grid cell (c,r) of board.json is a diamond TW wide and TH tall; its centre projects to world
// ((c−r)·TW/2, (c+r)·TH/2), so cell (0,0) is centred on the world origin. A node's footprint is its
// `pos` cell, or the cells of its `rect` [c0,r0,c1,r1] (inclusive) when it has one.
// A view is the world point at the screen centre plus a zoom; screen = (world − centre)·zoom + screen centre.
import type { BoardData, NodeId } from '../core/types';
import { H, SAFE, W, type Rect } from './layout';

export interface Point {
  x: number;
  y: number;
}

export interface View {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  /** Both directions are written in `next`, so the road carries no arrow. */
  twoWay: boolean;
}

/** Inclusive cell range a node covers. */
export interface Footprint {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** Diamond width and height of one grid cell, in world px. */
export const TW = 96;
export const TH = 48;
/** The camera rests only at these zooms, so every art pixel covers a whole number of screen pixels. */
export const ZOOMS = [1, 2] as const;
export type Zoom = (typeof ZOOMS)[number];
/** Margin kept around a framed rect inside the SAFE area, in screen px. */
const FRAME_MARGIN = 40;
/** Landmarks and buildings rise up to this far above the back row's top faces. */
const HEADROOM = 2 * TH;
/** How far past the board the camera may pan, in world px. */
const PAD = TW / 2;
/** Ground painted past the board's bounding rect, in world px. Four cells each way contain every clamped view. */
export const TERRAIN_MARGIN = { x: 4 * TW, y: 4 * TH };

/**
 * Draw order. `y` is the centre y of the cell a thing belongs to: rows further front (larger c+r) have larger y,
 * and everything a cell owns stays inside (y, y + TH/2), below the blocks of the row in front.
 */
export const DEPTH = {
  ground: -1e5,
  /** Same-row blocks never overlap; c breaks the tie so the order is total. */
  block: (c: number, r: number): number => project(c, r).y + c * 1e-3,
  /** Overlays painted on a top face: ownership rims, marks, chevrons. */
  face: (y: number): number => y + 0.5,
  /** Landmarks, buildings and ground props. */
  stand: (y: number): number => y + 1,
  /** A token sorts by its feet, a quarter cell forward so it stays above whatever stands on its own cell. */
  token: (footY: number, seat: number): number => footY + TH / 4 + seat * 0.01,
  /** Labels and markers above the whole board. */
  top: 1e5,
};

/** World position of a grid point; integer (c,r) is a cell centre, half-integers are its corners. */
export function project(c: number, r: number): Point {
  return { x: ((c - r) * TW) / 2, y: ((c + r) * TH) / 2 };
}

/** Inverse of `project`: the fractional grid point under world point p. */
export function unproject(p: Point): { c: number; r: number } {
  const u = p.x / (TW / 2);
  const v = p.y / (TH / 2);
  return { c: (v + u) / 2, r: (v - u) / 2 };
}

/** The grid cell whose diamond holds world point p. */
export function cellAt(p: Point): { c: number; r: number } {
  const g = unproject(p);
  return { c: Math.floor(g.c + 0.5), r: Math.floor(g.r + 0.5) };
}

/** A footprint's diamond corners in world px: top, right, bottom, left. */
export function diamondOf(f: Footprint): [Point, Point, Point, Point] {
  return [project(f.c0 - 0.5, f.r0 - 0.5), project(f.c1 + 0.5, f.r0 - 0.5), project(f.c1 + 0.5, f.r1 + 0.5), project(f.c0 - 0.5, f.r1 + 0.5)];
}

/** Screen-aligned bounding rect of a footprint's diamond. */
export function footprintRect(f: Footprint): Rect {
  const [top, right, bottom, left] = diamondOf(f);
  return { x: left.x, y: top.y, w: right.x - left.x, h: bottom.y - top.y };
}

export function unionRect(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: x1 - x, h: y1 - y };
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Board bounds plus TERRAIN_MARGIN on every side. The ground texture covers this rect. */
export function terrainRect(bounds: Rect): Rect {
  const m = TERRAIN_MARGIN;
  return { x: bounds.x - m.x, y: bounds.y - m.y, w: bounds.w + 2 * m.x, h: bounds.h + 2 * m.y };
}

const cellKey = (c: number, r: number): string => `${c},${r}`;

/** Where every node sits on the grid and in world px, the drawable world bounds and the road edges between nodes. */
export class WorldMap {
  /** Bounding rect of the grid's diamond (and any node footprint past it), plus HEADROOM above. */
  readonly bounds: Rect;
  readonly edges: Edge[] = [];
  private readonly feet = new Map<NodeId, Footprint>();
  private readonly byCell = new Map<string, NodeId>();

  constructor(data: BoardData) {
    for (const n of data.nodes) {
      const [c0, r0, c1, r1] = n.rect ?? [n.pos[0], n.pos[1], n.pos[0], n.pos[1]];
      this.feet.set(n.id, { c0, r0, c1, r1 });
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) this.byCell.set(cellKey(c, r), n.id);
    }
    const grid = { c0: 0, r0: 0, c1: data.grid.cols - 1, r1: data.grid.rows - 1 };
    const faces = unionRect([grid, ...this.feet.values()].map(footprintRect));
    this.bounds = { ...faces, y: faces.y - HEADROOM, h: faces.h + HEADROOM };
    const next = new Map(data.nodes.map((n) => [n.id, n.next]));
    const seen = new Set<string>();
    for (const n of data.nodes) {
      for (const to of n.next) {
        const twoWay = next.get(to)?.includes(n.id) ?? false;
        const key = twoWay ? [n.id, to].sort().join('|') : `${n.id}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push({ from: n.id, to, twoWay });
      }
    }
  }

  footprint(id: NodeId): Footprint {
    const f = this.feet.get(id);
    if (!f) throw new Error(`unknown node ${id}`);
    return { ...f };
  }

  /** The diamond centre of the node's footprint, in world px. */
  centre(id: NodeId): Point {
    const f = this.footprint(id);
    return project((f.c0 + f.c1) / 2, (f.r0 + f.r1) / 2);
  }

  /** The node's top-face diamond corners: top, right, bottom, left. */
  diamond(id: NodeId): [Point, Point, Point, Point] {
    return diamondOf(this.footprint(id));
  }

  /** Screen-aligned box around the node's top-face diamond, for camera framing and popover anchors. */
  rect(id: NodeId): Rect {
    return footprintRect(this.footprint(id));
  }

  nodeIds(): NodeId[] {
    return [...this.feet.keys()];
  }

  nodeAtCell(c: number, r: number): NodeId | null {
    return this.byCell.get(cellKey(c, r)) ?? null;
  }

  /** The node whose top-face diamond holds world point p, if any. */
  nodeAt(p: Point): NodeId | null {
    const { c, r } = cellAt(p);
    return this.nodeAtCell(c, r);
  }

  /**
   * Clamp a view to the world. An axis fits when the board is no larger than the HUD-free SAFE span.
   * A fitting axis is centred there. SAFE shares the screen midpoint, so the board midpoint lands on it.
   * A longer axis pans until the board edge plus PAD meets the SAFE edge.
   */
  clamp(v: View): View {
    const zoom = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], v.zoom));
    const b = this.bounds;
    const axis = (c: number, lo: number, size: number, safe: number): number => {
      if (size * zoom <= safe) return lo + size / 2;
      const half = safe / 2 / zoom;
      return Math.min(lo + size + PAD - half, Math.max(lo - PAD + half, c));
    };
    return { cx: axis(v.cx, b.x, b.w, SAFE.w), cy: axis(v.cy, b.y, b.h, SAFE.h), zoom };
  }

  /** The largest resting zoom (≤ cap) at which world rect r fits inside the SAFE area, or null if none does. */
  fitZoom(r: Rect, cap: Zoom): Zoom | null {
    const fits = (z: Zoom): boolean => z <= cap && r.w * z <= SAFE.w - FRAME_MARGIN && r.h * z <= SAFE.h - FRAME_MARGIN;
    return [...ZOOMS].reverse().find(fits) ?? null;
  }
}

export function toScreen(v: View, p: Point): Point {
  return { x: (p.x - v.cx) * v.zoom + W / 2, y: (p.y - v.cy) * v.zoom + H / 2 };
}

export function toWorld(v: View, p: Point): Point {
  return { x: (p.x - W / 2) / v.zoom + v.cx, y: (p.y - H / 2) / v.zoom + v.cy };
}

export function rectToScreen(v: View, r: Rect): Rect {
  const p = toScreen(v, r);
  return { x: p.x, y: p.y, w: r.w * v.zoom, h: r.h * v.zoom };
}

/** The world rect the whole screen shows at this view. */
export function viewRect(v: View): Rect {
  const p = toWorld(v, { x: 0, y: 0 });
  return { x: p.x, y: p.y, w: W / v.zoom, h: H / v.zoom };
}

/** Shift the view as little as possible so world point p lands inside screen rect `box`. */
export function keepInside(v: View, p: Point, box: Rect): View {
  const s = toScreen(v, p);
  const dx = s.x < box.x ? s.x - box.x : s.x > box.x + box.w ? s.x - (box.x + box.w) : 0;
  const dy = s.y < box.y ? s.y - box.y : s.y > box.y + box.h ? s.y - (box.y + box.h) : 0;
  return { cx: v.cx + dx / v.zoom, cy: v.cy + dy / v.zoom, zoom: v.zoom };
}
