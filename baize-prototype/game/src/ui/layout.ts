// Screen layout (1280×720), mirrors the mockup.
export const W = 1280;
export const H = 720;
export const BOARD = { x: 352, y: 80, cell: 64 };
export const LEFT = { x: 16, w: 312, y: 72, cardH: 152, gap: 8 };
export const RIGHT = { x: 952, w: 312 };
export const TOP = { x: 16, y: 8, w: 1248, h: 52 };

export function cellXY(col: number, row: number): { x: number; y: number } {
  return { x: BOARD.x + col * BOARD.cell, y: BOARD.y + row * BOARD.cell };
}

/** Altar footprint (cells (3,3)–(5,5)). */
export const ALTAR_RECT = { x: BOARD.x + 3 * 64, y: BOARD.y + 3 * 64, w: 192, h: 192 };
