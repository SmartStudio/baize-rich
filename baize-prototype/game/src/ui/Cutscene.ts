// Transient, tween-only overlays in screen space (built on the HUD scene): full-width cutscene
// banners for big events, the round / turn ribbons, and the dice roll. Callers pass durations that
// are already scaled by the play speed.
import Phaser from 'phaser';
import { addImg, setFrame } from './assets';
import { BOARD_COL, H, STAGE, W } from './layout';
import { COLORS, FS, HEX, txt } from './theme';

export interface BannerSpec {
  title: string;
  sub: string;
  /** Frame shown left of the title: a hero portrait or 'baize' */
  icon: string;
  color: number;
  /** Full-screen dim. Climactic beats set this. Other banners leave the board bright. */
  dim?: boolean;
}

const DEPTH = 9900;
const BANNER_H = 100;
const BANNER_ICON = 64;
const PLATE_R = 6;

export class Cutscene {
  constructor(private scene: Phaser.Scene) {}

  /** A strip across the board column in the upper screen. Resolves when it has gone. */
  banner(spec: BannerSpec, ms: number): Promise<void> {
    const s = this.scene;
    const cy = STAGE.bannerY;
    const dim = spec.dim ? s.add.rectangle(0, 0, W, H, 0x000000, 0.35).setOrigin(0, 0).setAlpha(0) : null;
    const { x, w } = BOARD_COL;
    const strip = s.add.rectangle(x, cy, w, BANNER_H, COLORS.ink, 0.94).setOrigin(0, 0.5);
    const edgeT = s.add.rectangle(x, cy - BANNER_H / 2, w, 4, spec.color).setOrigin(0, 0.5);
    const edgeB = s.add.rectangle(x, cy + BANNER_H / 2, w, 4, spec.color).setOrigin(0, 0.5);
    const content = bannerContent(s, spec, cy);
    const parts: Phaser.GameObjects.GameObject[] = [strip, edgeT, edgeB, content.root];
    if (dim) parts.unshift(dim);
    const layer = s.add.container(0, 0, parts).setDepth(DEPTH);
    const inMs = Math.min(180, ms * 0.2);
    const outMs = Math.min(220, ms * 0.2);
    strip.setScale(1, 0);
    content.root.setAlpha(0).setX(content.root.x - 120);
    s.tweens.add({ targets: strip, scaleY: 1, duration: inMs, ease: 'Back.easeOut' });
    if (dim) s.tweens.add({ targets: dim, alpha: 1, duration: inMs });
    s.tweens.add({ targets: content.root, alpha: 1, x: content.root.x + 120, duration: inMs * 1.4, ease: 'Cubic.easeOut' });
    s.tweens.add({ targets: content.icon, scale: content.icon.scale * 1.12, duration: ms * 0.3, delay: inMs, yoyo: true, ease: 'Sine.easeInOut' });
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
   * has been on screen for `hold` ms; they fade out afterwards without blocking. `label` replaces the sum
   * (a duel shows both totals, one die per side).
   */
  rollDice(d: [number, number], ms: number, hold: number, label = `${d[0] + d[1]}`): Promise<void> {
    const s = this.scene;
    const row = diceRow(s, d, label);
    const restY = row.dice.map((img) => img.y);
    return new Promise((res) => {
      s.tweens.addCounter({
        from: 0, to: 1, duration: ms,
        onUpdate: (tw) => row.dice.forEach((img, i) => tumble(img, restY[i], tw.getValue() ?? 1, TUMBLE.hops[i])),
        onComplete: () => {
          row.dice.forEach((img, i) => {
            setFrame(img, `die_${d[i]}`);
            img.setY(restY[i]);
          });
          TUMBLE.settle.forEach((dy, k) => s.time.delayedCall((k + 1) * TUMBLE.settleStepMs, () => {
            row.dice.forEach((img, i) => img.setY(restY[i] - dy));
          }));
          row.sum.setAlpha(1);
          s.tweens.add({
            targets: [row.plate, ...row.dice, row.sum], alpha: 0, duration: 250, delay: hold + 500,
            onComplete: () => row.root.destroy(),
          });
          s.time.delayedCall(hold, res);
        },
      });
    });
  }
}

/** Hops per die (they differ so the pair never moves in step), first hop height, and the landing settle in px. */
const TUMBLE = { hops: [4, 5], hopPx: 14, settle: [2, 0, 1, 0], settleStepMs: 45 };

/**
 * One die at tumble progress `t` (0..1): hops that come quick and then slow, each lower than the last, with a
 * new face at each hop's start. Its y stays on whole pixels.
 */
function tumble(img: Phaser.GameObjects.Image, restY: number, t: number, hops: number): void {
  const n = (1 - (1 - t) ** 2) * hops;
  const hop = Math.min(Math.floor(n), hops - 1);
  const f = n - hop;
  img.setY(restY - Math.round(TUMBLE.hopPx * (1 - hop / hops) * 4 * f * (1 - f)));
  if (img.getData('hop') === hop) return;
  img.setData('hop', hop);
  setFrame(img, `die_${1 + Math.floor(Math.random() * 6)}`);
}

function bannerContent(s: Phaser.Scene, spec: BannerSpec, cy: number): { root: Phaser.GameObjects.Container; icon: Phaser.GameObjects.Image } {
  const icon = addImg(s, 0, 0, spec.icon).setOrigin(0.5, 0.5);
  icon.setScale(Math.min(BANNER_ICON / icon.width, BANNER_ICON / icon.height));
  const titleX = icon.displayWidth / 2 + 18;
  const title = txt(s, titleX, -18, spec.title, {
    size: FS.hero, bold: true, color: Phaser.Display.Color.IntegerToColor(spec.color).rgba, stroke: HEX.ink, origin: [0, 0.5],
  });
  const sub = txt(s, titleX + 2, 20, spec.sub, { size: FS.md, color: HEX.parchment, origin: [0, 0.5], wrap: BOARD_COL.w - 120 });
  const left = -icon.displayWidth / 2;
  const right = titleX + Math.max(title.width, sub.width);
  const root = s.add.container(W / 2 - (left + right) / 2, cy, [icon, title, sub]);
  return { root, icon };
}

/** Ink plate behind the dice and their sum. Fades with the row that owns it. */
function inkPlate(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(COLORS.ink, 0.9);
  g.fillRoundedRect(x, y, w, h, PLATE_R);
  g.lineStyle(2, COLORS.gold, 1);
  g.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, PLATE_R - 1);
  return g;
}

