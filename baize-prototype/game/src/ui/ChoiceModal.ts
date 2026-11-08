// The one modal every human choice opens (plus the 升级 / 出符 sub-menus). It owns the lifecycle and the
// keyboard; what it draws comes from the spec's layout:
//  - 'list': buttons. 'center' placement dims the screen; 'side' sits in a screen margin so the board
//    stays visible (used when options map to board nodes).
//  - 'tiles' (ui/choices/TileSheet) and 'cards' (ui/choices/CardSheet): dedicated screens with a focus ring.
//  - `avoid` (screen rect, usually the deciding player's token): the modal moves to the half of the
//    screen away from it, so it never covers the token.
import Phaser from 'phaser';
import { frameRef } from './assets';
import { buildCards } from './choices/CardSheet';
import { buildStepper } from './choices/StepperSheet';
import { EDGE, modalFrame, placeX, type Sheet, type SheetBuilder } from './choices/panel';
import { optionKey, type ModalLayout, type ModalOption, type ModalSpec } from './choices/spec';
import { buildTiles } from './choices/TileSheet';
import { H, RIGHT } from './layout';
import { COLORS, FS, HEX, txt } from './theme';
import type { Tooltip } from './Tooltip';
import { Button } from './widgets';

export type { ModalOption, ModalSpec };

const LAYOUTS: Record<ModalLayout, SheetBuilder> = {
  list: buildList,
  tiles: buildTiles,
  cards: buildCards,
  stepper: buildStepper,
};

export class ChoiceModal {
  private sheet: Sheet | null = null;
  private resolve: ((id: string | null) => void) | null = null;
  private spec: ModalSpec | null = null;
  /** Pickable options in screen order; Space confirms `focus`, ←→ move it where the layout draws a ring. */
  private pickable: string[] = [];
  private focus: string | null = null;

  constructor(private scene: Phaser.Scene, private tip: Tooltip) {}

  get isOpen(): boolean {
    return this.sheet !== null;
  }

  open(spec: ModalSpec): Promise<string | null> {
    // A pinned tile tip ignores the hover gate and would stay above this sheet.
    if (this.tip.pinned?.startsWith('tile:')) this.tip.unpin();
    this.close(null);
    this.spec = spec;
    this.pickable = spec.options.filter((o) => !o.disabled).map((o) => o.id);
    this.sheet = LAYOUTS[spec.layout ?? 'list'](this.scene, spec, (id) => this.close(id), (id) => this.setFocus(id));
    this.setFocus(spec.defaultId && this.pickable.includes(spec.defaultId) ? spec.defaultId : this.pickable[0] ?? null);
    return new Promise((res) => { this.resolve = res; });
  }

  close(id: string | null): void {
    if (!this.sheet) return;
    this.sheet.layer.destroy(true);
    this.sheet = null;
    const r = this.resolve;
    this.resolve = null;
    this.spec = null;
    r?.(id === '__close' ? null : id);
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
      if (this.focus) this.close(this.focus);
      return true;
    }
    const arrow = ARROWS[key];
    if (arrow && this.sheet?.highlight && this.focus) {
      const order = this.sheet.steps ?? this.pickable;
      const i = order.indexOf(this.focus) + arrow;
      this.setFocus(order[Phaser.Math.Clamp(i, 0, order.length - 1)]);
      return true;
    }
    const picked = spec.options.find((o, i) => optionKey(o, i) === key);
    if (picked) this.close(picked.id);
    return !!picked;
  }

  private setFocus(id: string | null): void {
    this.focus = id;
    if (id) this.sheet?.highlight?.(id);
  }
}

/** ←→ move the focus; − and + say the same on a stepper. */
const ARROWS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1, '-': -1, '+': 1, '=': 1 };

const PREVIEW_BOX = 132;
const PRIMARY = { fill: COLORS.gold, text: HEX.ink, hint: '#5A4A2A' };
const SECONDARY = { fill: 0xb4b8cc, text: HEX.ink, hint: '#4A4766' };

function buildList(s: Phaser.Scene, spec: ModalSpec, pick: (id: string) => void): Sheet {
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
  const layer = modalFrame(s, spec.title, px, py, pw, ph, !side);
  const cx = px + 14 + previewW;
  if (spec.preview) {
    layer.add(s.add.rectangle(px + 14, py + 32, PREVIEW_BOX, PREVIEW_BOX, COLORS.ink).setOrigin(0, 0));
    const [tk, tf] = frameRef(s, spec.preview);
    const img = s.add.image(px + 14 + PREVIEW_BOX / 2, py + 32 + PREVIEW_BOX / 2, tk, tf);
    layer.add(img.setScale(Math.max(1, Math.floor((PREVIEW_BOX - 4) / Math.max(img.width, img.height)))));
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
    btn.onClick(() => pick(o.id));
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
  return { layer };
}

/** Rendered height of a button hint (size 11) wrapped at `wrap`. */
function measure(s: Phaser.Scene, text: string, wrap: number): number {
  const t = txt(s, 0, 0, text, { size: 11, wrap });
  const h = t.height;
  t.destroy();
  return h;
}
