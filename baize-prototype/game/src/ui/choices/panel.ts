// Parts every choice layout shares: the parchment frame with its title tab, where it sits on screen,
// the headline / facts / desc header and the key-help footer.
import Phaser from 'phaser';
import { H, W, type Rect } from '../layout';
import { COLORS, FS, HEX, txt } from '../theme';
import type { Fact, ModalSpec, Tone } from './spec';

export const EDGE = 8;

/** A drawn layout: its layer, and (for layouts with a focus ring) how to move the ring. */
export interface Sheet {
  layer: Phaser.GameObjects.Container;
  highlight?: (id: string) => void;
}

/** `pick` answers with an option; `hover` moves the focus to it. */
export type SheetBuilder = (s: Phaser.Scene, spec: ModalSpec, pick: (id: string) => void, hover: (id: string) => void) => Sheet;

/** Text colours that read on parchment. */
export const TONE_HEX: Record<Tone, string> = { good: '#2F7A3A', gold: '#A8742A', bad: '#B8323A', dim: '#8A7A5A' };
export const TONE_FILL: Record<Tone, number> = { good: 0x2f7a3a, gold: 0xa8742a, bad: 0xb8323a, dim: 0x8a7a5a };

/** Left edge for a `pw`-wide panel: centred, unless that covers `avoid`, then pushed to the far side. */
export function placeX(pw: number, py: number, ph: number, avoid: Rect | undefined, side: boolean): number {
  const centred = Math.round((W - pw) / 2);
  if (!avoid) return side ? W - pw - EDGE : centred;
  const ax = avoid.x + avoid.w / 2;
  const far = ax < W / 2 ? W - pw - EDGE : EDGE;
  if (side) return far;
  const hits = avoid.x < centred + pw && avoid.x + avoid.w > centred && avoid.y < py + ph && avoid.y + avoid.h > py;
  return hits ? far : centred;
}

/** Parchment panel with a gold border and the title tab on its top edge; `dim` darkens the screen behind. */
export function modalFrame(s: Phaser.Scene, title: string, px: number, py: number, pw: number, ph: number, dim: boolean): Phaser.GameObjects.Container {
  const layer = s.add.container(0, 0).setDepth(10000);
  if (dim) layer.add(s.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0).setInteractive());
  layer.add(s.add.rectangle(px, py, pw, ph, COLORS.parchment).setOrigin(0, 0).setStrokeStyle(4, COLORS.gold).setInteractive());
  layer.add(s.add.rectangle(px + 4, py + 4, pw - 8, ph - 8).setOrigin(0, 0).setStrokeStyle(1, 0xc9a86a));
  layer.add(s.add.rectangle(px + pw / 2, py + 2, Math.min(pw - 40, 300), 28, 0x3f8a4f).setStrokeStyle(2, COLORS.outline));
  layer.add(txt(s, px + pw / 2, py + 2, title, { size: FS.md, bold: true, color: HEX.parchment, origin: [0.5, 0.5] }));
  return layer;
}

/** Headline, facts strip and desc stacked downwards, centred on x = 0. Place the container once the panel is sized. */
export function header(s: Phaser.Scene, spec: ModalSpec, wrap: number): { box: Phaser.GameObjects.Container; h: number } {
  const box = s.add.container(0, 0);
  let y = 0;
  if (spec.headline) {
    const t = txt(s, 0, y, spec.headline, { size: FS.xl, bold: true, color: HEX.ink, origin: [0.5, 0] });
    box.add(t);
    y += Math.ceil(t.height) + 6;
  }
  if (spec.facts?.length) {
    box.add(factStrip(s, spec.facts, y));
    y += CHIP_H + 6;
  }
  if (spec.desc) {
    const t = txt(s, 0, y, spec.desc, { size: FS.sm, color: HEX.ink, origin: [0.5, 0], wrap, align: 'center', lineSpacing: 3 });
    box.add(t);
    y += Math.ceil(t.height) + 6;
  }
  return { box, h: y };
}

const CHIP_H = 22;

/** One row of "label value" chips, centred on x = 0. */
function factStrip(s: Phaser.Scene, facts: Fact[], y: number): Phaser.GameObjects.GameObject[] {
  const gap = 8;
  const chips = facts.map((f) => {
    const label = txt(s, 0, 0, f.label, { size: FS.sm, color: '#5A4A2A' });
    const value = txt(s, 0, 0, f.value, { size: FS.sm, bold: true, color: TONE_HEX[f.tone ?? 'dim'] });
    return { label, value, w: Math.ceil(label.width + 6 + value.width) + 16 };
  });
  const total = chips.reduce((a, c) => a + c.w, 0) + gap * (chips.length - 1);
  let x = -Math.round(total / 2);
  const parts: Phaser.GameObjects.GameObject[] = [];
  for (const c of chips) {
    parts.push(s.add.rectangle(x, y, c.w, CHIP_H, 0xe8d9b4).setOrigin(0, 0).setStrokeStyle(1, 0xc9a86a));
    c.label.setPosition(x + 8, y + Math.round((CHIP_H - c.label.height) / 2));
    c.value.setPosition(Math.round(x + 8 + c.label.width + 6), y + Math.round((CHIP_H - c.value.height) / 2));
    parts.push(c.label, c.value);
    x += c.w + gap;
  }
  return parts;
}

/** "数字键 选择 · ←→ 切换 · 空格 确认 · Esc 取消" — Esc only when the engine lets you back out. */
export function keyHelp(s: Phaser.Scene, spec: ModalSpec, cx: number, y: number): Phaser.GameObjects.Text {
  const esc = spec.cancelId || spec.closable ? ' · Esc 取消' : '';
  return txt(s, cx, y, `数字键 选择 · ←→ 切换 · 空格 确认${esc}`, { size: FS.xs, color: '#A89A7A', origin: [0.5, 0.5] });
}
