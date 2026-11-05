// Hand-authored pixel placeholders for the v0.6 frames (shop / mini-game / hospital tiles, special
// buildings, spirits, item cards). Each sprite is rows of palette keys; `paintPixels` draws every key
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

/** Frame size of a sprite: its map plus a one-cell outline border. */
export function pixelSize(sp: PixelSprite): { w: number; h: number } {
  return { w: (sp.rows[0].length + 2) * sp.scale, h: (sp.rows.length + 2) * sp.scale };
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
export const PIXEL_FRAMES: Record<string, PixelSprite> = {
  obj_shop: { scale: 2, rows: [
    '.........yy.........',
    '......yyyyyyyy......',
    '...RRRRRRRRRRRRRR...',
    '.RRrrrrrrrrrrrrrrRR.',
    'RRRRRRRRRRRRRRRRRRRR',
    '.yyyyyyyyyyyyyyyyyy.',
    '..NNvvvvvvvvvvvvNN..',
    '..NNvyyvvbbvvrrvNN..',
    '..NNyYyyvbBvvrRvNN..',
    '..NNvvvvvvvvvvvvNN..',
    '.nnnnnnnnnnnnnnnnnn.',
    '.NNNNNNNyyyyNNNNNNN.',
    '.NNNNNNNyYYyNNNNNNN.',
    '.NNNNNNNNNNNNNNNNNN.',
    'ssssssssssssssssssss',
  ] },
  obj_minigame_alchemy: { scale: 2, rows: [
    '........NN........',
    '.......GlG........',
    '.......oooo.......',
    '......oYoooo......',
    '......oooooo......',
    '.......oooo.......',
    '.......yyyy.......',
    '.....oooooooo.....',
    '....oYYooooooo....',
    '...oYoooooooooo...',
    '...oooooooooooO...',
    '...OooooooooooO...',
    '....OOooooooOO....',
    '..SSSSSSSSSSSSSS..',
    '...SsssyoYosssS...',
    '...SSSSSSSSSSSS...',
    '...S..........S...',
    '..SS..........SS..',
  ] },
  obj_minigame_dice: { scale: 2, rows: [
    '.....PPPPP..........',
    '....PpppppP.........',
    '....PpYpppP.........',
    '....PpYpppP.....WWW.',
    '...PPpppppPP...WWWWW',
    '...PyyyyyyyP...WrWWW',
    '...PPPPPPPPP...WWWrW',
    '...............mmmmm',
    'RRRRRRRRRRRRRRRRRRRR',
    'ryyyyyyyyyyyyyyyyyyr',
    'rRRRRRRRRRRRRRRRRRRr',
    '.N................N.',
    '.N................N.',
    'NN................NN',
  ] },
  obj_hospital: { scale: 2, rows: [
    '........SSSS........',
    '.....SSSssssSSS.....',
    '..SSSssssssssssSSS..',
    'SSSSSSSSSSSSSSSSSSSS',
    '.wwwwwwwwwwwwwwwwww.',
    '.wGGGGwwwwwwwwwwwww.',
    '.wGWWGwwwwwNNNNwwww.',
    '.wWWWWwwwwwNnnNwwww.',
    '.wGWWGwwwwwNnnNwwww.',
    '.wGGGGwwwwwNnnNwwww.',
    '.wwGGwwwwwwNnnNwwww.',
    '.wwwwwwwwwwNnnNwwww.',
    'ssssssssssssssssssss',
  ] },
  bld_garden: { scale: 2, rows: [
    '....l.....l.........',
    '...lgl...lgl...ooo..',
    '..gGlGg.gGlGg.oYooo.',
    '..gGgGg.gGgGg.OOOOO.',
    '..gGgGg.gGgGg...n...',
    '.NNNNNNNNNNNNNNNNNN.',
    '.NnNnNnNnNnNnNnNnNn.',
    '.NNNNNNNNNNNNNNNNNN.',
    'n.n.n.n.n.n.n.n.n.n.',
    'nnnnnnnnnnnnnnnnnnnn',
  ] },
  bld_bazaar: { scale: 2, rows: [
    'yy..................',
    'Nrrrr...............',
    'NrYrr...............',
    'Nrrr................',
    'N.rwrwrwrwrwrwrwrwr.',
    'NrwrwrwrwrwrwrwrwrwR',
    'NRRRRRRRRRRRRRRRRRR.',
    'N.N..y...b...r...N..',
    'N.N.yYy.bBb.rRr..N..',
    'N.NnnnnnnnnnnnnnN...',
    'N.NNNNNNyyNNNNNNNN..',
    'N.NNNNNNNNNNNNNNNN..',
    'ssssssssssssssssssss',
  ] },
  bld_portal: { scale: 2, rows: [
    '.c................c.',
    'cbc..............cbc',
    '.S................S.',
    '.S.....bbbbbb.....S.',
    '.S...bbccccccbb...S.',
    '.S..bc........cb..S.',
    '.S..bc..cWWc..cb..S.',
    '.S...bbccccccbb...S.',
    'SSSSSSSbbbbbbSSSSSSS',
    'SssssssssssssssssssS',
    'SSSSSSSSSSSSSSSSSSSS',
  ] },
  spirit_fox: { scale: 2, rows: [
    '.y...y........',
    '.yy.yy........',
    '.yWWWy........',
    '.WkWkW...YY...',
    '.WWWWW..YyY...',
    '..WrW...yYy...',
    '..WWWW..yyy...',
    '.WWWWWW.yy....',
    '.WWyWWWWyy....',
    '.WWWWWWWy.....',
    '..WWWWWW......',
    '..W.W..W.W....',
  ] },
  spirit_heart: { scale: 2, rows: [
    '.....pppp.....',
    '...ppPPPPpp...',
    '..pPPvvvvPPp..',
    '.pPvvvvvvvvPp.',
    '.pPvrrvvrrvPp.',
    '.pPvRvvvvRvPp.',
    '.pPvvvvvvvvPp.',
    '.pPvvkkkkvvPp.',
    '..pPvvvvvvPp..',
    '..pPPvvvvPPp..',
    '...pPPppPPp...',
    '..pp.pPPp.pp..',
    '.p....pp....p.',
  ] },
  mg_cup: { scale: 3, rows: [
    '......PPPP......',
    '.....PpppPP.....',
    '....PpYppppP....',
    '...PpYpppppppP..',
    '...PpYpppppppP..',
    '..PppYppppppppP.',
    '..PppYppppppppP.',
    '..PpppppppppppP.',
    '.PyyyyyyyyyyyyyP',
    '.PPPPPPPPPPPPPPP',
  ] },
};

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
