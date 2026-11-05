import Phaser from 'phaser';
import { DIFFICULTY_LABEL, PERSONALITY_LABEL } from '../ai/ai';
import { defaultData } from '../core/data';
import { addImg } from '../ui/assets';
import type { SessionConfig } from '../ui/session';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from '../ui/theme';
import { fadeToScene } from '../ui/widgets';

const COL_W = 250;
const COL_H = 340;
const GAP = 30;
const HOLD_MS = 2600;

/** Pre-match splash: the four seats slide in, a stamp lands, then the game starts. Any key or click skips. */
export class VersusScene extends Phaser.Scene {
  private session!: SessionConfig;

  constructor() {
    super('Versus');
  }

  create(session: SessionConfig): void {
    this.session = session;
    this.cameras.main.setBackgroundColor(COLORS.bg).fadeIn(250);
    const band = this.add.rectangle(640, 350, 1280, 380, COLORS.ink, 0.9).setScale(1, 0);
    this.tweens.add({ targets: band, scaleY: 1, duration: 260, ease: 'Cubic.easeOut' });
    txt(this, 640, 80, '白泽秘境 · 四修论道', { size: 32, bold: true, color: HEX.gold, origin: [0.5, 0.5], stroke: HEX.ink });

    session.setup.players.forEach((p, i) => {
      const seat = session.seats[i];
      const h = defaultData.heroes.find((x) => x.id === p.hero)!;
      const x = 640 + (i - 1.5) * (COL_W + GAP);
      const from = i % 2 === 0 ? -420 : 420;
      const col = this.add.container(x, 350 + from).setAlpha(0);
      const label = seat.human ? '玩家' : `AI · ${DIFFICULTY_LABEL[seat.difficulty]} · ${PERSONALITY_LABEL[seat.personality]}`;
      col.add([
        this.add.rectangle(0, 0, COL_W, COL_H, COLORS.panel).setStrokeStyle(3, seat.human ? COLORS.gold : COLORS.outline),
        this.add.rectangle(0, -COL_H / 2 + 5, COL_W, 10, PLAYER_COLORS[i]),
        addImg(this, 0, -46, `por_${p.hero}`).setScale(3),
        txt(this, 0, 76, p.name, { size: 22, bold: true, color: PLAYER_HEX[i], origin: [0.5, 0.5] }),
        txt(this, 0, 106, `${h.role} · 大招【${h.ult.name}】`, { size: 13, color: HEX.dim, origin: [0.5, 0.5] }),
        txt(this, 0, 136, `${i + 1} 号位 · ${label}`, { size: 14, color: seat.human ? HEX.gold : HEX.parchment, origin: [0.5, 0.5] }),
      ]);
      this.tweens.add({ targets: col, y: 350, alpha: 1, duration: 420, delay: 180 + i * 140, ease: 'Back.easeOut' });
    });

    const stamp = txt(this, 640, 600, '斗法开始！', { size: 44, bold: true, color: HEX.gold, origin: [0.5, 0.5], stroke: HEX.ink })
      .setScale(2.4).setAlpha(0);
    this.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 320, delay: 900, ease: 'Back.easeOut', onComplete: () => this.cameras.main.shake(160, 0.006) });
    txt(this, 1256, 700, '任意键 / 点击跳过', { size: 13, color: HEX.dim, origin: [1, 1] });

    this.time.delayedCall(HOLD_MS, () => this.go());
    this.input.keyboard?.once('keydown', () => this.go());
    this.input.once('pointerdown', () => this.go());
  }

  private go(): void {
    fadeToScene(this, 'Game', this.session, 350);
  }
}
