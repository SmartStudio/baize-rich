// Screen layout (1280×720). The board is the hero: it fills nearly the full height, and the HUD
// lives in two slim columns beside it.
export const W = 1280;
export const H = 720;
/** Source art is drawn on a 64 px grid; the board scales every board sprite by `scale`. */
export const TILE = 64;
const CELL = 76;
export const BOARD = { x: 298, y: 18, cell: CELL, scale: CELL / TILE, size: 9 * CELL };
/** Left column: round HUD, one strip per seat, 战报 ticker. */
export const LEFT = { x: 8, w: 274, hudY: 8, hudH: 80, y: 96, cardH: 124, gap: 6, logY: 622, logH: 90 };
/** Right column: utility buttons, tile card, hand, action buttons, roll dock. */
export const RIGHT = {
  x: 998, w: 274,
  utilY: 8, utilH: 30,
  tileY: 50, tileH: 150,
  handY: 214, handH: 160,
  btnY: 384, btnH: 46,
  dockY: 440, dockH: 272,
};

export function cellXY(col: number, row: number): { x: number; y: number } {
  return { x: BOARD.x + col * BOARD.cell, y: BOARD.y + row * BOARD.cell };
}

/** Altar footprint (cells (3,3)–(5,5)). */
export const ALTAR_RECT = { x: BOARD.x + 3 * CELL, y: BOARD.y + 3 * CELL, w: 3 * CELL, h: 3 * CELL };
/** Centre of the board, where round banners and the big dice appear. */
export const BOARD_CENTER = { x: BOARD.x + BOARD.size / 2, y: BOARD.y + BOARD.size / 2 };
