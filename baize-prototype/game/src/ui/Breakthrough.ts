// 闭关突破 cutscene (GDD §5.3, §14): realm before → after against the target, the 2D6 tumbling, each bonus
// adding onto the total, then 破境 (gold flash, the new realm drops in, 白泽 behind) or 走火入魔 (red flash,
// shake, what was lost). Beat lengths come from the caller (ui/pacing), already scaled by the speed setting.
// Every position and scale is an integer, so the pixel art stays crisp.
import Phaser from 'phaser';
import { sound } from '../audio/Sound';
import { addImg, setFrame } from './assets';
import type { BreakthroughView } from './breakthroughView';
import { signed } from './choices/spec';
import { H, W } from './layout';
import type { BreakthroughBeats } from './pacing';
import { COLORS, FS, HEX, txt } from './theme';

const DEPTH = 9950;
const PW = 640;
const PH = 360;
const PX = (W - PW) / 2;
const PY = 140;
const DIE_SCALE = 2;
const SHAKE = [-8, 8, -6, 6, -4, 4, -2, 2, 0];
const DICE_Y = 136;
const CHIPS_Y = 196;
const CHIP_GAP = 8;

type Fadeable = Phaser.GameObjects.Components.AlphaSingle;

export class Breakthrough {
  constructor(private scene: Phaser.Scene) {}

  async play(v: BreakthroughView, beat: BreakthroughBeats): Promise<void> {
    const s = this.scene;
    const dim = s.add.rectangle(0, 0, W, H, 0x000000, 0.7).setOrigin(0, 0).setAlpha(0);
    const panel = s.add.container(PX, PY);
    const layer = s.add.container(0, 0, [dim, panel]).setDepth(DEPTH).setAlpha(0);
    panel.add(s.add.rectangle(0, 0, PW, PH, COLORS.ink, 0.96).setOrigin(0, 0).setStrokeStyle(4, COLORS.gold));
    this.header(panel, v);
    await this.fade([layer, dim], 1, beat.in);
    sound.cue('charge');
    const total = await this.roll(panel, v, beat);
    await this.addBonuses(panel, v, total, beat);
    await this.wait(beat.verdict);
    sound.cue(v.success ? 'ascend' : 'deviate');
    await (v.success ? this.ascend(layer, panel, v, beat) : this.fail(layer, panel, v, beat));
    await this.wait(beat.result);
    await this.fade([layer], 0, beat.out);
    layer.destroy();
  }

