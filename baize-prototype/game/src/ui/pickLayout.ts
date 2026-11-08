// Where each lit cell's tag (number badge, label, cost lines) sits: fully on the part of the board the camera
// shows, never under a HUD panel, and covering no other tag or token where it can help it. Tags keep one screen
// size at every zoom, so the layout is solved in world space at the camera's current view and redone when it moves.
import { H, LEFT, RIGHT, type Rect } from './layout';
import { toWorld, viewRect, type Point, type View } from './world';

export interface Size {
  w: number;
  h: number;
}

export interface TagSpot {
  /** The world point the tag scales about. */
  anchor: Point;
  /** Where the anchor sits in the tag, as fractions of its width and height. */
  origin: [number, number];
  /** The tag's world box at the view it was solved for. */
  box: Rect;
  /** Which of the tag's sizes it got: 0 is the full tag, higher drops cost lines. */
  variant: number;
}

/** What the camera shows, in world space: the visible rect and the HUD panels floating over it. */
export interface BoardFrame {
  zoom: number;
  visible: Rect;
  blocked: Rect[];
}

type Slot = (face: Rect, size: Size) => Omit<TagSpot, 'variant'>;

const GAP = 2;
/** Most seats a game has; the left column reserves their chips whatever the count. */
const MAX_SEATS = 4;

/** Tried in order: on the cell's top face, just under it, just over it, right of it, left of it. */
const SLOTS: Slot[] = [
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, [0.5, 0.5], s),
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y + f.h + GAP }, [0.5, 0], s),
  (f, s) => spot({ x: f.x + f.w / 2, y: f.y - GAP }, [0.5, 1], s),
  (f, s) => spot({ x: f.x + f.w + GAP, y: f.y + f.h / 2 }, [0, 0.5], s),
  (f, s) => spot({ x: f.x - GAP, y: f.y + f.h / 2 }, [1, 0.5], s),
];

/** Screen rects of the HUD panels: round line and seat chips, the 战报 ticker, and the whole right column. */
export const HUD_PANELS: readonly Rect[] = [
  { x: LEFT.x, y: LEFT.lineY, w: LEFT.w, h: LEFT.chipY + MAX_SEATS * (LEFT.chipH + LEFT.chipGap) - LEFT.lineY },
  { x: LEFT.x, y: LEFT.tickerY, w: LEFT.w, h: LEFT.tickerH },
  { x: RIGHT.x, y: RIGHT.utilY, w: RIGHT.w, h: H - RIGHT.utilY },
];

export function boardFrame(view: View): BoardFrame {
  return { zoom: view.zoom, visible: viewRect(view), blocked: HUD_PANELS.map((r) => screenToWorld(view, r)) };
}

/**
 * One spot per face, in order. `variants[i]` lists tag i's screen sizes from full to compact. The first variant
 * with a slot fully on the board and off every panel wins, at its slot touching the fewest tags placed before it
 * and `avoid` boxes. When no variant fits anywhere, the most compact one goes where it covers the least panel.
 */
export function placeTags(faces: readonly Rect[], variants: readonly Size[][], avoid: readonly Rect[], frame: BoardFrame): TagSpot[] {
  const taken = [...avoid];
  return faces.map((face, i) => {
    const soft = (s: TagSpot): number => taken.reduce((sum, r) => sum + overlap(s.box, r), 0);
    const options = variants[i].map((size, variant) => SLOTS.map((slot) => ({ ...slot(face, scaled(size, frame.zoom)), variant })));
    const fitting = options.map((spots) => spots.filter((s) => offPanels(s.box, frame) === 0)).find((spots) => spots.length > 0);
    const best = fitting ? minBy(fitting, soft) : minBy(options.at(-1)!, (s) => offPanels(s.box, frame) * 1e6 + soft(s));
    taken.push(best.box);
    return best;
  });
}

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of `box` off the visible board or under a panel. */
function offPanels(box: Rect, frame: BoardFrame): number {
  const outside = box.w * box.h - overlap(box, frame.visible);
  return outside + frame.blocked.reduce((sum, r) => sum + overlap(box, r), 0);
}

function minBy<T>(items: T[], cost: (t: T) => number): T {
  return items.reduce((best, t) => (cost(t) < cost(best) ? t : best));
}

function scaled(s: Size, zoom: number): Size {
  return { w: s.w / zoom, h: s.h / zoom };
}

function screenToWorld(view: View, r: Rect): Rect {
  const p = toWorld(view, r);
  return { x: p.x, y: p.y, w: r.w / view.zoom, h: r.h / view.zoom };
}

function spot(anchor: Point, origin: [number, number], s: Size): Omit<TagSpot, 'variant'> {
  return { anchor, origin, box: { x: anchor.x - origin[0] * s.w, y: anchor.y - origin[1] * s.h, w: s.w, h: s.h } };
}
