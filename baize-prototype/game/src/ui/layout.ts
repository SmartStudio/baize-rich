// Screen layout (1280×720). The board fills the full height, centred; the HUD floats in the
// margins on its own overlay scene (`HudScene`), so it stays put when the board camera moves.
export const W = 1280;
export const H = 720;
/** Source art is drawn on a 64 px grid; ground tiles are scaled by `BOARD.scale` to fill a cell. */
export const TILE = 64;
const CELL = 80;
const SIZE = 9 * CELL;
export const BOARD = { x: (W - SIZE) / 2, y: (H - SIZE) / 2, cell: CELL, scale: CELL / TILE, size: SIZE };

/**
 * Sprite scales on the board, relative to the source art. Ground (tiles, owner bars, centre art)
 * stretches to the cell; everything standing on a tile is drawn at native pixel size so props,
 * buildings, tokens, the altar and the demon keep one consistent pixel density and fit inside
 * their tile (the tallest building, 58 px, stands within an 80 px cell).
 */
export const SPRITE = {
  ground: CELL / TILE,
  prop: 1,
  token: 1.15,
  tokenActive: 1.35,
  demon: 1,
  altar: 1,
  /** Height of a token's hop between cells, in token-local pixels. */
  hop: 14,
};

const M = 8;
const SIDE_W = BOARD.x - 2 * M;
/** Left margin: round line, one chip per seat, 战报 ticker. */
export const LEFT = { x: M, w: SIDE_W, lineY: M, lineH: 30, chipY: 48, chipH: 60, chipGap: 8, tickerY: H - M - 28, tickerH: 28 };
/** Right margin: utility pills on top, the action dock at the bottom. */
export const RIGHT = { x: W - M - SIDE_W, w: SIDE_W, utilY: M, utilH: 28 };
/** Dock rows, top to bottom. The dock is bottom-anchored; AI-only games show only the header. */
export const DOCK = { pad: 10, headH: 46, rollH: 58, btnH: 32, handH: 64, gap: 8 };
/** Transient overlays in screen space: dice, ribbons. */
export const STAGE = { cx: W / 2, cy: H / 2, diceY: 150, turnRibbonY: 84, dice: 1.6 };

export function cellXY(col: number, row: number): { x: number; y: number } {
  return { x: BOARD.x + col * BOARD.cell, y: BOARD.y + row * BOARD.cell };
}

/** Altar footprint (cells (3,3)–(5,5)). */
export const ALTAR_RECT = { x: BOARD.x + 3 * CELL, y: BOARD.y + 3 * CELL, w: 3 * CELL, h: 3 * CELL };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
