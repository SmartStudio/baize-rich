// Where each lit cell's tag (number badge, label, cost lines) sits so no tag covers another tag or a token.
// Tags keep one screen size at every zoom: BoardPick draws them at zoom-1 size and scales each by 1/zoom about
// its anchor. The layout is solved at zoom 1, the tightest view. Every anchor lies inside its own box, and a box
// shrunk toward a point inside it stays inside itself, so a layout clear at zoom 1 stays clear at zoom 2.
import type { Rect } from './layout';
import type { Point } from './world';

export interface Size {
  w: number;
  h: number;
}

export interface TagSpot {
  /** The world point the tag scales about. */
  anchor: Point;
  /** Where the anchor sits in the tag, as fractions of its width and height. */
  origin: [number, number];
  /** The tag's world box at zoom 1. */
  box: Rect;
}

type Slot = (face: Rect, size: Size) => TagSpot;

const GAP = 2;

/** Tried in order: on the cell's top face, just under it, just over it, right of it, left of it. */
const SLOTS: Slot[] = [
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, [0.5, 0.5], s),
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y + f.h + GAP }, [0.5, 0], s),
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y - GAP }, [0.5, 1], s),
  (f, s) => spot({ x: f.x + f.w + GAP, y: f.y + f.h / 2 }, [0, 0.5], s),
  (f, s) => spot({ x: f.x - GAP, y: f.y + f.h / 2 }, [1, 0.5], s),
];

/**
 * One spot per face, in order: the first slot touching neither a tag placed before it nor an `avoid` box,
 * else the slot covering the least of them.
 */
export function placeTags(faces: readonly Rect[], sizes: readonly Size[], avoid: readonly Rect[]): TagSpot[] {
  const taken = [...avoid];
  return faces.map((face, i) => {
    const spots = SLOTS.map((slot) => slot(face, sizes[i]));
    const covered = spots.map((s) => taken.reduce((sum, r) => sum + overlap(s.box, r), 0));
    const best = spots[covered.indexOf(Math.min(...covered))];
    taken.push(best.box);
    return best;
  });
}

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function spot(anchor: Point, origin: [number, number], s: Size): TagSpot {
  return { anchor, origin, box: { x: anchor.x - origin[0] * s.w, y: anchor.y - origin[1] * s.h, w: s.w, h: s.h } };
}
