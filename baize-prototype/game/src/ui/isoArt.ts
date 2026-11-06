// Pixel-exact painters for the isometric board. Every 2:1 diamond is filled column by column and steps one
// row every two columns, the same stair the hand-drawn tiles use, so edges stay crisp at integer zoom.
type Ctx = CanvasRenderingContext2D;

/** Rows a diamond `w` px wide (and w/2 tall) leaves empty above and below column x. */
export function diamondInset(x: number, w: number): number {
  const d = x < w / 2 ? w / 2 - 1 - x : x - w / 2;
  return Math.floor(d / 2);
}

/** Fill a w×w/2 diamond whose top-left box corner is (ox, oy), shrunk by `inset` rows on every edge. */
export function fillDiamond(ctx: Ctx, ox: number, oy: number, w: number, inset: number): void {
  const h = w / 2;
  for (let x = 0; x < w; x++) {
    const o = diamondInset(x, w) + inset;
    if (h - 2 * o > 0) ctx.fillRect(ox + x, oy + o, 1, h - 2 * o);
  }
}

/** Clear a diamond the same way `fillDiamond` paints one. */
function clearDiamond(ctx: Ctx, w: number, inset: number): void {
  const h = w / 2;
  for (let x = 0; x < w; x++) {
    const o = diamondInset(x, w) + inset;
    if (h - 2 * o > 0) ctx.clearRect(x, o, 1, h - 2 * o);
  }
}

/** A diamond outline `thick` rows wide starting `inset` rows inside the edge. */
export function ringDiamond(ctx: Ctx, w: number, inset: number, thick: number): void {
  fillDiamond(ctx, 0, 0, w, inset);
  clearDiamond(ctx, w, inset + thick);
}

export interface BlockColours {
  top: string;
  /** Lit row along the top face's front edges. */
  lip: string;
  left: string;
  right: string;
  ink: string;
}

/**
 * A raised iso block: a w×w/2 top face whose box starts at row `top`, and `side` rows of wall under it.
 * Column x's face spans [top+o, top+h−o) and its wall the `side` rows below, o = diamondInset(x).
 */
export function paintBlock(ctx: Ctx, w: number, top: number, side: number, c: BlockColours): void {
  const h = w / 2;
  for (let x = 0; x < w; x++) {
    const o = diamondInset(x, w);
    const face = top + o;
    const wall = top + h - o;
    ctx.fillStyle = c.top;
    ctx.fillRect(x, face, 1, wall - face);
    ctx.fillStyle = x < w / 2 ? c.left : c.right;
    ctx.fillRect(x, wall, 1, side);
    ctx.fillStyle = c.lip;
    ctx.fillRect(x, wall - 1, 1, 1);
    ctx.fillStyle = c.ink;
    ctx.fillRect(x, face, 1, 1);
    ctx.fillRect(x, wall + side - 1, 1, 1);
    if (x === 0 || x === w - 1 || x === w / 2) ctx.fillRect(x, wall, 1, side);
  }
}

/** Unit grid steps a one-way road can take, as the screen direction its chevron points. */
export const CHEVRON_DIRS = { 'c+': [1, 1], 'c-': [-1, -1], 'r+': [-1, 1], 'r-': [1, -1] } as const;
export type ChevronDir = keyof typeof CHEVRON_DIRS;
/** Rows of the arrowhead's ink outline; the frame is twice as wide. */
const ARROW_H = 8;
export const CHEVRON = { w: 2 * ARROW_H, h: ARROW_H };

/**
 * An arrowhead lying flat on the iso plane, pointing along a grid axis. On the plane it is a right isosceles
 * triangle with its right angle at the tip; projected, its legs turn horizontal and vertical and its back edge
 * runs parallel to the diamond edges, so the only slanted line steps exactly like the tiles do.
 */
export function paintChevron(ctx: Ctx, dir: ChevronDir, light: string, ink: string): void {
  const [sx, sy] = CHEVRON_DIRS[dir];
  const { w, h } = CHEVRON;
  const wedge = (size: number, inset: number): void => {
    for (let i = 0; i < 2 * size; i++) {
      const rows = size - Math.floor(i / 2);
      const x = w - 1 - inset - i;
      const y = h - inset - rows;
      ctx.fillRect(sx > 0 ? x : w - 1 - x, sy > 0 ? y : h - y - rows, 1, rows);
    }
  };
  ctx.fillStyle = ink;
  wedge(ARROW_H, 0);
  ctx.fillStyle = light;
  wedge(ARROW_H - 3, 1);
}