function even(n: number): number {
  return Math.ceil(n / 2) * 2;
}

interface DiceRow {
  root: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  dice: Phaser.GameObjects.Image[];
  sum: Phaser.GameObjects.Text;
}

function diceRow(scene: Phaser.Scene, d: [number, number], label: string): DiceRow {
  const dice = d.map(() => addImg(scene, 0, 0, 'die_1').setScale(STAGE.dice));
  const sum = txt(scene, 0, 0, label, {
    size: FS.hero, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5],
  }).setAlpha(0);
  const dieW = dice[0].displayWidth;
  const rowH = Math.max(dice[0].displayHeight, sum.height);
  const pairW = 60 + dieW;
  const rowW = pairW + 16 + sum.width;
  const plateW = even(rowW + 28);
  const plateH = even(rowH + 16);
  const plate = inkPlate(scene, -plateW / 2, -plateH / 2, plateW, plateH);
  const left = -rowW / 2;
  dice[0].setPosition(Math.round(left + dieW / 2), 0);
  dice[1].setPosition(Math.round(left + dieW / 2 + 60), 0);
  sum.setPosition(Math.round(left + pairW + 16 + sum.width / 2), 0);
  const root = scene.add.container(STAGE.cx, STAGE.diceY, [plate, dice[0], dice[1], sum]).setDepth(DEPTH - 2);
  return { root, plate, dice, sum };
}
