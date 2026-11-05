// 战报: a one-line ticker floating at the bottom-left, and an expanded, scrollable overlay in the
// screen centre toggled with L or a click.
import Phaser from 'phaser';
import { H, LEFT, W } from './layout';
import { COLORS, FLOAT_ALPHA, FS, HEX, txt } from './theme';

const MAX_ENTRIES = 300;
const WHEEL_PX = 34;
const OVERLAY = { x: W / 2 - 330, y: 40, w: 660, h: H - 80 };
const TEXT_TOP = OVERLAY.y + 40;
const TEXT_BOTTOM = OVERLAY.y + OVERLAY.h - 16;

export class LogPanel {
  private latest: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Text;
  private thumb: Phaser.GameObjects.Rectangle;
  private entries: string[] = [];
  /** Each entry, pre-wrapped to the overlay width. */
  private wrapped: string[][] = [];
  /** Rows scrolled up from the newest line; 0 = stuck to the bottom. */
  private scroll = 0;
  private rows: number;
  private wheel = 0;

  constructor(scene: Phaser.Scene) {
    const s = scene;
    const x = LEFT.x;
    const y = LEFT.tickerY;
    const h = LEFT.tickerH;
    s.add.rectangle(x, y, LEFT.w, h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.toggle());
    txt(s, x + 8, y + h / 2, '战报', { size: FS.sm, bold: true, color: HEX.gold, origin: [0, 0.5] });
    this.latest = txt(s, x + 44, y + h / 2, '', { size: FS.sm, origin: [0, 0.5] });

    const o = OVERLAY;
    const bg = s.add.rectangle(o.x, o.y, o.w, o.h, COLORS.ink, 0.95).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold).setInteractive();
    bg.on('pointerdown', () => this.toggle());
    const title = txt(s, o.x + 16, o.y + 12, '战报 · 滚轮翻看 · L / Esc / 点击关闭', { size: FS.md, bold: true, color: HEX.gold });
    this.body = txt(s, o.x + 16, TEXT_TOP, 'x', { size: FS.md, wrap: o.w - 44, lineSpacing: 4 });
    const one = this.body.height;
    const rowH = this.body.setText('x\nx').height - one;
    this.rows = 1 + Math.floor((TEXT_BOTTOM - TEXT_TOP - one) / rowH);
    this.body.setText('');
    const track = s.add.rectangle(o.x + o.w - 14, TEXT_TOP, 6, TEXT_BOTTOM - TEXT_TOP, COLORS.outline).setOrigin(0, 0);
    this.thumb = s.add.rectangle(o.x + o.w - 13, TEXT_TOP, 4, 10, COLORS.dim).setOrigin(0, 0);
    this.overlay = s.add.container(0, 0, [bg, title, this.body, track, this.thumb]).setDepth(9600).setVisible(false);
    s.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.overlay.visible) return;
      this.wheel += dy;
      const n = Math.trunc(this.wheel / WHEEL_PX);
      if (n === 0) return;
      this.wheel -= n * WHEEL_PX;
      this.scroll -= n;
      this.renderOverlay();
    });
  }

  get isOpen(): boolean {
    return this.overlay.visible;
  }

  toggle(open = !this.overlay.visible): void {
    this.overlay.setVisible(open);
    this.scroll = 0;
    if (open) this.renderOverlay();
  }

  log(line: string): void {
    this.entries.push(line);
    this.wrapped.push(this.body.getWrappedText(line));
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
      this.wrapped.shift();
    }
    this.latest.setText(ellipsize(this.latest, line, LEFT.w - 52));
    if (this.overlay.visible) {
      if (this.scroll > 0) this.scroll += this.wrapped[this.wrapped.length - 1].length;
      this.renderOverlay();
    }
  }

  private renderOverlay(): void {
    const all = this.wrapped.flat();
    const maxScroll = Math.max(0, all.length - this.rows);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, maxScroll);
    const end = all.length - this.scroll;
    this.body.setText(all.slice(Math.max(0, end - this.rows), end).join('\n'));
    this.thumb.setVisible(maxScroll > 0);
    if (maxScroll > 0) {
      const track = TEXT_BOTTOM - TEXT_TOP;
      const h = Math.max(10, (track * this.rows) / all.length);
      this.thumb.setSize(4, h).setY(TEXT_TOP + (track - h) * (1 - this.scroll / maxScroll));
    }
  }
}

/** Cut `line` to one row of `width` px, ending in "…". */
function ellipsize(t: Phaser.GameObjects.Text, line: string, width: number): string {
  const one = line.replace(/\n/g, ' ');
  if (t.context.measureText(one).width <= width) return one;
  let n = one.length;
  while (n > 1 && t.context.measureText(`${one.slice(0, n)}…`).width > width) n--;
  return `${one.slice(0, n)}…`;
}
