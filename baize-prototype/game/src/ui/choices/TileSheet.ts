// 'tiles' layout: one row of option tiles that each show their consequence (odds, yield, price) in large type.
import Phaser from 'phaser';
import { addImg } from '../assets';
import { H, W } from '../layout';
import { COLORS, FS, HEX, txt } from '../theme';
import { Button } from '../widgets';
import { header, keyHelp, modalFrame, placeX, TONE_FILL, TONE_HEX, type SheetBuilder } from './panel';
import { optionKey, type ModalOption } from './spec';

const TILE_H = 168;
const GAP = 10;
const PAD = 24;
const ICON_SCALE = 2;
const ICON_STEP = 34;
const TILE_FILL = 0xe8d9b4;
const FOCUS_FILL = 0xfff3d6;

export const buildTiles: SheetBuilder = (s, spec, pick, hover) => {
  const n = spec.options.length;
  const tw = Phaser.Math.Clamp(Math.floor((W - 80 - 2 * PAD - (n - 1) * GAP) / n), 92, 148);
  const rowW = n * tw + (n - 1) * GAP;
  const pw = Math.max(520, rowW + 2 * PAD);
  const head = header(s, spec, pw - 2 * PAD);
  const ph = 34 + head.h + TILE_H + 40;
  const py = Math.round((H - ph) / 2);
  const px = placeX(pw, py, ph, spec.avoid, false);
  const layer = modalFrame(s, spec.title, px, py, pw, ph, true);
  layer.add(head.box.setPosition(Math.round(px + pw / 2), py + 30));
  const x0 = Math.round(px + (pw - rowW) / 2);
  const y0 = py + 34 + head.h;
  const tiles = spec.options.map((o, i) => {
    const t = tile(s, o, optionKey(o, i), x0 + i * (tw + GAP), y0, tw);
    if (!o.disabled) {
      t.bg.setInteractive({ useHandCursor: true });
      t.bg.on('pointerover', () => hover(o.id));
      t.bg.on('pointerdown', () => pick(o.id));
    }
    layer.add(t.root);
    return { id: o.id, focus: t.focus };
  });
  layer.add(keyHelp(s, spec, Math.round(px + pw / 2), py + ph - 16));
  if (spec.closable) {
    layer.add(new Button(s, px + PAD, py + ph - 32, { w: 72, h: 24, label: '返回', size: FS.sm, fill: 0xb4b8cc, textColor: HEX.ink }).onClick(() => pick('__close')));
  }
  return { layer, highlight: (id) => tiles.forEach((t) => t.focus(t.id === id)) };
};

function tile(s: Phaser.Scene, o: ModalOption, key: string | null, x: number, y: number, w: number) {
  const cx = Math.round(w / 2);
  const bg = s.add.rectangle(0, 0, w, TILE_H, TILE_FILL).setOrigin(0, 0).setStrokeStyle(2, 0xc9a86a);
  const root = s.add.container(x, y, [bg]);
  if (key) {
    root.add(s.add.rectangle(6, 6, 18, 18, COLORS.ink).setOrigin(0, 0));
    root.add(txt(s, 15, 15, key, { size: FS.xs, bold: true, color: HEX.parchment, origin: [0.5, 0.5] }));
  }
  root.add(txt(s, cx, 12, o.label, { size: FS.md, bold: true, color: HEX.ink, origin: [0.5, 0] }));
  root.add(iconRow(s, o, cx, 60, w - 16));
  const tone = o.tone ?? 'dim';
  if (o.big) root.add(txt(s, cx, 98, o.big, { size: FS.xl, bold: true, color: TONE_HEX[tone], origin: [0.5, 0.5] }));
  if (o.meter !== undefined) {
    const mw = w - 24;
    root.add(s.add.rectangle(12, 116, mw, 8, 0xd8c49a).setOrigin(0, 0));
    root.add(s.add.rectangle(12, 116, Math.round(mw * o.meter), 8, TONE_FILL[tone]).setOrigin(0, 0));
  }
  if (o.hint) root.add(txt(s, cx, 132, o.hint, { size: FS.sm, color: '#5A4A2A', origin: [0.5, 0], wrap: w - 12, align: 'center' }));
  if (o.disabled) root.setAlpha(0.45);
  const focus = (on: boolean) => {
    bg.setFillStyle(on ? FOCUS_FILL : TILE_FILL).setStrokeStyle(on ? 4 : 2, on ? COLORS.gold : 0xc9a86a);
    root.setY(on ? y - 4 : y);
  };
  return { root, bg, focus };
}

/** `count` copies of the option's icon (or glyph) centred on `cx`; one copy and "×n" when they do not fit. */
function iconRow(s: Phaser.Scene, o: ModalOption, cx: number, cy: number, maxW: number): Phaser.GameObjects.Container {
  const row = s.add.container(cx, cy);
  const n = o.count ?? 0;
  if (n === 0 || (!o.icon && !o.glyph)) return row;
  const copies = n * ICON_STEP <= maxW ? n : 1;
  const left = -Math.round(((copies - 1) * ICON_STEP) / 2) - (copies < n ? 14 : 0);
  for (let k = 0; k < copies; k++) row.add(iconAt(s, o, left + k * ICON_STEP));
  if (copies < n) row.add(txt(s, left + 20, 0, `×${n}`, { size: FS.lg, bold: true, color: HEX.ink, origin: [0, 0.5] }));
  return row;
}

function iconAt(s: Phaser.Scene, o: ModalOption, x: number): Phaser.GameObjects.GameObject {
  if (o.icon) return addImg(s, x, 0, o.icon).setScale(ICON_SCALE);
  const box = s.add.container(x, 0, [s.add.rectangle(0, 0, 28, 28, 0xd8c49a).setStrokeStyle(2, COLORS.ink)]);
  box.add(txt(s, 0, 0, o.glyph!, { size: FS.lg, bold: true, color: HEX.ink, origin: [0.5, 0.5] }));
  return box;
}
