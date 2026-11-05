// Transient, tween-only overlays in screen space (built on the HUD scene): full-width cutscene
// banners for big events, the round / turn ribbons, and the dice roll. Callers pass durations that
// are already scaled by the play speed.
import Phaser from 'phaser';
import { addImg, setFrame } from './assets';
import { H, STAGE, W } from './layout';
import { COLORS, FS, HEX, txt } from './theme';

export interface BannerSpec {
  title: string;
  sub: string;
  /** Frame shown left of the title: a hero portrait, 'demon', 'baize'… */
  icon: string;
  color: number;
}

const DEPTH = 9900;

export class Cutscene {
  constructor(private scene: Phaser.Scene) {}

  /** Full-width strip across the screen centre; resolves when it has gone. */
  banner(spec: BannerSpec, ms: number): Promise<void> {
    const s = this.scene;
    const cy = STAGE.cy;
    const h = 130;
    const dim = s.add.rectangle(0, 0, W, H, 0x000000, 0.35).setOrigin(0, 0);
    const strip = s.add.rectangle(0, cy, W, h, COLORS.ink, 0.94).setOrigin(0, 0.5);
    const edgeT = s.add.rectangle(0, cy - h / 2, W, 4, spec.color).setOrigin(0, 0.5);
    const edgeB = s.add.rectangle(0, cy + h / 2, W, 4, spec.color).setOrigin(0, 0.5);
    const icon = addImg(s, 0, 0, spec.icon).setOrigin(0.5, 0.5);
    icon.setScale(Math.min(96 / icon.width, 96 / icon.height));
    const title = txt(s, 76, -14, spec.title, { size: FS.hero, bold: true, color: Phaser.Display.Color.IntegerToColor(spec.color).rgba, stroke: HEX.ink, origin: [0, 0.5] });
    const sub = txt(s, 78, 28, spec.sub, { size: FS.md, color: HEX.parchment, origin: [0, 0.5], wrap: 640 });
    const contentW = 76 + Math.max(title.width, sub.width);
    const content = s.add.container(W / 2 - contentW / 2 + 30, cy, [icon, title, sub]);
    const layer = s.add.container(0, 0, [dim, strip, edgeT, edgeB, content]).setDepth(DEPTH);
    const inMs = Math.min(180, ms * 0.2);
    const outMs = Math.min(220, ms * 0.2);
    strip.setScale(1, 0);
    content.setAlpha(0).setX(content.x - 120);
    dim.setAlpha(0);
    s.tweens.add({ targets: strip, scaleY: 1, duration: inMs, ease: 'Back.easeOut' });
    s.tweens.add({ targets: dim, alpha: 1, duration: inMs });
    s.tweens.add({ targets: content, alpha: 1, x: content.x + 120, duration: inMs * 1.4, ease: 'Cubic.easeOut' });
    s.tweens.add({ targets: icon, scale: icon.scale * 1.12, duration: ms * 0.3, delay: inMs, yoyo: true, ease: 'Sine.easeInOut' });
    return new Promise((res) => {
      s.tweens.add({
        targets: layer, alpha: 0, x: 60, duration: outMs, delay: ms - outMs, ease: 'Cubic.easeIn',
        onComplete: () => { layer.destroy(); res(); },
      });
    });
  }

  /** A ribbon across the top half of the screen (round start, AI turn start). Does not block. */
  ribbon(text: string, sub: string, color: number, y: number, ms: number): void {
    const s = this.scene;
    const w = 380;
    const bg = s.add.rectangle(0, 0, w, sub ? 60 : 38, COLORS.ink, 0.92).setStrokeStyle(3, color);
    const t = txt(s, 0, sub ? -9 : 0, text, { size: sub ? FS.xl : FS.lg, bold: true, color: Phaser.Display.Color.IntegerToColor(color).rgba, stroke: HEX.ink, origin: [0.5, 0.5] });
    const parts: Phaser.GameObjects.GameObject[] = [bg, t];
    if (sub) parts.push(txt(s, 0, 17, sub, { size: FS.sm, color: HEX.parchment, origin: [0.5, 0.5] }));
    const c = s.add.container(W / 2, y, parts).setDepth(DEPTH - 1).setAlpha(0).setScale(0.85);
    s.tweens.add({ targets: c, alpha: 1, scale: 1, duration: Math.min(160, ms * 0.25), ease: 'Back.easeOut' });
    s.tweens.add({ targets: c, alpha: 0, y: y - 16, duration: Math.min(220, ms * 0.3), delay: ms * 0.7, onComplete: () => c.destroy() });
  }

  /**
   * Dice tumbling near the top of the screen, landing on `d`. Resolves after they land and the sum
   * has been on screen for `hold` ms; they fade out afterwards without blocking.
   */
  rollDice(d: [number, number], ms: number, hold: number): Promise<void> {
    const s = this.scene;
    const y = STAGE.diceY;
    const dice = [-30, 30].map((dx) => addImg(s, STAGE.cx + dx, y, 'die_1').setScale(STAGE.dice).setDepth(DEPTH - 2));
    const sum = txt(s, STAGE.cx, y + 42, `${d[0]} + ${d[1]} = ${d[0] + d[1]}${d[0] === d[1] ? '  双数！' : ''}`, {
      size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5],
    }).setDepth(DEPTH - 2).setAlpha(0);
    const ticks = Math.max(2, Math.floor(ms / 60));
    let k = 0;
    return new Promise((res) => {
      s.time.addEvent({
        delay: ms / ticks, repeat: ticks - 1,
        callback: () => {
          k++;
          dice.forEach((img, i) => {
            setFrame(img, `die_${k >= ticks ? d[i] : 1 + Math.floor(Math.random() * 6)}`);
            img.setAngle(k >= ticks ? 0 : Phaser.Math.Between(-25, 25));
          });
          if (k < ticks) return;
          sum.setAlpha(1);
          s.tweens.add({ targets: [...dice, sum], alpha: 0, duration: 250, delay: hold + 500, onComplete: () => { dice.forEach((x) => x.destroy()); sum.destroy(); } });
          s.time.delayedCall(hold, res);
        },
      });
    });
  }
}
