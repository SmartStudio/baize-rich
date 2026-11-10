// Where a coach bubble sits beside what it points at. It never enters the dock column unless it points into the
// dock, and then sits left of it, so it can't cover the dock's main button.
import { H, LEFT, RIGHT, type Rect } from './layout';

const GAP = 14;
const EDGE = 8;

export function bubbleOrigin(at: Rect, w: number, h: number): { x: number; y: number } {
  const inLeft = at.x < LEFT.x + LEFT.w;
  const rightEdge = inLeft ? LEFT.x + LEFT.w : at.x + at.w;
  const limit = RIGHT.x - GAP;
  const right = rightEdge + GAP;
  const left = Math.min(at.x, RIGHT.x) - GAP - w;
  const side = right + w <= limit ? right : left >= EDGE ? left : null;
  let x = side ?? EDGE;
  let y = at.y + at.h / 2 - h / 2;
  if (side === null) {
    y = at.y - h - GAP;
    if (y < EDGE) y = at.y + at.h + GAP;
    x = Math.max(EDGE, Math.min(at.x, limit - w));
  }
  y = Math.max(EDGE, Math.min(H - h - EDGE, y));
  return { x: Math.round(x), y: Math.round(y) };
}
