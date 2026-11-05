// Transient, tween-only overlays: full-width cutscene banners for big events, the round / turn
// ribbons over the board, and the big dice roll in the board centre. Callers pass durations that
// are already scaled by the play speed.
import Phaser from 'phaser';
import { addImg, setFrame } from './assets';
import { BOARD, BOARD_CENTER, W } from './layout';
import { COLORS, HEX, txt } from './theme';

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
    const cy = BOARD_CENTER.y;
    const h = 150;
    const dim = s.add.rectangle(0, 0, W, 720, 0x000000, 0.35).setOrigin(0, 0);
    const strip = s.add.rectangle(0, cy, W, h, COLORS.ink, 0.94).setOrigin(0, 0.5);
    const edgeT = s.add.rectangle(0, cy - h / 2, W, 4, spec.color).setOrigin(0, 0.5);
    const edgeB = s.add.rectangle(0, cy + h / 2, W, 4, spec.color).setOrigin(0, 0.5);
    const icon = addImg(s, 0, 0, spec.icon).setOrigin(0.5, 0.5);
    icon.setScale(Math.min(120 / icon.width, 120 / icon.height));
    const title = txt(s, 90, -16, spec.title, { size: 44, bold: true, color: Phaser.Display.Color.IntegerToColor(spec.color).rgba, stroke: HEX.ink, origin: [0, 0.5] });
    const sub = txt(s, 92, 32, spec.sub, { size: 16, color: HEX.parchment, origin: [0, 0.5], wrap: 640 });
    const contentW = 90 + Math.max(title.width, sub.width);
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

  /** A ribbon over the board interior (round start, AI turn start). Does not block. */
  ribbon(text: string, sub: string, color: number, y: number, ms: number): void {
    const s = this.scene;
    const w = 380;
    const bg = s.add.rectangle(0, 0, w, sub ? 64 : 42, COLORS.ink, 0.92).setStrokeStyle(3, color);
    const t = txt(s, 0, sub ? -10 : 0, text, { size: sub ? 26 : 20, bold: true, color: Phaser.Display.Color.IntegerToColor(color).rgba, stroke: HEX.ink, origin: [0.5, 0.5] });
    const parts: Phaser.GameObjects.GameObject[] = [bg, t];
    if (sub) parts.push(txt(s, 0, 18, sub, { size: 12, color: HEX.parchment, origin: [0.5, 0.5] }));
    const c = s.add.container(BOARD_CENTER.x, y, parts).setDepth(DEPTH - 1).setAlpha(0).setScale(0.85);
    s.tweens.add({ targets: c, alpha: 1, scale: 1, duration: Math.min(160, ms * 0.25), ease: 'Back.easeOut' });
    s.tweens.add({ targets: c, alpha: 0, y: y - 16, duration: Math.min(220, ms * 0.3), delay: ms * 0.7, onComplete: () => c.destroy() });
  }

  /** Big dice tumbling in the board centre, landing on `d`. Resolves when they land; they fade afterwards. */
  rollDice(d: [number, number], ms: number): Promise<void> {
    const s = this.scene;
    const y = BOARD.y + BOARD.cell * 2.2;
    const dice = [-46, 46].map((dx) => addImg(s, BOARD_CENTER.x + dx, y, 'die_1').setScale(2.6).setDepth(DEPTH - 2));
    const sum = txt(s, BOARD_CENTER.x, y + 58, `${d[0]} + ${d[1]} = ${d[0] + d[1]}${d[0] === d[1] ? '  双数！' : ''}`, {
      size: 20, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5],
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
          s.tweens.add({ targets: [...dice, sum], alpha: 0, duration: 250, delay: 650, onComplete: () => { dice.forEach((x) => x.destroy()); sum.destroy(); } });
          res();
        },
      });
    });
  }
}
