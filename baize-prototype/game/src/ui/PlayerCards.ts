// Left column: one compact strip per seat (portrait, name, 修为 bar, 灵石, 灵丹, 符, 神通, status). Details live in tooltips.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { breakthroughCost, breakthroughsAvailable, cultivation, isWardActive, realmName } from '../core/rules';
import type { GameState } from '../core/types';
import { addImg, setFrame } from './assets';
import { LEFT } from './layout';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from './theme';
import { Tooltip, type TipContent } from './Tooltip';

interface CardView {
  frame: Phaser.GameObjects.Rectangle;
  badge: Phaser.GameObjects.Container;
  cultBar: Phaser.GameObjects.Rectangle;
  cultText: Phaser.GameObjects.Text;
  stones: Phaser.GameObjects.Text;
  pills: Phaser.GameObjects.Text;
  cards: Phaser.GameObjects.Text;
  divines: Phaser.GameObjects.Image[];
  status: Phaser.GameObjects.Text;
}

interface StatusTag {
  label: string;
  desc: string;
}

const BAR_W = LEFT.w - 86;

export class PlayerCards {
  private views: CardView[] = [];
  private tags: StatusTag[][] = [];
  private state: GameState;
  private viewer: number | null = null;
  private tip: Tooltip;

  constructor(scene: Phaser.Scene, private game: Game, labels: string[]) {
    const s = scene;
    this.state = game.state;
    this.tip = new Tooltip(s);
    game.state.players.forEach((p, i) => {
      const x = LEFT.x;
      const y = LEFT.y + i * (LEFT.cardH + LEFT.gap);
      const frame = panel(s, x, y, LEFT.w, LEFT.cardH);
      s.add.rectangle(x, y, 5, LEFT.cardH, PLAYER_COLORS[i]).setOrigin(0, 0);
      addImg(s, x + 12, y + 10, `por_${p.hero}`).setOrigin(0, 0).setScale(56 / 64);
      const badge = s.add.container(x + 40, y + 74, [
        s.add.rectangle(0, 0, 56, 16, PLAYER_COLORS[i]).setStrokeStyle(2, COLORS.outline),
        txt(s, 0, 0, '行动中', { size: 11, bold: true, color: HEX.ink, origin: [0.5, 0.5] }),
      ]).setVisible(false);
      txt(s, x + 76, y + 8, p.name, { size: 14, color: PLAYER_HEX[i], bold: true });
      txt(s, x + LEFT.w - 8, y + 11, labels[i], { size: 10, color: HEX.dim, origin: [1, 0] });
      s.add.rectangle(x + 76, y + 30, BAR_W, 8, COLORS.outline).setOrigin(0, 0);
      const cultBar = s.add.rectangle(x + 77, y + 31, 0, 6, COLORS.gold).setOrigin(0, 0);
      for (let k = 1; k < 10; k++) s.add.rectangle(x + 76 + (BAR_W * k) / 10, y + 30, 1, 8, COLORS.outline).setOrigin(0, 0);
      const cultText = txt(s, x + 76, y + 42, '', { size: 12 });
      addImg(s, x + 76, y + 62, 'ic_stone').setOrigin(0, 0);
      const stones = txt(s, x + 95, y + 62, '', { size: 12 });
      addImg(s, x + 146, y + 62, 'ic_pill').setOrigin(0, 0);
      const pills = txt(s, x + 165, y + 62, '', { size: 12 });
      const cards = txt(s, x + 198, y + 62, '', { size: 12, color: HEX.dim });
      const divines: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < 4; k++) {
        const dx = x + 12 + k * 26;
        s.add.rectangle(dx, y + 90, 24, 24, COLORS.outline).setOrigin(0, 0);
        divines.push(addImg(s, dx, y + 90, 'div_swift').setOrigin(0, 0).setVisible(false));
        this.tip.attach(dx, y + 90, 24, 24, () => this.divineTip(i, k));
      }
      const status = txt(s, x + 118, y + 86, '', { size: 11, color: HEX.gold, wrap: LEFT.w - 126 });
      this.tip.attach(x + 76, y + 26, BAR_W, 32, () => this.cultTip(i));
      this.tip.attach(x + 116, y + 82, LEFT.w - 120, LEFT.cardH - 84, () => this.statusTip(i));
      this.views.push({ frame, badge, cultBar, cultText, stones, pills, cards, divines, status });
    });
  }

  /** `viewer`: seat of the human whose screen this is (神识 reveals opponents' hands). */
  render(state: GameState, viewer: number | null = null): void {
    const g = this.game;
    this.state = state;
    this.viewer = viewer;
    state.players.forEach((p, i) => {
      const v = this.views[i];
      const c = cultivation(state, g.data, i);
      const active = state.current === i && !state.over;
      v.frame.setStrokeStyle(active ? 3 : 2, active ? PLAYER_COLORS[i] : COLORS.outline).setFillStyle(active ? COLORS.panelLight : COLORS.panel);
      v.badge.setVisible(active);
      v.cultBar.width = Math.max(0, Math.min(1, c / g.data.config.winCultivation)) * (BAR_W - 2);
      const bt = breakthroughsAvailable(p);
      v.cultText.setText(`修为 ${c}/${g.data.config.winCultivation} · ${realmName(g.data, c)}${bt > 0 ? ` · 可突破 ${bt}` : ''}`);
      v.stones.setText(`${p.stones}`);
      v.pills.setText(`${p.pills}`);
      v.cards.setText(`符 ${p.hand.length}/${g.data.config.handLimit}`);
      v.divines.forEach((img, k) => {
        const d = p.divines[k];
        img.setVisible(!!d);
        if (d) setFrame(img, `div_${d}`);
      });
      this.tags[i] = this.statusTags(state, i);
      v.status.setText(this.tags[i].map((t) => t.label).join(' · '));
    });
  }

  private statusTags(state: GameState, i: number): StatusTag[] {
    const g = this.game;
    const cfg = g.data.config;
    const p = state.players[i];
    const taskNames = p.tasks.map((t) => g.taskById.get(t.id)!.name.replace('宗门任务 · ', ''));
    const tags: StatusTag[] = [{
      label: `任务 ${p.tasks.length}/${cfg.maxActiveTasks}`,
      desc: `${taskNames.length ? `${taskNames.join('、')}。` : ''}停在历练碑或在白泽灵台「静心」会抽机缘卡，其中可能有宗门任务，达成即 +1 修为。`,
    }];
    if (p.jailed) tags.push({ label: '面壁', desc: `困在思过崖：每回合可付 ${cfg.cliffFee} 灵石或掷出双数离开，第 ${cfg.cliffMaxTurns} 回合自动离开。` });
    if (p.bound) tags.push({ label: '定身', desc: '中了定身符：下回合不能移动，原地结算。' });
    if (isWardActive(state, i)) tags.push({ label: '护道', desc: `白泽护道：到第 ${p.wardUntilRound} 轮为止，免疫五雷符、定身符、天魔、地火和思过崖。` });
    if (p.seal) tags.push({ label: '祠印', desc: `下一次突破少花 ${cfg.shrineDiscount} 灵丹（不可叠加）。` });
    if (p.turnsTaken <= p.rentImmuneUntilTurn) tags.push({ label: '不动明王', desc: '体修大招：本回合与下回合免付所有租金。' });
    if (p.tremorRound === state.round) tags.push({ label: '地脉异动', desc: '本轮你收取的所有租金减半。' });
    if (p.mazeAvailable) tags.push({ label: '迷踪', desc: '上回合停在木灵田上：本回合可以选择逆时针移动。' });
    if (p.chooseRoll) tags.push({ label: '灵兽引路', desc: '下次移动的点数可在 1–6 中任选。' });
    for (const [r, seat] of Object.entries(state.veinLords) as [keyof typeof state.veinLords, number | null][]) {
      if (seat !== i) continue;
      const region = g.data.board.regions[r];
      tags.push({
        label: `灵脉之主·${region.element}`,
        desc: `在${region.name}拥有的灵田最多且至少 ${cfg.veinLordMinLands} 块：+${cfg.veinLordCultivation} 修为，被反超即失去。`,
      });
    }
    const hero = g.data.heroes.find((h) => h.id === p.hero)!;
    tags.push({
      label: `大招 ${p.ultUses}/${cfg.ult.maxUses}`,
      desc: `【${hero.ult.name}】${hero.ult.desc}。消耗 ${cfg.ult.pillCost} 灵丹，每局最多 ${cfg.ult.maxUses} 次（已用 ${p.ultUses} 次）。\n被动【${hero.passive.name}】${hero.passive.desc}。`,
    });
    const v = this.viewer;
    if (v !== null && v !== i && state.players[v].divines.includes('sense')) {
      tags.push({ label: `神识·手牌 ${p.hand.map((c) => g.spellName(c)).join(' ') || '无'}`, desc: '你的神通【神识】可看到对手的手牌。' });
    }
    return tags;
  }

  private statusTip(i: number): TipContent {
    return { title: `${this.state.players[i].name} 的状态`, body: this.tags[i].map((t) => `${t.label}：${t.desc}`).join('\n') };
  }

  private cultTip(i: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const st = this.state;
    const p = st.players[i];
    const c = cultivation(st, g.data, i);
    const bt = breakthroughsAvailable(p);
    const next = cfg.breakthroughThresholds.find((t) => t > p.peakCult);
    const b = g.data.board.buildings;
    const lines = [
      `修为先达到 ${cfg.winCultivation} 立即获胜；否则第 ${cfg.rounds} 轮结束时修为最高者获胜。`,
      bt > 0
        ? `突破机会 ${bt} 次：停在中央白泽灵台选「突破」（本次 ${breakthroughCost(st, g.data, i)} 灵丹），换 1 个永久神通。`
        : next !== undefined ? `修为（历史最高）达到 ${next} 时获得下一次突破机会。` : '突破机会已全部获得。',
      '',
      '修为来源：',
      `· 洞府首次建成${b[3].name} / ${b[4].name}：各 +${cfg.cultivationOnBuild['3']}`,
      `· 灵脉之主（某灵域灵田最多且 ≥${cfg.veinLordMinLands} 块）：+${cfg.veinLordCultivation}`,
      '· 完成宗门任务：每张 +1',
      `· 对天魔造成最后一击：+${cfg.rules.demonLastHitCultivation}`,
      `· 五雷符让修为唯一第一者的洞府降级：+${cfg.rules.bountyCultivation}`,
      `· 白泽现世时选中「白泽图」：+${cfg.rules.chartCultivation}`,
      '破产重整会失去修为。',
    ];
    return { title: `修为 ${c} / ${cfg.winCultivation} · ${realmName(g.data, c)}`, body: lines.join('\n') };
  }

  private divineTip(i: number, k: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const id = this.state.players[i].divines[k];
    if (id) {
      const d = g.data.blessings.divine.find((x) => x.id === id)!;
      return { title: `神通【${d.name}】`, body: `${d.desc}\n（永久生效）` };
    }
    return {
      title: '空神通位',
      body: `修为每跨过 ${cfg.breakthroughThresholds.join(' / ')} 获得 1 次突破机会。停在中央白泽灵台选「突破」并付灵丹（依次 ${cfg.breakthroughCost.join(' / ')} 颗），从 3 张神通里选 1 张，永久生效。最多 ${cfg.maxDivine} 个。`,
    };
  }
}
