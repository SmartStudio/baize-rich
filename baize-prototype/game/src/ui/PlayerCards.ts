// Left column: one card per seat (portrait, name, 修为 + realm, 灵石, 灵丹, 神通, tasks, status).
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { breakthroughsAvailable, cultivation, isWardActive, realmName } from '../core/rules';
import type { GameState } from '../core/types';
import { addImg, setFrame } from './assets';
import { LEFT } from './layout';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from './theme';

interface CardView {
  frame: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  cultBar: Phaser.GameObjects.Rectangle;
  cultText: Phaser.GameObjects.Text;
  stones: Phaser.GameObjects.Text;
  pills: Phaser.GameObjects.Text;
  cards: Phaser.GameObjects.Text;
  divines: Phaser.GameObjects.Image[];
  status: Phaser.GameObjects.Text;
  tasks: Phaser.GameObjects.Text;
}

const BAR_W = 220;

export class PlayerCards {
  private views: CardView[] = [];

  constructor(scene: Phaser.Scene, private game: Game, labels: string[]) {
    const s = scene;
    game.state.players.forEach((p, i) => {
      const x = LEFT.x;
      const y = LEFT.y + i * (LEFT.cardH + LEFT.gap);
      const frame = panel(s, x, y, LEFT.w, LEFT.cardH);
      s.add.rectangle(x, y, 6, LEFT.cardH, PLAYER_COLORS[i]).setOrigin(0, 0);
      addImg(s, x + 12, y + 10, `por_${p.hero}`).setOrigin(0, 0);
      const name = txt(s, x + 84, y + 8, `${p.name}`, { size: 14, color: PLAYER_HEX[i], bold: true });
      txt(s, x + LEFT.w - 8, y + 10, labels[i], { size: 11, color: HEX.dim, origin: [1, 0] });
      s.add.rectangle(x + 84, y + 32, BAR_W, 8, COLORS.outline).setOrigin(0, 0);
      const cultBar = s.add.rectangle(x + 85, y + 33, 0, 6, COLORS.gold).setOrigin(0, 0);
      for (let k = 1; k < 10; k++) s.add.rectangle(x + 84 + (BAR_W * k) / 10, y + 32, 1, 8, COLORS.outline).setOrigin(0, 0);
      addImg(s, x + 84, y + 44, 'ic_cult').setOrigin(0, 0);
      const cultText = txt(s, x + 104, y + 44, '', { size: 12 });
      addImg(s, x + 84, y + 64, 'ic_stone').setOrigin(0, 0);
      const stones = txt(s, x + 104, y + 64, '', { size: 12 });
      addImg(s, x + 172, y + 64, 'ic_pill').setOrigin(0, 0);
      const pills = txt(s, x + 192, y + 64, '', { size: 12 });
      const cards = txt(s, x + 236, y + 64, '', { size: 12, color: HEX.dim });
      const divines: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < 4; k++) {
        s.add.rectangle(x + 12 + k * 28, y + 88, 26, 26, COLORS.outline).setOrigin(0, 0);
        divines.push(addImg(s, x + 13 + k * 28, y + 89, 'div_swift').setOrigin(0, 0).setVisible(false));
      }
      const status = txt(s, x + 128, y + 90, '', { size: 11, color: HEX.gold, wrap: 176 });
      const tasks = txt(s, x + 12, y + 122, '', { size: 11, color: HEX.dim, wrap: LEFT.w - 20 });
      this.views.push({ frame, name, cultBar, cultText, stones, pills, cards, divines, status, tasks });
    });
  }

  /** `viewer`: seat of the human whose screen this is (神识 reveals opponents' hands). */
  render(state: GameState, viewer: number | null = null): void {
    const g = this.game;
    state.players.forEach((p, i) => {
      const v = this.views[i];
      const c = cultivation(state, g.data, i);
      v.frame.setStrokeStyle(state.current === i && !state.over ? 3 : 2, state.current === i && !state.over ? COLORS.gold : COLORS.outline);
      v.cultBar.width = Math.max(0, Math.min(1, c / g.data.config.winCultivation)) * (BAR_W - 2);
      const bt = breakthroughsAvailable(p);
      v.cultText.setText(`修为 ${c} / ${g.data.config.winCultivation} · ${realmName(g.data, c)}${bt > 0 ? `  突破机会 ${bt}` : ''}`);
      v.stones.setText(`${p.stones}`);
      v.pills.setText(`${p.pills}`);
      v.cards.setText(`符 ${p.hand.length}/${g.data.config.handLimit}`);
      v.divines.forEach((img, k) => {
        const d = p.divines[k];
        img.setVisible(!!d);
        if (d) setFrame(img, `div_${d}`);
      });
      const tags: string[] = [];
      if (p.jailed) tags.push('面壁');
      if (p.bound) tags.push('定身');
      if (isWardActive(state, i)) tags.push('护道');
      if (p.seal) tags.push('祠印');
      if (p.turnsTaken <= p.rentImmuneUntilTurn) tags.push('不动明王');
      if (p.tremorRound === state.round) tags.push('地脉异动');
      if (p.mazeAvailable) tags.push('迷踪');
      if (p.chooseRoll) tags.push('灵兽引路');
      const lords = (Object.entries(state.veinLords) as [string, number | null][])
        .filter(([, s]) => s === i).map(([r]) => g.data.board.regions[r as keyof typeof state.veinLords].element);
      if (lords.length) tags.push(`灵脉之主:${lords.join('')}`);
      tags.push(`大招 ${p.ultUses}/${g.data.config.ult.maxUses}`);
      v.status.setText(tags.join(' · '));
      const taskNames = p.tasks.map((t) => g.taskById.get(t.id)!.name.replace('宗门任务 · ', ''));
      let line = `任务 ${p.tasks.length}/${g.data.config.maxActiveTasks}${taskNames.length ? '：' + taskNames.join('、') : ''}`;
      if (viewer !== null && viewer !== i && state.players[viewer].divines.includes('sense')) {
        line += `  神识·手牌：${p.hand.map((c) => g.spellName(c)).join(' ') || '无'}`;
      }
      v.tasks.setText(line);
    });
  }
}
