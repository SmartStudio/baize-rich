import Phaser from 'phaser';
import type { Game } from '../core/engine';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { TOP } from './layout';
import { COLORS, HEX, panel, txt } from './theme';

/** Top bar (y 8–60): title, round, Baize countdown, demon status, speed. */
export class TopBar {
  private round: Phaser.GameObjects.Text;
  private demon: Phaser.GameObjects.Text;
  private demon2: Phaser.GameObjects.Text;
  private baize: Phaser.GameObjects.Text;
  private baize2: Phaser.GameObjects.Text;
  private speed: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, private game: Game) {
    const y = TOP.y;
    const h = TOP.h;
    panel(scene, 16, y, 312, h, COLORS.panel, COLORS.gold);
    addImg(scene, 30, y + 18, 'ic_baize').setOrigin(0, 0);
    txt(scene, 54, y + h / 2, '白泽秘境大富翁', { size: 22, color: HEX.gold, bold: true, origin: [0, 0.5] });
    panel(scene, 440, y, 230, h, COLORS.panel, COLORS.gold);
    this.round = txt(scene, 555, y + h / 2, '', { size: 20, bold: true, origin: [0.5, 0.5] });
    panel(scene, 684, y, 196, h, COLORS.panel, COLORS.gold);
    addImg(scene, 696, y + 18, 'ic_baize').setOrigin(0, 0);
    this.baize = txt(scene, 720, y + 9, '', { size: 12 });
    this.baize2 = txt(scene, 720, y + 28, '', { size: 12, color: HEX.dim });
    panel(scene, 894, y, 210, h, 0x3a2348, COLORS.dim);
    addImg(scene, 906, y + 18, 'ic_demon').setOrigin(0, 0);
    this.demon = txt(scene, 930, y + 9, '', { size: 12 });
    this.demon2 = txt(scene, 930, y + 28, '', { size: 12, color: HEX.dim });
    panel(scene, 1118, y, 146, h);
    this.speed = txt(scene, 1191, y + h / 2, '', { size: 14, bold: true, origin: [0.5, 0.5] });
  }

  render(state: GameState, speed: number): void {
    const cfg = this.game.data.config;
    const r = Math.max(1, state.round);
    this.round.setText(`第 ${r} / ${cfg.rounds} 回合`);
    if (state.demon) {
      this.demon.setText(`天魔 生命 ${state.demon.hp}/${state.demon.maxHp}`).setColor(HEX.bad);
      this.demon2.setText(`${this.game.nodeName(state.demon.node)} · 剩 ${state.demon.leaveRound - r} 轮`);
    } else {
      const next = cfg.demon.spawnRounds.find((x) => x > state.round);
      this.demon.setText(next ? '天魔 未现身' : '天魔 已平息').setColor(HEX.parchment);
      this.demon2.setText(next ? `第 ${next} 轮来袭` : '');
    }
    const m = cfg.baizeManifestRound;
    if (state.manifested && state.round === m) {
      this.baize.setText('白泽现世').setColor(HEX.gold);
      this.baize2.setText('灵雨：本轮租金减半');
    } else if (state.manifested) {
      this.baize.setText('白泽已现世').setColor(HEX.dim);
      this.baize2.setText('');
    } else {
      this.baize.setText('白泽现世').setColor(HEX.parchment);
      this.baize2.setText(m - r === 1 ? `下一轮 · 第 ${m} 轮` : `还有 ${m - r} 轮 · 第 ${m} 轮`);
    }
    this.speed.setText(`F  ×${speed}`);
  }
}
