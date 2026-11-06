// Art asset contract + placeholders.
//
// Real art arrives as a texture atlas (../assets/atlas.png + atlas.json, Phaser
// JSON-Hash). Until then — or for any frame the atlas lacks — we generate a
// coloured placeholder texture under the frame's own name, so game code can
// always call `addImg(scene, x, y, 'tile_gate')` without caring which exists.
import Phaser from 'phaser';
import { paintBlock, type BlockColours } from './isoArt';
import { ITEM_PICTURES, paintPixels, PIXEL_FRAMES, pixelSize } from './sprites';
import { FONT } from './theme';

export const ATLAS_KEY = 'atlas';

/** An iso block frame: its size and the frame pixel the top face's diamond centre sits on. */
export interface BlockFrame { w: number; h: number; cx: number; cy: number }
/** iso_land_* and iso_jade: one cell; the top face spans rows 40..88. */
export const ISO_BLOCK: BlockFrame = { w: 96, h: 120, cx: 48, cy: 64 };
/** iso_altar: the 3×3 ALTAR footprint. */
export const ISO_ALTAR: BlockFrame = { w: 288, h: 352, cx: 144, cy: 230 };

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
interface FrameSpec { name: string; w: number; h: number; draw: Draw }

const REGION_FILL: Record<string, string> = { wood: '#2F6B3A', fire: '#8A3424', water: '#2C5E86', earth: '#5B3D78' };
const REGION_LIGHT: Record<string, string> = { wood: '#4FA35A', fire: '#E0663A', water: '#5FB7E0', earth: '#8E5BC2' };
const REGION_DARK: Record<string, string> = { wood: '#1F4A28', fire: '#5E2218', water: '#1E4060', earth: '#3E2856' };
const TYPE_FILL: Record<string, [string, string]> = {
  start: ['#6E5A2A', '宗'], gate: ['#57506E', '门'], secret: ['#4C5A66', '秘'], spring: ['#2E6E7A', '泉'],
  market: ['#7A5A2E', '市'], alchemy: ['#7A3A2E', '丹'], beast: ['#3A3448', '兽'], ruins: ['#3E3A7A', '府'],
  eye: ['#6E6A88', '眼'],
};
const HERO_FILL: Record<string, [string, string]> = {
  body: ['#F2B93B', '体'], magic: ['#E6E4F0', '法'], sword: ['#D9434B', '剑'], alch: ['#3A6FD8', '丹'],
};
const CARD_FILL: Record<string, string> = { attack: '#9A3A3A', guard: '#3A5A9A', move: '#3A8A4A', wealth: '#A8862E' };

function box(fill: string, stroke = '#0F0E1A', inset = 0): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = stroke;
    ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
    ctx.fillStyle = fill;
    ctx.fillRect(inset + 2, inset + 2, w - inset * 2 - 4, h - inset * 2 - 4);
  };
}

function glyph(ch: string, color: string, size: number, dy = 0): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, h / 2 + dy);
  };
}

/** A raised block whose top face is a 2:1 diamond as wide as the frame, centred on (cx, cy). */
function block(f: BlockFrame, colours: BlockColours): Draw {
  const half = f.w / 4;
  return (ctx) => paintBlock(ctx, f.w, f.cy - half, f.h - (f.cy + half), colours);
}

function both(...ds: Draw[]): Draw {
  return (ctx, w, h) => ds.forEach((d) => d(ctx, w, h));
}

function circle(fill: string, stroke = '#0F0E1A'): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  };
}

/** Bottom-anchored blob for objects (origin bottom-centre), standing `lift` px above the frame's bottom. */
function object(fill: string, ch: string, wFrac = 0.8, hFrac = 0.8, lift = 0): Draw {
  return (ctx, w, h) => {
    const bw = Math.round(w * wFrac);
    const bh = Math.round(h * hFrac);
    const x = (w - bw) / 2;
    const y = h - lift - bh;
    ctx.fillStyle = '#0F0E1A';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    glyph(ch, '#F4E9D0', Math.floor(bh * 0.55), (y + bh / 2) - h / 2)(ctx, w, h);
  };
}

function pips(n: number): Draw {
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
  };
  return both(box('#F4E9D0'), (ctx, w, h) => {
    ctx.fillStyle = n === 1 ? '#D9434B' : '#2A2238';
    for (const [sx, sy] of spots[n]) { ctx.beginPath(); ctx.arc(sx * w, sy * h, 3, 0, Math.PI * 2); ctx.fill(); }
  });
}

