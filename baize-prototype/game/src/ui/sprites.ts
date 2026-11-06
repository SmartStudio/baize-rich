// Hand-authored pixel pictures for the item-card placeholders. Each picture is rows of palette keys; `paintPixels` draws every key
// as an s×s block and adds the dark 1-cell outline the atlas art uses, so the maps stay readable.

/** Shared palette, picked from the atlas art. '.' is transparent. */
export const PAL: Record<string, string> = {
  k: '#1A1626',
  w: '#F4E9D0', W: '#FFFFFF', m: '#C9C2B0',
  y: '#F2B93B', Y: '#FFE7A0', o: '#E0663A', O: '#A8452A',
  r: '#D9434B', R: '#8A2430',
  g: '#4FA35A', G: '#2F6B3A', l: '#9BE07A',
  b: '#5FB7E0', B: '#2C5E86', c: '#7FE0E8',
  p: '#8E5BC2', P: '#4A2A6E', v: '#2A1A3E',
  n: '#B08A5A', N: '#6E4A2E',
  s: '#8A86A8', S: '#4A4766',
};

const OUTLINE = '#1A1626';

export interface PixelSprite {
  rows: string[];
  /** Screen pixels per map cell. */
  scale: number;
}

/** Paint a sprite bottom-centred in a w×h canvas, outlining every opaque cell's empty neighbours. */
export function paintPixels(ctx: CanvasRenderingContext2D, w: number, h: number, sp: PixelSprite, ox = 0, oy = 0): void {
  const { rows, scale: s } = sp;
  const cols = rows[0].length;
  const x0 = ox + Math.floor((w - (cols + 2) * s) / 2) + s;
  const y0 = oy + h - (rows.length + 1) * s;
  const solid = (x: number, y: number): boolean => y >= 0 && y < rows.length && x >= 0 && x < cols && rows[y][x] !== '.';
  ctx.fillStyle = OUTLINE;
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= cols; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
    }
  }
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (key === '.') return;
    ctx.fillStyle = PAL[key];
    ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
  }));
}

/** Board objects, buildings, spirits and the dice cup, keyed by frame name. */
/** Item card pictures (御骰符 / 路障符 / 爆炎阵 / 回首符), drawn into the card's picture box at 4×. */
export const ITEM_PICTURES: Record<string, { rows: string[]; sky: string; border: string; label: string }> = {
  dice: { sky: '#F6D88A', border: '#C8952E', label: '御骰', rows: [
    '..WWWWWWWWW..',
    '.WWWWWWWWWWW.',
    '.WkWWWWWWWkW.',
    '.WWWWWWWWWWW.',
    '.WWWWWrWWWWW.',
    '.WWWWWWWWWWW.',
    '.WkWWWWWWWkW.',
    '.WWWWWWWWWWW.',
    '.mWWWWWWWWWm.',
    '..mmmmmmmmm..',
  ] },
  barrier: { sky: '#BFD8E8', border: '#8A5A2E', label: '路障', rows: [
    '.N.........N.',
    'NnN.......NnN',
    'rrwwrrwwrrwwr',
    'RRmmRRmmRRmmR',
    '.N.........N.',
    '.N.........N.',
    'NnN.......NnN',
    'sssssssssssss',
  ] },
  blast: { sky: '#3A2440', border: '#B83A2E', label: '爆炎', rows: [
    '......y......',
    '..o..yYy..o..',
    '...oyYWYyo...',
    '.o.yYWWWYy.o.',
    '..oyYWWWYyo..',
    '...ooyyyoo...',
    '.rrrrooorrrr.',
    'r.R.......R.r',
    '.rrrrrrrrrrr.',
  ] },
  turnback: { sky: '#DDEFF6', border: '#2C5E86', label: '回首', rows: [
    '....bbbbb....',
    '..bbBBBBBbb..',
    '.bBB.....BBb.',
    '.bB.......Bb.',
    '.bB.......Bb.',
    'bbBbb.....Bb.',
    '.bBb......Bb.',
    '..b.......Bb.',
    '..........Bb.',
    '..........Bb.',
  ] },
};
