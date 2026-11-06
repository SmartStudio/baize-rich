// World geometry and camera math for the board, kept free of Phaser so it can be unit-tested.
//
// World space: grid cell (col,row) of board.json spans [col*CELL, (col+1)*CELL) × [row*CELL, …).
// A node fills its `pos` cell, or the cells of its `rect` [c0,r0,c1,r1] (inclusive) when it has one.
// A view is the world point at the screen centre plus a zoom; screen = (world − centre)·zoom + screen centre.
import type { BoardData, NodeId } from '../core/types';
import { CELL, H, SAFE, W, type Rect } from './layout';

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

export const ZOOM_MAX = 2;
const ZOOM_FLOOR = 0.35;
/** How far past the grid the camera may pan, in world px. */
const PAD = CELL / 2;
/** Ground painted past the board, in world px. Five cells contain every clamped view of the 11×11 board. */
export const TERRAIN_MARGIN = 5 * CELL;

export function cellsRect(c0: number, r0: number, c1: number, r1: number): Rect {
  return { x: c0 * CELL, y: r0 * CELL, w: (c1 - c0 + 1) * CELL, h: (r1 - r0 + 1) * CELL };
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
  return {
    x: bounds.x - TERRAIN_MARGIN,
    y: bounds.y - TERRAIN_MARGIN,
    w: bounds.w + 2 * TERRAIN_MARGIN,
    h: bounds.h + 2 * TERRAIN_MARGIN,
  };
}

/** Where every node sits in world px, the drawable world bounds and the road edges between nodes. */
export class WorldMap {
  /** The grid (and any node footprint past it). */
  readonly bounds: Rect;
  readonly edges: Edge[] = [];
  private readonly rects = new Map<NodeId, Rect>();

  constructor(data: BoardData) {
    for (const n of data.nodes) {
      const [c0, r0, c1, r1] = n.rect ?? [n.pos[0], n.pos[1], n.pos[0], n.pos[1]];
      this.rects.set(n.id, cellsRect(c0, r0, c1, r1));
    }
    this.bounds = unionRect([{ x: 0, y: 0, w: data.grid.cols * CELL, h: data.grid.rows * CELL }, ...this.rects.values()]);
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

  /** The node's full footprint (one cell, or its `rect`). */
  cellRect(id: NodeId): Rect {
    const r = this.rects.get(id);
    if (!r) throw new Error(`unknown node ${id}`);
    return { ...r };
  }

  centre(id: NodeId): Point {
    return rectCentre(this.cellRect(id));
  }

  nodeIds(): NodeId[] {
    return [...this.rects.keys()];
  }

  /** The node whose footprint holds world point p, if any. */
  nodeAt(p: Point): NodeId | null {
    for (const [id, r] of this.rects) if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) return id;
    return null;
  }

  /** Zoom range: never closer than ZOOM_MAX, never further out than needed to see the whole world. */
  zoomRange(): { min: number; max: number } {
    const fit = Math.min(W / this.bounds.w, H / this.bounds.h);
    return { min: Math.max(ZOOM_FLOOR, Math.min(1, fit)), max: ZOOM_MAX };
  }

  /** True when the whole world is on screen at this view. */
  fits(v: View): boolean {
    return this.bounds.w * v.zoom <= W + 0.5 && this.bounds.h * v.zoom <= H + 0.5;
  }

  /**
   * Clamp a view to the world. An axis fits when the board is no larger than the HUD-free SAFE span.
   * A fitting axis is centred there. SAFE shares the screen midpoint, so the board midpoint lands on it.
   * A longer axis pans until the board edge plus PAD meets the SAFE edge.
   */
  clamp(v: View): View {
    const { min, max } = this.zoomRange();
    const zoom = Math.min(max, Math.max(min, v.zoom));
    const b = this.bounds;
    const axis = (c: number, lo: number, size: number, safe: number): number => {
      if (size * zoom <= safe) return lo + size / 2;
      const half = safe / 2 / zoom;
      return Math.min(lo + size + PAD - half, Math.max(lo - PAD + half, c));
    };
    return { cx: axis(v.cx, b.x, b.w, SAFE.w), cy: axis(v.cy, b.y, b.h, SAFE.h), zoom };
  }

  /** The largest zoom (≤ cap) at which world rect r fits inside the SAFE area, within the zoom range. */
  fitZoom(r: Rect, cap: number): number {
    const { min, max } = this.zoomRange();
    const z = Math.min(cap, (SAFE.w - 40) / r.w, (SAFE.h - 40) / r.h);
    return Math.min(max, Math.max(min, z));
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
