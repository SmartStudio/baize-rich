import Phaser from 'phaser';
import type { Game } from '../core/engine';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { LEFT } from './layout';
import { COLORS, FLOAT_ALPHA, FS, HEX, txt } from './theme';
import type { Tooltip } from './Tooltip';

/** Slim round line floating at the top-left: round, 白泽 countdown, demon status. Hover for the win rules. */
export class TopBar {
  private round: Phaser.GameObjects.Text;
  private demon: Phaser.GameObjects.Text;
  private baize: Phaser.GameObjects.Text;
  private state: GameState | null = null;

  constructor(scene: Phaser.Scene, private game: Game, tip: Tooltip) {
    const x = LEFT.x;
    const y = LEFT.lineY;
    const w = LEFT.w;
    const h = LEFT.lineH;
    const cfg = game.data.config;
    scene.add.rectangle(x, y, w, h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    const cy = y + h / 2;
    this.round = txt(scene, x + 10, cy, '', { size: FS.md, bold: true, color: HEX.gold, origin: [0, 0.5] });
    addImg(scene, x + 116, cy, 'ic_baize').setOrigin(0, 0.5);
    this.baize = txt(scene, x + 135, cy, '', { size: FS.sm, origin: [0, 0.5] });
    addImg(scene, x + 186, cy, 'ic_demon').setOrigin(0, 0.5);
    this.demon = txt(scene, x + 205, cy, '', { size: FS.sm, origin: [0, 0.5] });
    tip.attach(x, y, w, h, () => ({
      title: '胜负',
      body: [
        `修为先达到 ${cfg.winCultivation} 的玩家立即获胜（渡劫飞升）。`,
        `无人达到时，第 ${cfg.rounds} 轮结束后修为最高者获胜；平局比总资产（灵石 + 洞府造价 + 灵丹 × ${cfg.pillValueInStones}）。`,
        `不会淘汰：付不起时破产重整，灵田归还，领 ${cfg.bankrupt.resetStones} 灵石，修为 −${cfg.bankrupt.cultivationLoss}。`,
        '一轮 = 每位玩家各行动一个回合。点击左侧修士查看详情。',
        '',
        this.statusDetail(),
      ].join('\n'),
    }));
  }

  render(state: GameState): void {
    this.state = state;
    const cfg = this.game.data.config;
    const r = Math.max(1, state.round);
    this.round.setText(`第 ${r}/${cfg.rounds} 轮${r === cfg.rounds ? ' 终' : ''}`);
    if (state.demon) {
      this.demon.setText(`${state.demon.hp}/${state.demon.maxHp}`).setColor(HEX.bad);
    } else {
      const next = cfg.demon.spawnRounds.find((x) => x > state.round);
      this.demon.setText(next ? `第${next}轮` : '平息').setColor(HEX.parchment);
    }
    const m = cfg.baizeManifestRound;
    if (state.manifested && state.round === m) this.baize.setText('现世').setColor(HEX.gold);
    else if (state.manifested) this.baize.setText('已现').setColor(HEX.dim);
    else this.baize.setText(`${m - r}轮后`).setColor(HEX.parchment);
  }

  /** Long-form 白泽 / 天魔 status for the tooltip. */
  private statusDetail(): string {
    const st = this.state;
    if (!st) return '';
    const g = this.game;
    const cfg = g.data.config;
    const r = Math.max(1, st.round);
    const m = cfg.baizeManifestRound;
    const baize = st.manifested
      ? (st.round === m ? '白泽现世：灵雨普降，本轮租金减半。' : '白泽已现世。')
      : `白泽将于第 ${m} 轮现世（还有 ${m - r} 轮）。`;
    const demon = st.demon
      ? `天魔 生命 ${st.demon.hp}/${st.demon.maxHp}，盘踞【${g.nodeName(st.demon.node)}】，还剩 ${st.demon.leaveRound - r} 轮。`
      : (() => {
        const next = cfg.demon.spawnRounds.find((x) => x > st.round);
        return next ? `天魔将于第 ${next} 轮来袭。` : '天魔已平息。';
      })();
    return `${baize}\n${demon}`;
  }
}