/** Ground tile in the atlas style: sand border, a patterned rug, a dark band along the bottom edge. */
function rug(border: string, fill: string, mark: string, band: string, pattern: (x: number, y: number) => boolean): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = '#DCC9A0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = border;
    ctx.fillRect(8, 6, w - 16, h - 18);
    ctx.fillStyle = fill;
    ctx.fillRect(10, 8, w - 20, h - 22);
    ctx.fillStyle = mark;
    for (let y = 8; y < h - 14; y++) for (let x = 10; x < w - 10; x++) if (pattern(x, y)) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = '#B8A27A';
    ctx.fillRect(0, h - 12, w, 2);
    ctx.fillStyle = band;
    ctx.fillRect(0, h - 10, w, 10);
  };
}

/** v0.6 card face for an item: coloured border, 道具 label, its picture in the box, a seal at the foot. */
function itemCard(id: string): Draw {
  const it = ITEM_PICTURES[id];
  return (ctx, w, h) => {
    ctx.fillStyle = '#0F0E1A';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = it.border;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#EAD7A0';
    ctx.fillRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#0F0E1A';
    ctx.fillRect(6, 19, w - 12, 56);
    ctx.fillStyle = it.sky;
    ctx.fillRect(7, 20, w - 14, 54);
    paintPixels(ctx, w - 14, 50, { rows: it.rows, scale: 4 }, 7, 22);
    glyph(it.label, '#2A2238', 11, 0)(ctx, w, 24);
    ctx.fillStyle = '#9A2A2A';
    ctx.fillRect(w / 2 - 7, h - 22, 14, 12);
    ctx.fillStyle = '#F4E9D0';
    ctx.fillRect(w / 2 - 3, h - 19, 6, 6);
  };
}

/** Every frame name in the art contract, with its size and a placeholder painter. */
export function frameSpecs(): FrameSpec[] {
  const out: FrameSpec[] = [];
  const add = (name: string, w: number, h: number, draw: Draw) => out.push({ name, w, h, draw });
  // iso board: raised blocks (diamond centre at ISO_BLOCK.cx/cy), landmarks and buildings standing on them
  for (const r of ['wood', 'fire', 'water', 'earth']) {
    add(`iso_land_${r}`, ISO_BLOCK.w, ISO_BLOCK.h, block(ISO_BLOCK, { top: REGION_LIGHT[r], lip: '#F4E9D0', left: REGION_FILL[r], right: REGION_DARK[r], ink: '#0F0E1A' }));
    add(`decor_${r}`, 36, 20, object(REGION_LIGHT[r], '', 0.9, 0.6));
  }
  add('iso_jade', ISO_BLOCK.w, ISO_BLOCK.h, block(ISO_BLOCK, { top: '#E8F0E6', lip: '#FFFFFF', left: '#B8C8BC', right: '#8FA496', ink: '#0F0E1A' }));
  add('iso_altar', ISO_ALTAR.w, ISO_ALTAR.h, both(
    block(ISO_ALTAR, { top: '#CFC6A8', lip: '#F4E9D0', left: '#8A826C', right: '#6A6352', ink: '#0F0E1A' }),
    object('#E6E4F0', '', 48 / ISO_ALTAR.w, (ISO_ALTAR.cy - 40) / ISO_ALTAR.h, ISO_ALTAR.h - ISO_ALTAR.cy),
    glyph('白泽', '#2A2238', 22, 0),
  ));
  for (const [t, [fill, ch]] of Object.entries(TYPE_FILL)) add(`lm_${t}`, 56, 64, object(t === 'start' ? '#B8902E' : fill, ch, 0.8, 0.8));
  for (let lv = 1; lv <= 3; lv++) add(`iso_bld_${lv}`, 48, 36 + lv * 12, object(['#8A6A44', '#B08A5A', '#D8B060'][lv - 1], ['圃', '府', '脉'][lv - 1], 0.85, 1));
  add('obj_furnace', 40, 40, object('#7A3A2E', '炉'));
  add('tile_shop', 64, 64, rug('#F2B93B', '#2F6B5A', '#4FA38A', '#1F4A3E', (x, y) => (x + y) % 6 === 0));
  add('tile_minigame', 64, 64, rug('#8E5BC2', '#4A2A6E', '#F2B93B', '#2A1A3E', (x, y) => (x >> 2) % 2 === (y >> 2) % 2 && (x + y) % 2 === 0));
  add('tile_hospital', 64, 64, rug('#4FA35A', '#E8F0E0', '#BFD8B0', '#2F6B3A', (x, y) => (x % 10 === 4 && y % 10 < 7) || (y % 10 === 3 && x % 10 < 9)));
  add('obj_minigame', 40, 40, object('#4A4466', '戏'));
  for (const [name, sp] of Object.entries(PIXEL_FRAMES)) {
    const { w, h } = pixelSize(sp);
    add(name, w, h, (ctx, cw, ch) => paintPixels(ctx, cw, ch, sp));
  }
  for (const id of Object.keys(ITEM_PICTURES)) add(`card_${id}`, 88, 120, itemCard(id));
  add('centre_bg', 448, 448, (ctx, w, h) => {
    ctx.fillStyle = '#23213A';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2E2B4A';
    ctx.lineWidth = 1;
    for (let k = 0; k <= w; k += 32) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(w, k); ctx.stroke();
    }
  });
  add('baize', 100, 104, both(object('#E6E4F0', '白泽', 0.9, 0.85)));
  add('demon', 60, 68, both(object('#5A1E5E', '魔', 0.85, 0.85)));
  for (const [hid, [fill, ch]] of Object.entries(HERO_FILL)) {
    add(`tok_${hid}`, 32, 48, (ctx, w, h) => {
      ctx.fillStyle = '#0F0E1A';
      ctx.fillRect(4, 6, 24, 42);
      ctx.fillStyle = fill;
      ctx.fillRect(6, 8, 20, 38);
      glyph(ch, '#0F0E1A', 16, 2)(ctx, w, h);
    });
    add(`por_${hid}`, 64, 64, both(box(fill), glyph(ch, '#0F0E1A', 34)));
    add(`por_${hid}_s`, 40, 40, both(box(fill), glyph(ch, '#0F0E1A', 22)));
  }
  add('ic_stone', 16, 16, (ctx) => {
    ctx.fillStyle = '#0F0E1A';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(16, 8); ctx.lineTo(8, 16); ctx.lineTo(0, 8); ctx.fill();
    ctx.fillStyle = '#7FE0E8';
    ctx.beginPath(); ctx.moveTo(8, 2); ctx.lineTo(14, 8); ctx.lineTo(8, 14); ctx.lineTo(2, 8); ctx.fill();
  });
  add('ic_pill', 16, 16, circle('#E0663A'));
  add('ic_cult', 16, 16, both(circle('#F2B93B'), glyph('修', '#2A2238', 10)));
  add('ic_demon', 16, 16, both(circle('#8E2B8E'), glyph('魔', '#F4E9D0', 10)));
  add('ic_baize', 16, 16, both(circle('#E6E4F0'), glyph('泽', '#2A2238', 10)));
  for (let i = 1; i <= 6; i++) add(`die_${i}`, 24, 24, pips(i));
  for (const [cat, fill] of Object.entries(CARD_FILL)) {
    add(`card_${cat}`, 88, 120, (ctx, w, h) => {
      box('#2A2238')(ctx, w, h);
      ctx.fillStyle = fill;
      ctx.fillRect(6, 6, w - 12, 64);
      ctx.fillStyle = '#F4E9D0';
      ctx.fillRect(6, 74, w - 12, h - 80);
    });
  }
  add('card_divine', 80, 108, both(box('#F4E9D0'), (ctx, w, h) => { ctx.strokeStyle = '#F2B93B'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12); }));
  add('card_heaven', 80, 108, both(box('#E6E4F0'), (ctx, w, h) => { ctx.strokeStyle = '#5FB7E0'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12); }));
  return out;
}

