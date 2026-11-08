import Phaser from 'phaser';
import { sound } from '../audio/Sound';
import { COLORS, HEX, txt } from './theme';

/** Fade the camera out, then switch scenes. Interrupts a running fade-in; repeat calls during the fade-out are ignored. */
export function fadeToScene(scene: Phaser.Scene, key: string, data?: object, ms = 280): void {
  const cam = scene.cameras.main;
  if (cam.fadeEffect.isRunning && cam.fadeEffect.direction) return;
  sound.cue('confirm');
  cam.fade(ms, 15, 14, 26, true);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
}

export interface ButtonOpts {
  w: number;
  h: number;
  label: string;
  size?: number;
  fill?: number;
  textColor?: string;
  hint?: string;
  hintColor?: string;
}

/** Rectangle button with hover/disabled states. Origin top-left. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private enabled = true;
  private fill: number;
  private handler: (() => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, o: ButtonOpts) {
    super(scene, x, y);
    this.fill = o.fill ?? COLORS.panelLight;
    this.bg = scene.add.rectangle(0, 0, o.w, o.h, this.fill).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline);
    const hasHint = !!o.hint;
    const size = o.size ?? 14;
    this.label = txt(scene, o.w / 2, hasHint ? o.h / 2 - Math.max(8, size * 0.45) : o.h / 2, o.label, {
      size, color: o.textColor ?? HEX.parchment, origin: [0.5, 0.5], bold: true,
    });
    this.add([this.bg, this.label]);
    if (hasHint) {
      this.hintText = txt(scene, o.w / 2, 0, o.hint!, { size: 11, color: o.hintColor ?? HEX.dim, origin: [0.5, 0], wrap: o.w - 12, align: 'center' });
      this.add(this.hintText);
      // Stack label over hint and centre the pair, so a hint that wraps to two lines never covers the label.
      const top = (o.h - this.label.height - this.hintText.height) / 2;
      this.label.setY(top + this.label.height / 2);
      this.hintText.setY(top + this.label.height);
    }
    this.setSize(o.w, o.h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', () => { if (this.enabled) this.bg.setStrokeStyle(2, COLORS.gold); });
    this.bg.on('pointerout', () => this.bg.setStrokeStyle(2, COLORS.outline));
    this.bg.on('pointerdown', () => { if (this.enabled && this.handler) this.handler(); });
    scene.add.existing(this);
  }

  onClick(fn: () => void): this {
    this.handler = fn;
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.bg.setFillStyle(on ? this.fill : COLORS.disabled);
    this.label.setAlpha(on ? 1 : 0.45);
    this.hintText?.setAlpha(on ? 1 : 0.45);
    return this;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setLabel(s: string): this {
    this.label.setText(s);
    return this;
  }

  /** Swap the enabled fill. A disabled button picks this up the next time it is enabled. */
  setFill(fill: number): this {
    this.fill = fill;
    if (this.enabled) this.bg.setFillStyle(fill);
    return this;
  }

  press(): void {
    if (this.enabled && this.handler) this.handler();
  }
}