  private header(panel: Phaser.GameObjects.Container, v: BreakthroughView): void {
    const s = this.scene;
    panel.add(addImg(s, 24, 20, v.portrait).setOrigin(0, 0));
    panel.add(txt(s, 104, 24, `闭关突破 · ${v.who}`, { size: FS.sm, color: HEX.dim }));
    panel.add(txt(s, 104, 44, `${v.from} → ${v.to}`, { size: FS.xl, bold: true, color: HEX.gold, stroke: HEX.ink }));
    panel.add(s.add.rectangle(PW - 128, 20, 104, 64, COLORS.panel).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold));
    panel.add(txt(s, PW - 76, 32, '目标', { size: FS.sm, color: HEX.parchment, origin: [0.5, 0.5] }));
    panel.add(txt(s, PW - 76, 62, String(v.target), { size: FS.xl, bold: true, color: HEX.gold, origin: [0.5, 0.5] }));
  }

  /** Tumbles the dice in place, lands them on the rolled faces, shows their sum. Returns the running-total text. */
  private async roll(panel: Phaser.GameObjects.Container, v: BreakthroughView, beat: BreakthroughBeats): Promise<Phaser.GameObjects.Text> {
    const s = this.scene;
    const dice = [0, 1].map((i) => addImg(s, PW / 2 - 80 + i * 64, DICE_Y, 'die_1').setScale(DIE_SCALE));
    const eq = txt(s, PW / 2 + 40, DICE_Y, '=', { size: FS.xl, bold: true, color: HEX.parchment, origin: [0.5, 0.5] }).setAlpha(0);
    const total = txt(s, PW / 2 + 68, DICE_Y, '', { size: FS.hero, bold: true, color: HEX.parchment, stroke: HEX.ink, origin: [0, 0.5] });
    panel.add([...dice, eq, total]);
    const ticks = Math.max(3, Math.floor(beat.tumble / 60));
    for (let k = 1; k <= ticks; k++) {
      const last = k === ticks;
      dice.forEach((d, i) => {
        setFrame(d, `die_${last ? v.dice[i] : Phaser.Math.Between(1, 6)}`);
        d.setY(last ? DICE_Y : DICE_Y + Phaser.Math.Between(-6, 2));
      });
      await this.wait(beat.tumble / ticks);
    }
    eq.setAlpha(1);
    total.setText(String(v.dice[0] + v.dice[1]));
    await this.wait(beat.settle);
    return total;
  }

  /** Each bonus lands as a chip under the dice and adds onto the total; the total turns green once it reaches the target. */
  private async addBonuses(panel: Phaser.GameObjects.Container, v: BreakthroughView, total: Phaser.GameObjects.Text, beat: BreakthroughBeats): Promise<void> {
    let sum = v.dice[0] + v.dice[1];
    const chips = v.bonuses.map((b) => this.chip(`${b.label} ${signed(b.value)}`, b.value >= 0 ? HEX.good : HEX.bad).setAlpha(0));
    let x = Math.round((PW - chips.reduce((a, c) => a + c.width + CHIP_GAP, -CHIP_GAP)) / 2);
    for (const [i, chip] of chips.entries()) {
      panel.add(chip.setX(x));
      x += chip.width + CHIP_GAP;
      sum += v.bonuses[i].value;
      total.setText(String(sum)).setColor(sum >= v.target ? HEX.good : HEX.parchment);
      await this.slide(chip, CHIPS_Y, beat.bonus);
    }
    total.setText(String(v.total)).setColor(v.success ? HEX.good : HEX.bad);
  }

  private async ascend(layer: Phaser.GameObjects.Container, panel: Phaser.GameObjects.Container, v: BreakthroughView, beat: BreakthroughBeats): Promise<void> {
    const s = this.scene;
    const baize = addImg(s, PW - 70, PH - 8, 'baize').setOrigin(0.5, 1).setAlpha(0);
    panel.addAt(baize, 1);
    const realm = txt(s, PW / 2, 268, `突破成功 · ${v.to}`, { size: FS.hero, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] });
    panel.add([realm, ...this.outcome(v, HEX.gold)]);
    this.flash(layer, 0xfff3c0, 0.85, beat.flash);
    s.tweens.add({ targets: baize, alpha: 0.4, duration: beat.flash });
    await this.slide(realm, 268, beat.drop, -48);
  }

  private async fail(layer: Phaser.GameObjects.Container, panel: Phaser.GameObjects.Container, v: BreakthroughView, beat: BreakthroughBeats): Promise<void> {
    const s = this.scene;
    panel.add([txt(s, PW / 2, 268, '走火入魔', { size: FS.hero, bold: true, color: HEX.bad, stroke: HEX.ink, origin: [0.5, 0.5] }), ...this.outcome(v, HEX.bad)]);
    this.flash(layer, COLORS.bad, 0.55, beat.flash);
    for (const dx of SHAKE) {
      panel.setX(PX + dx);
      await this.wait(beat.shakeStep);
    }
  }

  /** What changed ("晋入结丹 · 领悟神识") and the script lines, under the verdict. */
  private outcome(v: BreakthroughView, color: string): Phaser.GameObjects.Text[] {
    const s = this.scene;
    return [
      txt(s, PW / 2, 306, v.outcome.join(' · '), { size: FS.md, bold: true, color, origin: [0.5, 0.5] }),
      txt(s, PW / 2, 334, v.lines.join('   '), { size: FS.sm, color: HEX.parchment, origin: [0.5, 0.5] }),
    ];
  }

  private chip(label: string, color: string): Phaser.GameObjects.Container {
    const s = this.scene;
    const t = txt(s, 10, 6, label, { size: FS.md, bold: true, color });
    const w = Math.ceil(t.width) + 20;
    const c = s.add.container(0, 0, [s.add.rectangle(0, 0, w, 30, COLORS.panel).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold), t]);
    return c.setSize(w, 30);
  }

  private flash(layer: Phaser.GameObjects.Container, color: number, alpha: number, duration: number): void {
    const f = this.scene.add.rectangle(0, 0, W, H, color, alpha).setOrigin(0, 0);
    layer.add(f);
    this.scene.tweens.add({ targets: f, alpha: 0, duration, onComplete: () => f.destroy() });
  }

  /** Moves `obj` from `dy` px off to `y` in whole-pixel steps while fading it in. */
  private slide(obj: Phaser.GameObjects.Components.Transform & Fadeable, y: number, duration: number, dy = 16): Promise<void> {
    const p = { t: 0 };
    obj.setAlpha(0);
    obj.setY(y + dy);
    return new Promise((res) => {
      this.scene.tweens.add({
        targets: p, t: 1, duration, ease: 'Cubic.easeOut',
        onUpdate: () => { obj.setY(Math.round(y + dy * (1 - p.t))); obj.setAlpha(p.t); },
        onComplete: () => res(),
      });
    });
  }

  private fade(targets: Fadeable[], alpha: number, duration: number): Promise<void> {
    return new Promise((res) => this.scene.tweens.add({ targets, alpha, duration, onComplete: () => res() }));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.scene.time.delayedCall(ms, () => res()));
  }
}