/** Create placeholder textures for every contract frame the atlas does not provide. */
export function ensureFrames(scene: Phaser.Scene): { missing: string[] } {
  const atlas = scene.textures.exists(ATLAS_KEY) ? scene.textures.get(ATLAS_KEY) : null;
  const missing: string[] = [];
  for (const spec of frameSpecs()) {
    if (atlas && atlas.has(spec.name)) continue;
    missing.push(spec.name);
    if (scene.textures.exists(spec.name)) continue;
    const tex = scene.textures.createCanvas(spec.name, spec.w, spec.h);
    if (!tex) continue;
    spec.draw(tex.getContext(), spec.w, spec.h);
    tex.refresh();
  }
  return { missing };
}

/** A procedural texture under `key`, painted once per game. */
export function ensureCanvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

/** Texture key + frame for a contract frame name (atlas first, placeholder otherwise). */
export function frameRef(scene: Phaser.Scene, name: string): [string, string | undefined] {
  if (scene.textures.exists(ATLAS_KEY) && scene.textures.get(ATLAS_KEY).has(name)) return [ATLAS_KEY, name];
  return [name, undefined];
}

/** Whether a contract frame exists, in the atlas or as a placeholder. */
export function hasFrame(scene: Phaser.Scene, name: string): boolean {
  const [key, frame] = frameRef(scene, name);
  return frame !== undefined || scene.textures.exists(key);
}

export function addImg(scene: Phaser.Scene, x: number, y: number, name: string): Phaser.GameObjects.Image {
  const [key, frame] = frameRef(scene, name);
  return scene.add.image(x, y, key, frame);
}

export function setFrame(img: Phaser.GameObjects.Image, name: string): void {
  const [key, frame] = frameRef(img.scene, name);
  img.setTexture(key, frame);
}
