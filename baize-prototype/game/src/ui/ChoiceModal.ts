// Generic modal used for every PendingChoice (and the 升级 / 出符 sub-menus).
//  - 'center' placement dims the screen; 'side' sits in a screen margin so the
//    board stays visible (used when options map to board nodes).
//  - `avoid` (screen rect, usually the deciding player's token): the modal moves
//    to the half of the screen away from it, so it never covers the token.
//  - 'cards' layout shows options as 神通 / 天赐 cards (frame + icon).
import Phaser from 'phaser';
import { frameRef } from './assets';
import { optionKey, type ModalOption, type ModalSpec } from './choices/spec';
import { H, RIGHT, W, type Rect } from './layout';
import { COLORS, FS, HEX, txt } from './theme';
import { Button } from './widgets';

export type { ModalOption, ModalSpec };

const EDGE = 8;

/** Left edge for a `pw`-wide panel: centred, unless that covers `avoid`, then pushed to the far side. */
function placeX(pw: number, py: number, ph: number, avoid: Rect | undefined, side: boolean): number {
  const centred = Math.round((W - pw) / 2);
  if (!avoid) return side ? W - pw - EDGE : centred;
  const ax = avoid.x + avoid.w / 2;
  const far = ax < W / 2 ? W - pw - EDGE : EDGE;
  if (side) return far;
  const hits = avoid.x < centred + pw && avoid.x + avoid.w > centred && avoid.y < py + ph && avoid.y + avoid.h > py;
  return hits ? far : centred;
}

const PRIMARY = { fill: COLORS.gold, text: HEX.ink, hint: '#5A4A2A' };
const SECONDARY = { fill: 0xb4b8cc, text: HEX.ink, hint: '#4A4766' };

export class ChoiceModal {
  private layer: Phaser.GameObjects.Container | null = null;
  private resolve: ((id: string | null) => void) | null = null;
  private spec: ModalSpec | null = null;

  constructor(private scene: Phaser.Scene) {}

  get isOpen(): boolean {
    return this.layer !== null;
  }

  open(spec: ModalSpec): Promise<string | null> {
    this.close(null);
    this.spec = spec;
    if (spec.layout === 'cards') this.buildCards(spec);
    else this.buildList(spec);
    return new Promise((res) => { this.resolve = res; });
  }

