import Phaser from 'phaser';
import { H, W } from './layout';
import { COLORS, HEX, txt } from './theme';

export interface TipContent {
  title: string;
  body: string;
}

const TIP_W = 260;
const PAD = 8;
const MARGIN = 6;

/** One shared hover tooltip per scene; placed beside the hovered rect and clamped to the 1280×720 canvas. */
export class Tooltip {
  private layer: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private body: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {
    this.bg = scene.add.rectangle(0, 0, TIP_W, 10, COLORS.ink, 0.96).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    this.title = txt(scene, PAD, PAD, '', { size: 13, color: HEX.gold, bold: true, wrap: TIP_W - 2 * PAD });
    this.body = txt(scene, PAD, PAD + 20, '', { size: 12, wrap: TIP_W - 2 * PAD, lineSpacing: 3 });
    this.layer = scene.add.container(0, 0, [this.bg, this.title, this.body]).setDepth(9500).setVisible(false);
  }

  /** Make `rect` (canvas coords) a hover zone; `content` is evaluated on every hover so it reflects the latest state. */
  attach(x: number, y: number, w: number, h: number, content: () => TipContent | null): Phaser.GameObjects.Zone {
    const zone = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive();
    zone.on('pointerover', () => {
      const c = content();
      if (c) this.show({ x, y, w, h }, c);
    });
    zone.on('pointerout', () => this.hide());
    return zone;
  }

  show(anchor: { x: number; y: number; w: number; h: number }, c: TipContent): void {
    this.title.setText(c.title);
    this.body.setText(c.body).setY(PAD + this.title.height + 4);
    const h = this.body.y + this.body.height + PAD;
    this.bg.setSize(TIP_W, h);
    let x = anchor.x + anchor.w + MARGIN;
    if (x + TIP_W > W - MARGIN) x = anchor.x - TIP_W - MARGIN;
    x = Phaser.Math.Clamp(x, MARGIN, W - TIP_W - MARGIN);
    const y = Phaser.Math.Clamp(anchor.y, MARGIN, H - h - MARGIN);
    this.layer.setPosition(x, y).setVisible(true);
  }

  hide(): void {
    this.layer.setVisible(false);
  }
}
