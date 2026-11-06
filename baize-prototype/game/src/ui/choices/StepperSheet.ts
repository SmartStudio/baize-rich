// 'stepper' layout: one big button for the focused amount (the default is the most), − / + to take fewer,
// and the cancel option as a small button beside them. Used where the answer is "how many" and the most is
// almost always right (丹房 炼丹).
import type Phaser from 'phaser';
import { H } from '../layout';
import { COLORS, FS, HEX, txt } from '../theme';
import { Button } from '../widgets';
import { header, keyHelp, modalFrame, placeX, TONE_HEX, type SheetBuilder } from './panel';
import type { ModalOption } from './spec';

const PW = 420;
const BIG_W = 300;
const BIG_H = 92;
const STEP = 40;
const ROW_H = 32;

export const buildStepper: SheetBuilder = (s, spec, pick, hover) => {
  const steps = spec.options.filter((o) => o.id !== spec.cancelId && !o.disabled);
  const cancel = spec.options.find((o) => o.id === spec.cancelId);
  const head = header(s, spec, PW - 48);
  const ph = 34 + head.h + BIG_H + 12 + ROW_H + 40;
  const py = Math.round((H - ph) / 2);
  const px = placeX(PW, py, ph, spec.avoid, false);
  const layer = modalFrame(s, spec.title, px, py, PW, ph, true);
  layer.add(head.box.setPosition(Math.round(px + PW / 2), py + 30));
  const bigX = Math.round(px + (PW - BIG_W) / 2);
  const big = bigButton(s, bigX, py + 34 + head.h);
  const rowY = py + 34 + head.h + BIG_H + 12;
  const at = (id: string) => steps.findIndex((o) => o.id === id);
  let focus = steps.at(-1)!;
  const minus = new Button(s, bigX, rowY, { w: STEP, h: ROW_H, label: '−', size: FS.lg }).onClick(() => hover(steps[Math.max(0, at(focus.id) - 1)].id));
  const plus = new Button(s, bigX + STEP + 4, rowY, { w: STEP, h: ROW_H, label: '+', size: FS.lg }).onClick(() => hover(steps[Math.min(steps.length - 1, at(focus.id) + 1)].id));
  layer.add([big.root, minus, plus]);
  big.bg.on('pointerdown', () => pick(focus.id));
  if (cancel) {
    const w = BIG_W - 2 * STEP - 12;
    layer.add(new Button(s, bigX + BIG_W - w, rowY, { w, h: ROW_H, label: `${cancel.label} · Esc`, size: FS.sm }).onClick(() => pick(cancel.id)));
  }
  layer.add(keyHelp(s, spec, Math.round(px + PW / 2), py + ph - 16));
  const highlight = (id: string): void => {
    const i = at(id);
    if (i < 0) return;
    focus = steps[i];
    big.show(focus);
    minus.setEnabled(i > 0);
    plus.setEnabled(i < steps.length - 1);
  };
  return { layer, highlight, steps: steps.map((o) => o.id) };
};

function bigButton(s: Phaser.Scene, x: number, y: number) {
  const bg = s.add.rectangle(0, 0, BIG_W, BIG_H, COLORS.gold).setOrigin(0, 0).setStrokeStyle(3, COLORS.ink).setInteractive({ useHandCursor: true });
  const label = txt(s, BIG_W / 2, 10, '', { size: FS.xl, bold: true, color: HEX.ink, origin: [0.5, 0] });
  const gain = txt(s, BIG_W / 2, 44, '', { size: FS.lg, bold: true, color: TONE_HEX.good, origin: [0.5, 0] });
  const hint = txt(s, BIG_W / 2, 68, '', { size: FS.sm, color: '#5A4A2A', origin: [0.5, 0] });
  const root = s.add.container(x, y, [bg, label, gain, hint]);
  bg.on('pointerover', () => bg.setStrokeStyle(3, COLORS.parchment));
  bg.on('pointerout', () => bg.setStrokeStyle(3, COLORS.ink));
  const show = (o: ModalOption): void => {
    label.setText(o.label);
    gain.setText(o.big ?? '');
    hint.setText(o.hint ?? '');
  };
  return { root, bg, show };
}