  private frame(px: number, py: number, pw: number, ph: number, dim: boolean): Phaser.GameObjects.Container {
    const s = this.scene;
    const layer = s.add.container(0, 0).setDepth(10000);
    if (dim) layer.add(s.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0).setInteractive());
    layer.add(s.add.rectangle(px, py, pw, ph, COLORS.parchment).setOrigin(0, 0).setStrokeStyle(4, COLORS.gold).setInteractive());
    layer.add(s.add.rectangle(px + 4, py + 4, pw - 8, ph - 8).setOrigin(0, 0).setStrokeStyle(1, 0xc9a86a));
    layer.add(s.add.rectangle(px + pw / 2, py + 2, Math.min(pw - 40, 300), 28, 0x3f8a4f).setStrokeStyle(2, COLORS.outline));
    layer.add(txt(s, px + pw / 2, py + 2, this.spec!.title, { size: FS.md, bold: true, color: HEX.parchment, origin: [0.5, 0.5] }));
    return layer;
  }

  private buildList(spec: ModalSpec): void {
    const s = this.scene;
    const side = spec.placement === 'side';
    const n = spec.options.length + (spec.closable ? 1 : 0);
    const hasHints = spec.options.some((o) => o.hint);
    const cols = side ? (n > 12 ? 2 : 1) : n > 16 ? 3 : n > 7 ? 2 : 1;
    const previewW = spec.preview ? 148 : 0;
    const pw = side ? RIGHT.w + 16 : (cols === 1 ? 460 : cols === 2 ? 620 : 760) + previewW;
    const gap = 6;
    const rows = Math.ceil(n / cols);
    const descText = spec.desc ? txt(s, 0, 0, spec.desc, { size: FS.sm, color: HEX.ink, wrap: pw - 28 - previewW, lineSpacing: 3 }) : null;
    const descH = descText ? Math.ceil(descText.height) + 10 : 0;
    const footH = side ? 0 : 18;
    const maxPh = side ? H - 2 * EDGE - 40 : H - 40;
    const fitBh = Math.floor((maxPh - 60 - footH - descH) / rows) - gap;
    const bw = (pw - 28 - previewW - (cols - 1) * gap) / cols;
    const hintH = Math.max(0, ...spec.options.map((o) => (o.hint ? measure(s, o.hint, bw - 12) : 0)));
    const bh = Math.max(hasHints ? 40 : 20, Math.min(hasHints ? Math.max(46, 30 + hintH) : side && n > 12 ? 26 : 32, fitBh));
    const compact = bh < 30;
    const bodyH = Math.max(descH + rows * (bh + gap), spec.preview ? 136 : 0);
    const ph = Math.min(maxPh, 44 + bodyH + 16 + footH);
    const py = side ? Math.max(40 + EDGE, H - EDGE - ph) : Math.round((H - ph) / 2);
    const px = placeX(pw, py, ph, spec.avoid, side);
    const layer = this.frame(px, py, pw, ph, !side);
    const cx = px + 14 + previewW;
    if (spec.preview) {
      layer.add(s.add.rectangle(px + 14, py + 32, 132, 132, COLORS.ink).setOrigin(0, 0));
      const [tk, tf] = frameRef(s, spec.preview.tile);
      layer.add(s.add.image(px + 16, py + 34, tk, tf).setOrigin(0, 0).setScale(2));
      if (spec.preview.obj) {
        const [ok, of] = frameRef(s, spec.preview.obj);
        layer.add(s.add.image(px + 80, py + 130, ok, of).setOrigin(0.5, 1).setScale(2));
      }
    }
    if (descText) layer.add(descText.setPosition(cx, py + 30));
    const all: ModalOption[] = [...spec.options];
    if (spec.closable) all.push({ id: '__close', label: '返回' });
    all.forEach((o, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const bx = cx + c * (bw + gap);
      const by = py + 32 + descH + r * (bh + gap);
      const key = o.id === '__close' || spec.numbered === false ? null : optionKey(o, i);
      const num = key ? `${key}. ` : '';
      const style = o.id === spec.defaultId ? PRIMARY : SECONDARY;
      const btn = new Button(s, bx, by, {
        w: bw, h: bh, label: (o.icon ? '    ' : '') + num + o.label, hint: o.hint, size: compact ? FS.xs : FS.sm,
        fill: style.fill, textColor: style.text, hintColor: style.hint,
      });
      btn.onClick(() => this.close(o.id === '__close' ? null : o.id));
      layer.add(btn);
      if (o.icon) {
        const [key, frame] = frameRef(s, o.icon);
        layer.add(s.add.image(bx + 18, by + bh / 2, key, frame).setOrigin(0.5, 0.5));
      }
    });
    if (!side) {
      const esc = spec.cancelId || spec.closable ? '    Esc 取消' : '';
      layer.add(txt(s, px + pw / 2, py + ph - 12, `空格 确认 · 数字键 选择${esc}`, { size: FS.xs, color: '#A89A7A', origin: [0.5, 0.5] }));
    }
    this.layer = layer;
  }

  private buildCards(spec: ModalSpec): void {
    const s = this.scene;
    const n = spec.options.length;
    const cw = 160;
    const ch = 216;
    const gap = 14;
    const pw = Math.max(420, n * cw + (n - 1) * gap + 40);
    const descH = spec.desc ? 30 : 0;
    const ph = 40 + descH + ch + 82;
    const py = Math.round((H - ph) / 2);
    const px = placeX(pw, py, ph, spec.avoid, false);
    const layer = this.frame(px, py, pw, ph, true);
    if (spec.desc) layer.add(txt(s, px + pw / 2, py + 34, spec.desc, { size: FS.sm, color: HEX.ink, origin: [0.5, 0] }));
    const x0 = px + (pw - (n * cw + (n - 1) * gap)) / 2;
    const y0 = py + 36 + descH;
    spec.options.forEach((o, i) => {
      const x = x0 + i * (cw + gap);
      const [fk, ff] = frameRef(s, spec.cardFrame ?? 'card_divine');
      const card = s.add.image(x, y0, fk, ff).setOrigin(0, 0).setScale(2).setInteractive({ useHandCursor: true });
      const glow = s.add.rectangle(x - 4, y0 - 4, cw + 8, ch + 8, COLORS.gold, o.id === spec.defaultId ? 0.35 : 0).setOrigin(0, 0);
      layer.add([glow, card]);
      layer.add(txt(s, x + cw / 2, y0 + 22, spec.cardLabel ?? '', { size: FS.sm, color: '#3A5A8A', origin: [0.5, 0.5], bold: true }));
      if (o.icon) {
        const [ik, iff] = frameRef(s, o.icon);
        layer.add(s.add.image(x + cw / 2, y0 + 95, ik, iff).setScale(3));
      }
      layer.add(txt(s, x + cw / 2, y0 + 180, `${i + 1}. ${o.label}`, { size: FS.md, bold: true, color: HEX.ink, origin: [0.5, 0.5] }));
      if (o.hint) layer.add(txt(s, x + cw / 2, y0 + ch + 8, o.hint, { size: FS.sm, color: '#4A4766', origin: [0.5, 0], wrap: cw, align: 'center' }));
      card.on('pointerover', () => glow.setAlpha(0.6));
      card.on('pointerout', () => glow.setAlpha(o.id === spec.defaultId ? 0.35 : 0));
      card.on('pointerdown', () => this.close(o.id));
    });
    layer.add(txt(s, px + pw / 2, py + ph - 20, '点击卡牌或按数字键选择', { size: FS.sm, color: '#7A6A4A', origin: [0.5, 0.5] }));
    this.layer = layer;
  }

  close(id: string | null): void {
    if (!this.layer) return;
    this.layer.destroy(true);
    this.layer = null;
    const r = this.resolve;
    this.resolve = null;
    this.spec = null;
    r?.(id);
  }

  /** Keyboard handling while open. Returns true if the key was consumed. */
  handleKey(key: string): boolean {
    const spec = this.spec;
    if (!spec) return false;
    if (key === 'ESC') {
      if (spec.cancelId) this.close(spec.cancelId);
      else if (spec.closable || spec.cancelId === null) this.close(null);
      return true;
    }
    if (key === 'SPACE') {
      const id = spec.defaultId ?? spec.options[0]?.id;
      if (id) this.close(id);
      return true;
    }
    const picked = spec.options.find((o, i) => optionKey(o, i) === key);
    if (picked) this.close(picked.id);
    return !!picked;
  }
}

/** Rendered height of a button hint (size 11) wrapped at `wrap`. */
function measure(s: Phaser.Scene, text: string, wrap: number): number {
  const t = txt(s, 0, 0, text, { size: 11, wrap });
  const h = t.height;
  t.destroy();
  return h;
}
