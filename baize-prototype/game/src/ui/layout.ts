// Screen layout (1280×720). The board is a scrolling world drawn by GameScene's camera; the HUD floats
// over it in the screen margins on its own overlay scene (`HudScene`), so it stays put when the camera moves.
export const W = 1280;
export const H = 720;
const M = 8;
/** Board column left between the HUD margins, in screen px. */
const BOARD_W = 720;
/** The board column in screen px: full-screen moments stay inside it so the seat chips and dock stay readable. */
export const BOARD_COL = { x: (W - BOARD_W) / 2, w: BOARD_W };
/** Width of each HUD margin column. */
const SIDE_W = (W - BOARD_W) / 2 - 2 * M;
/** Left margin: round line, one chip per seat, 战报 ticker. chipH fits the realm bar, resources and a tag row above the ticker. */
export const LEFT = { x: M, w: SIDE_W, lineY: M, lineH: 30, chipY: 48, chipH: 88, chipGap: 8, tickerY: H - M - 28, tickerH: 28 };
/** Right margin: utility pills on top, the action dock at the bottom. */
export const RIGHT = { x: W - M - SIDE_W, w: SIDE_W, utilY: M, utilH: 28 };
/** Dock rows, top to bottom. The dock is bottom-anchored; AI-only games show only the header. */
export const DOCK = { pad: 10, headH: 46, rollH: 58, btnH: 32, handH: 64, gap: 8 };
/** Minimap under the utility pills. */
export const MINI = { maxH: 150, gap: 6, btnH: 24 };
/**
 * Transient overlays in screen space: dice, ribbons, toasts.
 * The dice row sits under the turn ribbon and the cutscene strip sits under that row,
 * so a 100px banner stays above a recentred token instead of covering it.
 */
export const STAGE = { cx: W / 2, cy: H / 2, diceY: 141, bannerY: 231, turnRibbonY: 84, toastY: H - 98, dice: 2 };
/** Screen area no HUD column covers. The camera keeps what matters (moving token, choice targets) inside it. */
export const SAFE = { x: M + SIDE_W + M, y: 16, w: W - 2 * (M + SIDE_W + M), h: H - 32 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
