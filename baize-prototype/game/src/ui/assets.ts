// Art asset contract + placeholders.
//
// Real art arrives as a texture atlas (../assets/atlas.png + atlas.json, Phaser
// JSON-Hash). Until then — or for any frame the atlas lacks — we generate a
// coloured placeholder texture under the frame's own name, so game code can
// always call `addImg(scene, x, y, 'ft_jade')` without caring which exists.
import Phaser from 'phaser';
import { ITEM_PICTURES, paintPixels } from './sprites';
import { FONT } from './theme';
import { FACE, TD, TW } from './world';

export const ATLAS_KEY = 'atlas';

/** ft_altar: the 3×3 ALTAR block (top face 144 + front face 16) under 80 px of statue. */
export const FT_ALTAR = { w: 3 * TW, h: 80 + 3 * TD + FACE, statue: 80 };
/** tok_<hero>_<dir><n>: a walker frame whose feet sit on frame pixel (24, 62). */
export const TOKEN_FRAME = { w: 48, h: 64, footX: 24, footY: 62 };
export const WALK_FRAMES = 4;
export type WalkDir = 'd' | 'u' | 's';
/** Frame 0 is the stand pose; 0→1→2→3 loops as the walk. `s` faces right and is flipped for left. */
export const walkFrame = (hero: string, dir: WalkDir, n: number): string => `tok_${hero}_${dir}${n}`;

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

interface BlockShade { top: string; fleck: string; lip: string; front: string; seam: string }

const shade = (top: string, fleck: string, lip: string, front: string, seam: string): BlockShade => ({ top, fleck, lip, front, seam });

/** A front-tilt block: a `depth`-row top face at frame row y0 with a FACE-row front face under it. */
function block(s: BlockShade, y0 = 0, depth = TD): Draw {
  return (ctx, w) => {
    const front = y0 + depth;
    ctx.fillStyle = s.top;
    ctx.fillRect(0, y0, w, depth);
    ctx.fillStyle = s.fleck;
    for (let i = 0; i < (w * depth) / 160; i++) ctx.fillRect(4 + ((i * 37 + 11) % (w - 10)), y0 + 4 + ((i * 23 + 5) % (depth - 9)), 2, 1);
    ctx.fillStyle = s.seam;
    ctx.fillRect(0, y0, w, 1);
    ctx.fillRect(0, y0, 1, depth);
    ctx.fillRect(w - 1, y0, 1, depth);
    ctx.fillStyle = s.lip;
    ctx.fillRect(1, front - 2, w - 2, 2);
    ctx.fillStyle = s.front;
    ctx.fillRect(0, front, w, FACE);
    ctx.fillStyle = s.seam;
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, front + 2, 1, FACE - 4);
    ctx.fillRect(0, front + FACE / 2, w, 1);
    ctx.fillStyle = '#0F0E1A';
    ctx.fillRect(0, front + FACE - 1, w, 1);
  };
}

/** The altar statue placeholder: a horned beast seated on a plinth, facing the camera. */
const STATUE: string[] = [
  '...y..........y...',
  '...yy........yy...',
  '....yWWWWWWWWy....',
  '...WWWWWWWWWWWW...',
  '..WWWkWWWWWWkWWW..',
  '..WWWWWWWWWWWWWW..',
  '..mWWWWWyyWWWWWm..',
  '...mWWWWWWWWWWm...',
  '..wwmWWWWWWWWmww..',
  '.wwwwmmWWWWmmwwww.',
  '.wwwwwWWWWWWwwwww.',
  '.wwwwWWWWWWWWwwww.',
  '..wwWWWWWWWWWWww..',
  '...WWWWWWWWWWWW...',
  '...WWWWWWWWWWWW...',
  '...WWWmWWWWmWWW...',
  '...WWWmWWWWmWWW...',
  '..WWWWmWWWWmWWWW..',
  '..WWWmmWWWWmmWWW..',
  '..WWWm.mWWm.mWWW..',
  'mmmmmmmmmmmmmmmmmm',
  'ssssssssssssssssss',
  'ssssssssssssssssss',
  'SSSSSSSSSSSSSSSSSS',
];

