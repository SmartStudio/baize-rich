// Screen layout (1280×720). The board is a scrolling world drawn by GameScene's camera; the HUD floats
// over it in the screen margins on its own overlay scene (`HudScene`), so it stays put when the camera moves.
export const W = 1280;
export const H = 720;
/** Source art is drawn on a 64 px grid. */
export const TILE = 64;
/** World px per board grid cell. At zoom 1 a 9-row board exactly fills the screen height. */
export const CELL = 80;
/** Gap around each tile inside its cell, where the roads between nodes show through. */
export const INSET = 4;

/**
 * Sprite scales on the board, relative to the source art, in world px (the camera zoom scales them all).
 * Ground (tiles, owner bars) stretches to the tile; everything standing on a tile is drawn at native
 * pixel size so props, buildings, tokens, the altar and the demon keep one consistent pixel density
 * and fit inside their tile (the tallest building, 58 px, stands within a 72 px tile).
 */
export const SPRITE = {
  ground: (CELL - 2 * INSET) / TILE,
  prop: 1,
  token: 1,
  demon: 1,
  altar: 1,
  /** Height of a token's hop between cells, in token-local pixels. */
  hop: 14,
};

const M = 8;
/** Width of each HUD margin column: the screen left over beside a 9-cell-wide board at zoom 1. */
const SIDE_W = (W - 9 * CELL) / 2 - 2 * M;
/** Left margin: round line, one chip per seat, 战报 ticker. */
export const LEFT = { x: M, w: SIDE_W, lineY: M, lineH: 30, chipY: 48, chipH: 60, chipGap: 8, tickerY: H - M - 28, tickerH: 28 };
/** Right margin: utility pills on top, the action dock at the bottom. */
export const RIGHT = { x: W - M - SIDE_W, w: SIDE_W, utilY: M, utilH: 28 };
/** Dock rows, top to bottom. The dock is bottom-anchored; AI-only games show only the header. */
export const DOCK = { pad: 10, headH: 46, rollH: 58, btnH: 32, handH: 64, gap: 8 };
/** Minimap under the utility pills (shown only when the world is bigger than the screen). */
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
