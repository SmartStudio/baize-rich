// Board geometry for the front-tilt (HD-2D) view and camera math, kept free of Phaser so it can be unit-tested.
//
// The camera looks at the board from the front and above: the grid stays axis-aligned and rows recede up the
// screen. Cell (c,r)'s top face covers x ∈ [c·TW, c·TW+TW), y ∈ [r·TD, r·TD+TD), and its front face hangs FACE px
// below that. A node's footprint is its `pos` cell, or the cells of its `rect` [c0,r0,c1,r1] (inclusive).
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

/** Width and on-screen depth of one cell's top face, in world px. */
export const TW = 64;
export const TD = 48;
/** Height of a block's front face: the path stands this far above the ground. */
export const FACE = 16;
/** The camera rests only at these zooms, so every art pixel covers a whole number of screen pixels. */
export const ZOOMS = [1, 2] as const;
export type Zoom = (typeof ZOOMS)[number];
/** Margin kept around a framed rect inside the SAFE area, in screen px. */
const FRAME_MARGIN = 40;
/** Landmarks, buildings and tokens rise up to this far above the back row's top faces. */
const HEADROOM = TD;
/** How far past the board the camera may pan, in world px. */
const PAD = TW / 2;
/** Ground painted past the board's bounds, in world px; enough to fill every clamped view at both zooms. */
export const TERRAIN_MARGIN = { x: 5 * TW, y: 2 * TD };

/**
 * Draw order. Rows further front draw later: a block of row r draws over the front face of row r − 1.
 * Whatever stands on a top face sorts by its feet, which stay inside the row, so it lands between its own
 * block and the next row's.
 */
export const DEPTH = {
  ground: -1e5,
  block: (r: number): number => r * TD,
  /** Overlays painted on a top face: ownership rims, marks, chevrons. */
  face: (r: number): number => r * TD + 0.25,
  /** Landmarks, buildings and ground props. Feet sit on whole pixels, so every offset here stays below 1. */
  stand: (footY: number): number => footY + 0.3,
  /** A token draws in front of a landmark that shares its foot line; seats break ties. */
  token: (footY: number, seat: number): number => footY + 0.4 + seat * 0.01,
  /** Labels and markers above the whole board. */
  top: 1e5,
};

/** The grid cell whose top face holds world point p. */
export function cellAt(p: Point): { c: number; r: number } {
  return { c: Math.floor(p.x / TW), r: Math.floor(p.y / TD) };
}

/** A footprint's top face in world px. */
export function faceRect(f: Footprint): Rect {
  return { x: f.c0 * TW, y: f.r0 * TD, w: (f.c1 - f.c0 + 1) * TW, h: (f.r1 - f.r0 + 1) * TD };
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

const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Midpoint of the edge two touching rects share (of the gap between them, if they do not touch). */
export function seam(a: Rect, b: Rect): Point {
  const mid = (lo0: number, hi0: number, lo1: number, hi1: number): number => (Math.max(lo0, lo1) + Math.min(hi0, hi1)) / 2;
  return { x: mid(a.x, a.x + a.w, b.x, b.x + b.w), y: mid(a.y, a.y + a.h, b.y, b.y + b.h) };
}

/** Board bounds plus TERRAIN_MARGIN on every side. The ground texture covers this rect. */
export function terrainRect(bounds: Rect): Rect {
  const m = TERRAIN_MARGIN;
  return { x: bounds.x - m.x, y: bounds.y - m.y, w: bounds.w + 2 * m.x, h: bounds.h + 2 * m.y };
}

export type Facing = 'down' | 'up' | 'left' | 'right';

/** Which way a walker faces stepping from `from` to `to`; the larger axis wins, and no motion keeps `prev`. */
export function facingFor(from: Point, to: Point, prev: Facing): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return prev;
  if (Math.abs(dx) * TD >= Math.abs(dy) * TW) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** A land's building stands this far in front of its top face's back edge, so the road and token feet in front show. */
const BUILDING_FOOT_DY = 18;

/** World point a land's building stands on. */
export function buildingFoot(face: Rect): Point {
  return { x: face.x + face.w / 2, y: face.y + BUILDING_FOOT_DY };
}

/**
 * Feet offsets from a cell's top-face centre for `count` tokens sharing it, in seat order. They stand in front
 * of the landmark's feet, spread across the cell, alternate seats a step further forward so every head shows.
 */
export function tokenSpots(count: number): Point[] {
  const gap = count <= 2 ? 26 : count === 3 ? 20 : 16;
  return Array.from({ length: count }, (_, i) => ({ x: Math.round((i - (count - 1) / 2) * gap), y: 14 + (i % 2) * 5 }));
}

const cellKey = (c: number, r: number): string => `${c},${r}`;

/** Where every node sits on the grid and in world px, the drawable world bounds and the road edges between nodes. */
export class WorldMap {
  /** The top faces of the grid and every footprint, their front faces below and HEADROOM above. */
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
    const faces = unionRect([grid, ...this.feet.values()].map(faceRect));
    this.bounds = { ...faces, y: faces.y - HEADROOM, h: faces.h + HEADROOM + FACE };
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

  /** The centre of the node's top face, in world px. */
  centre(id: NodeId): Point {
    return rectCentre(this.rect(id));
  }

  /** The node's top face, for camera framing and popover anchors. */
  rect(id: NodeId): Rect {
    return faceRect(this.footprint(id));
  }

  /** Where the node answers the pointer: its top face, plus its front face when no node stands in front of it. */
  hitRect(id: NodeId): Rect {
    const f = this.footprint(id);
    const r = faceRect(f);
    for (let c = f.c0; c <= f.c1; c++) if (this.nodeAtCell(c, f.r1 + 1)) return r;
    return { ...r, h: r.h + FACE };
  }

  nodeIds(): NodeId[] {
    return [...this.feet.keys()];
  }

  nodeAtCell(c: number, r: number): NodeId | null {
    return this.byCell.get(cellKey(c, r)) ?? null;
  }

  /** The node whose hit rect holds world point p, if any. */
  nodeAt(p: Point): NodeId | null {
    const { c, r } = cellAt(p);
    const own = this.nodeAtCell(c, r);
    if (own) return own;
    const behind = this.nodeAtCell(c, r - 1);
    return behind && contains(this.hitRect(behind), p) ? behind : null;
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