/** The altar placeholder: a stone dais block with the statue standing on the back of its top face. */
function altar(): Draw {
  const { statue } = FT_ALTAR;
  return both(
    block(shade('#CFC6A8', '#E2DBC2', '#F4E9D0', '#8A826C', '#6A6352'), statue, 3 * TD),
    (ctx, w) => {
      ctx.fillStyle = '#B5AC90';
      ctx.fillRect(24, statue + 20, w - 48, 3 * TD - 44);
      paintPixels(ctx, w, statue + 30, { rows: STATUE, scale: 3 });
    },
  );
}

/** One walker frame: a robed cultivator facing `dir`, legs and arms in phase `n` of the walk cycle. */
function walker(fill: string, dir: WalkDir, n: number): Draw {
  const dark = '#2A2238';
  const bob = n % 2;
  const lift = (leg: 0 | 1): number => (dir !== 's' && n === (leg ? 3 : 1) ? 2 : 0);
  const legs: [number, number][] = dir === 's' ? (n % 2 ? [[19, 0], [26, 0]] : [[22, 0], [23, 0]]) : [[19, lift(0)], [25, lift(1)]];
  const [hairW, hairH] = { d: [12, 5], u: [12, 12], s: [6, 11] }[dir];
  return (ctx) => {
    const parts: [number, number, number, number, string][] = [
      ...legs.map(([x, up]): [number, number, number, number, string] => [x, 53, 4, 10 - up, dark]),
      [16, 34 - bob, 16, 21, fill],
      [14, 37 - bob + (n === 1 ? 1 : 0), 3, 12, fill],
      [31, 37 - bob + (n === 3 ? 1 : 0), 3, 12, fill],
      [18, 20 - bob, 12, 14, '#F0D0A8'],
    ];
    ctx.fillStyle = '#0F0E1A';
    for (const [x, y, w, h] of parts) ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillRect(21, 15 - bob, 6, 5);
    for (const [x, y, w, h, c] of parts) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
    ctx.fillStyle = dark;
    ctx.fillRect(22, 16 - bob, 4, 4);
    ctx.fillRect(18, 20 - bob, hairW, hairH);
    ctx.fillStyle = '#0F0E1A';
    if (dir === 'd') { ctx.fillRect(21, 28 - bob, 1, 2); ctx.fillRect(26, 28 - bob, 1, 2); }
    if (dir === 's') { ctx.fillRect(27, 28 - bob, 1, 2); ctx.fillStyle = '#F0D0A8'; ctx.fillRect(30, 29 - bob, 1, 2); }
    ctx.fillStyle = '#F4E9D0';
    ctx.fillRect(16, 44 - bob, 16, 2);
  };
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
  // front-tilt board (docs/assets.md §2b): blocks one cell wide, landmarks and buildings standing on them
  for (const r of ['wood', 'fire', 'water', 'earth']) {
    add(`ft_land_${r}`, TW, TD + FACE, block(shade(REGION_FILL[r], REGION_LIGHT[r], REGION_LIGHT[r], REGION_DARK[r], '#0F0E1A')));
    add(`decor_${r}`, 36, 20, object(REGION_LIGHT[r], '', 0.9, 0.6));
  }
  add('ft_jade', TW, TD + FACE, block(shade('#D8E4D6', '#F2F7F0', '#FFFFFF', '#8FA496', '#5E7064')));
  add('ft_altar', FT_ALTAR.w, FT_ALTAR.h, altar());
  for (const [t, [fill, ch]] of Object.entries(TYPE_FILL)) add(`lm_${t}`, 56, 64, object(t === 'start' ? '#B8902E' : fill, ch, 0.8, 0.8));
  for (let lv = 1; lv <= 3; lv++) add(`bld_${lv}`, 48, 36 + lv * 12, object(['#8A6A44', '#B08A5A', '#D8B060'][lv - 1], ['圃', '府', '脉'][lv - 1], 0.85, 1));
  add('obj_furnace', 40, 40, object('#7A3A2E', '炉'));
  for (const id of Object.keys(ITEM_PICTURES)) add(`card_${id}`, 88, 120, itemCard(id));
  add('baize', 100, 104, both(object('#E6E4F0', '白泽', 0.9, 0.85)));
  for (const [hid, [fill, ch]] of Object.entries(HERO_FILL)) {
    const { w: tw, h: th } = TOKEN_FRAME;
    add(`tok_${hid}`, tw, th, walker(fill, 'd', 0));
    for (const dir of ['d', 'u', 's'] as const) {
      for (let n = 0; n < WALK_FRAMES; n++) add(walkFrame(hid, dir, n), tw, th, walker(fill, dir, n));
    }
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
