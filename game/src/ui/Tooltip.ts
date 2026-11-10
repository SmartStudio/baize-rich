import Phaser from 'phaser';
import { addImg } from './assets';
import { H, W, type Rect } from './layout';
import { COLORS, FS, HEX, txt } from './theme';
import { Button } from './widgets';

export interface TipContent {
  title: string;
  body: string;
  /** Icon frames shown in a row under the title (神通…), each with a caption. */
  icons?: { frame: string; label: string }[];
  /** One button at the bottom (e.g. 施放 a hand card). */
  action?: { label: string; onClick: () => void };
}

const TIP_W = 280;
const PAD = 10;
const MARGIN = 6;
const ICON = 28;

/**
 * One shared popover per scene, placed beside its anchor rect and clamped to the canvas.
 * Hover shows it transiently; `toggle` pins it until the same key is toggled again, Esc, or a
 * click on empty HUD space.
 */
export class Tooltip {
  private layer: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private body: Phaser.GameObjects.Text;
  private extras: Phaser.GameObjects.GameObject[] = [];
  private pinnedKey: string | null = null;
  /** Key closed by an empty-space click this frame. The board scene sits below the HUD and hears
   * the same click later, so re-toggling that key in the same frame means "close", not "reopen". */
  private closedKey: string | null = null;
  private closedFrame = -1;

  constructor(private scene: Phaser.Scene) {
    this.bg = scene.add.rectangle(0, 0, TIP_W, 10, COLORS.ink, 0.96).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold).setInteractive();
    this.title = txt(scene, PAD, PAD, '', { size: FS.md, color: HEX.gold, bold: true, wrap: TIP_W - 2 * PAD });
    this.body = txt(scene, PAD, PAD + 20, '', { size: FS.sm, wrap: TIP_W - 2 * PAD, lineSpacing: 3 });
    this.layer = scene.add.container(0, 0, [this.bg, this.title, this.body]).setDepth(9500).setVisible(false);
    scene.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length !== 0 || !this.pinnedKey) return;
      this.closedKey = this.pinnedKey;
      this.closedFrame = scene.game.loop.frame;
      this.unpin();
    });
  }

  get pinned(): string | null {
    return this.pinnedKey;
  }

  /** True while `key` is the popover an empty-space click closed this very frame. */
  justClosed(key: string): boolean {
    return this.closedKey === key && this.closedFrame === this.scene.game.loop.frame;
  }

  /** Make `rect` (screen coords) a hover zone; `content` is evaluated on every hover so it reflects the latest state. */
  attach(x: number, y: number, w: number, h: number, content: () => TipContent | null): Phaser.GameObjects.Zone {
    const zone = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive();
    zone.on('pointerover', () => {
      const c = content();
      if (c) this.show({ x, y, w, h }, c);
    });
    zone.on('pointerout', () => this.hide());
    return zone;
  }

  /** Transient show; ignored while something is pinned. */
  show(anchor: Rect, c: TipContent): void {
    if (this.pinnedKey) return;
    this.render(anchor, c);
  }

  hide(): void {
    if (!this.pinnedKey) this.layer.setVisible(false);
  }

  /** Pin `c` open, or close it if `key` is already pinned. */
  toggle(key: string, anchor: Rect, c: TipContent): void {
    if (this.pinnedKey === key) {
      this.unpin();
      return;
    }
    if (this.justClosed(key)) return;
    this.pinnedKey = key;
    this.render(anchor, c);
  }

  unpin(): void {
    this.pinnedKey = null;
    this.layer.setVisible(false);
  }

  private render(anchor: Rect, c: TipContent): void {
    for (const o of this.extras) o.destroy();
    this.extras = [];
    this.title.setText(c.title);
    let y = PAD + this.title.height + 6;
    if (c.icons?.length) {
      const colW = (TIP_W - 2 * PAD) / c.icons.length;
      c.icons.forEach((ic, i) => {
        const cx = PAD + colW * i + colW / 2;
        const img = addImg(this.scene, cx, y, ic.frame).setOrigin(0.5, 0);
        img.setScale(ICON / Math.max(img.width, img.height));
        const cap = txt(this.scene, cx, y + ICON + 2, ic.label, { size: FS.xs, color: HEX.parchment, origin: [0.5, 0] });
        this.extras.push(img, cap);
      });
      y += ICON + 18;
    }
    this.body.setText(c.body).setY(y);
    y += c.body ? this.body.height + PAD : 0;
    if (c.action) {
      const a = c.action;
      const btn = new Button(this.scene, PAD, y, { w: TIP_W - 2 * PAD, h: 30, label: a.label, size: FS.md, fill: COLORS.gold, textColor: HEX.ink });
      btn.onClick(() => { this.unpin(); a.onClick(); });
      this.extras.push(btn);
      y += 30 + PAD;
    }
    this.layer.add(this.extras);
    const h = Math.max(y, PAD * 2 + this.title.height);
    this.bg.setSize(TIP_W, h);
    this.bg.input?.hitArea.setSize(TIP_W, h);
    // Open toward the middle of the screen, so a tip never lands on the HUD in the opposite margin.
    const toRight = anchor.x + anchor.w / 2 < W / 2;
    let x = toRight ? anchor.x + anchor.w + MARGIN : anchor.x - TIP_W - MARGIN;
    x = Phaser.Math.Clamp(x, MARGIN, W - TIP_W - MARGIN);
    const top = Phaser.Math.Clamp(anchor.y, MARGIN, H - h - MARGIN);
    this.layer.setPosition(x, top).setVisible(true);
  }
}
