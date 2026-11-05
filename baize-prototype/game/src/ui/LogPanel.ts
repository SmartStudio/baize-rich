// 战报: a collapsed ticker (newest line bright, the one before it dim) at the bottom of the left
// column, and an expanded, scrollable overlay over the board toggled with L or a click.
import Phaser from 'phaser';
import { BOARD, LEFT } from './layout';
import { COLORS, HEX, panel, txt } from './theme';

const MAX_ENTRIES = 300;
const WHEEL_PX = 34;
const OVERLAY = { x: BOARD.x + 36, y: BOARD.y + 36, w: BOARD.size - 72, h: BOARD.size - 72 };
const TEXT_TOP = OVERLAY.y + 40;
const TEXT_BOTTOM = OVERLAY.y + OVERLAY.h - 16;

export class LogPanel {
  private prev: Phaser.GameObjects.Text;
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
    const y = LEFT.logY;
    panel(s, x, y, LEFT.w, LEFT.logH).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.toggle());
    txt(s, x + 10, y + 6, '战报', { size: 12, bold: true, color: HEX.gold });
    txt(s, x + LEFT.w - 10, y + 6, 'L 展开全部', { size: 11, color: HEX.dim, origin: [1, 0] });
    this.prev = txt(s, x + 10, y + 26, '', { size: 11, color: HEX.dim, wrap: LEFT.w - 20 });
    this.latest = txt(s, x + 10, y + 48, '', { size: 13, wrap: LEFT.w - 20, lineSpacing: 2 });

    const o = OVERLAY;
    const bg = s.add.rectangle(o.x, o.y, o.w, o.h, COLORS.ink, 0.95).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold).setInteractive();
    bg.on('pointerdown', () => this.toggle());
    const title = txt(s, o.x + 16, o.y + 12, '战报 · 滚轮翻看 · L / Esc / 点击关闭', { size: 14, bold: true, color: HEX.gold });
    this.body = txt(s, o.x + 16, TEXT_TOP, 'x', { size: 13, wrap: o.w - 44, lineSpacing: 4 });
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
    const n = this.entries.length;
    this.prev.setText(n > 1 ? this.entries[n - 2] : '');
    this.latest.setText(this.entries[n - 1]);
    // the dim line only gets one row; the newest line keeps up to two
    if (this.prev.getWrappedText().length > 1) this.prev.setText(`${this.prev.getWrappedText()[0]}…`);
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
