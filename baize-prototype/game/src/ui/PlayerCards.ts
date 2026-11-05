// Player chips floating in the left margin: portrait, name, 修为, 灵石 and who is acting.
// Hovering the 修为 line explains it; clicking a chip pins a popover with everything else.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { breakthroughCost, breakthroughsAvailable, cultivation, isWardActive, realmName } from '../core/rules';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { LEFT, type Rect } from './layout';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import type { Tooltip, TipContent } from './Tooltip';

interface ChipView {
  rect: Rect;
  frame: Phaser.GameObjects.Rectangle;
  marker: Phaser.GameObjects.Triangle;
  cult: Phaser.GameObjects.Text;
  cultBar: Phaser.GameObjects.Rectangle;
  stones: Phaser.GameObjects.Text;
}

interface StatusTag {
  label: string;
  desc: string;
}

const PORTRAIT = 44;
const TEXT_X = 60;
const BAR_W = LEFT.w - TEXT_X - 10;

export class PlayerCards {
  private views: ChipView[] = [];
  private tags: StatusTag[][] = [];
  private state: GameState;
  private viewer: number | null = null;

  constructor(scene: Phaser.Scene, private game: Game, private labels: string[], private tip: Tooltip) {
    const s = scene;
    this.state = game.state;
    game.state.players.forEach((p, i) => {
      const x = LEFT.x;
      const y = LEFT.chipY + i * (LEFT.chipH + LEFT.chipGap);
      const rect = { x, y, w: LEFT.w, h: LEFT.chipH };
      const frame = s.add.rectangle(x, y, LEFT.w, LEFT.chipH, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline);
      s.add.rectangle(x, y, 4, LEFT.chipH, PLAYER_COLORS[i]).setOrigin(0, 0);
      const marker = s.add.triangle(x + LEFT.w + 8, y + LEFT.chipH / 2, 0, 0, 0, 14, 9, 7, PLAYER_COLORS[i]).setStrokeStyle(1, COLORS.outline).setVisible(false);
      addImg(s, x + 9, y + (LEFT.chipH - PORTRAIT) / 2, `por_${p.hero}`).setOrigin(0, 0).setScale(PORTRAIT / 64);
      txt(s, x + TEXT_X, y + 6, p.name, { size: FS.md, color: PLAYER_HEX[i], bold: true });
      txt(s, x + LEFT.w - 8, y + 8, labels[i], { size: FS.xs, color: HEX.dim, origin: [1, 0] });
      const cult = txt(s, x + TEXT_X, y + 27, '', { size: FS.sm });
      addImg(s, x + LEFT.w - 74, y + 27, 'ic_stone').setOrigin(0, 0);
      const stones = txt(s, x + LEFT.w - 55, y + 27, '', { size: FS.sm });
      s.add.rectangle(x + TEXT_X, y + 47, BAR_W, 5, COLORS.outline).setOrigin(0, 0);
      const cultBar = s.add.rectangle(x + TEXT_X, y + 47, 0, 5, COLORS.gold).setOrigin(0, 0);
      const open = (): void => this.tip.toggle(`chip:${i}`, rect, this.detailTip(i));
      s.add.zone(x, y, LEFT.w, LEFT.chipH).setOrigin(0, 0).setInteractive({ useHandCursor: true }).on('pointerdown', open);
      this.tip.attach(x + TEXT_X, y + 24, BAR_W - 80, 30, () => this.cultTip(i))
        .setInteractive({ useHandCursor: true }).on('pointerdown', open);
      this.views.push({ rect, frame, marker, cult, cultBar, stones });
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
      v.frame.setStrokeStyle(active ? 3 : 2, active ? PLAYER_COLORS[i] : COLORS.outline).setFillStyle(active ? COLORS.panelLight : COLORS.panel, FLOAT_ALPHA);
      v.marker.setVisible(active);
      v.cultBar.width = Math.max(0, Math.min(1, c / g.data.config.winCultivation)) * BAR_W;
      const bt = breakthroughsAvailable(p);
      v.cult.setText(`修为 ${c}/${g.data.config.winCultivation}${bt > 0 ? ' · 可突破' : ''}`).setColor(bt > 0 ? HEX.gold : HEX.parchment);
      v.stones.setText(`${p.stones}`);
      this.tags[i] = this.statusTags(state, i);
    });
    const pinned = this.tip.pinned;
    if (pinned?.startsWith('chip:')) {
      const i = Number(pinned.slice(5));
      this.tip.unpin();
      this.tip.toggle(pinned, this.views[i].rect, this.detailTip(i));
    }
  }

  /** Everything the chip leaves out: resources, 神通, statuses, task, 大招. */
  private detailTip(i: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const st = this.state;
    const p = st.players[i];
    const c = cultivation(st, g.data, i);
    const divines = p.divines.map((id, k) => ({ frame: `div_${id}`, label: g.data.blessings.divine.find((x) => x.id === id)!.name, tip: this.divineTip(i, k) }));
    const lines = [
      `${this.labels[i]} · 修为 ${c}/${cfg.winCultivation}`,
      `灵石 ${p.stones} · 灵丹 ${p.pills} · 符箓 ${p.hand.length}/${cfg.handLimit} · 神通 ${p.divines.length}/${cfg.maxDivine}`,
      this.cultTip(i).body.split('\n')[1],
      ...divines.map((d) => `${d.tip.title}${d.tip.body.split('\n')[0]}`),
      '',
      this.statusTip(i).body,
    ];
    return {
      title: `${p.name} · ${realmName(g.data, c)}`,
      icons: divines.length ? divines.map(({ frame, label }) => ({ frame, label })) : undefined,
      body: lines.join('\n'),
    };
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
    if (state.bountySeat === i) {
      tags.push({ label: '悬赏令', desc: `修为独占鳌头：谁在斗法中击败你，谁就修为 +${cfg.rules.bountyDuelCultivation}，悬赏令随之揭下。` });
    }
    if (p.dazed) tags.push({ label: '迷魂', desc: '中了迷魂丹：下一次掷骰移动的步数减半（向下取整，至少 1）。' });
    const sp = state.spirits.find((x) => x.holder === i);
    const r = cfg.rules;
    if (sp?.kind === 'fox') {
      tags.push({ label: `灵狐附身 ${sp.turnsLeft}`, desc: `福缘灵狐附身，还剩 ${sp.turnsLeft} 个自己的回合：收的租金 ×${r.foxRentMult}，购地 ${r.foxLandDiscount * 10} 折。` });
    }
    if (sp?.kind === 'heart') {
      tags.push({ label: `心魔附身 ${sp.turnsLeft}`, desc: `心魔附身，还剩 ${sp.turnsLeft} 个自己的回合：付的租金 ×${r.heartRentMult}，每回合开始 −${r.heartPills} 灵丹。走进别人所在的格子会把心魔转给对方。` });
    }
    if (p.hospitalTurns > 0) tags.push({ label: `医馆 ${p.hospitalTurns}`, desc: `中了爆炎阵，在医馆休养：还要停 ${p.hospitalTurns} 回合，期间不能行动。` });
    const traps = g.board.lands.filter((id) => state.tiles[id].owner === i && state.tiles[id].trap).length;
    if (traps) tags.push({ label: `禁制 ${traps}/${cfg.rules.trapMaxPerPlayer}`, desc: `在自己的洞府上布下的禁制：他人停留时交 ${cfg.rules.trapStones} 灵石并被定身 1 回合，触发后消耗。` });
    for (const [r, seat] of Object.entries(state.veinLords) as [keyof typeof state.veinLords, number | null][]) {
      if (seat !== i) continue;
      const region = g.data.board.regions[r];
      tags.push({
        label: `灵脉之主·${region.element}`,
        desc: `在${region.name}拥有的灵田最多且至少 ${cfg.veinLordMinLands} 块：+${cfg.veinLordCultivation} 修为，被反超即失去。`,
      });
    }
    const hero = g.data.heroes.find((h) => h.id === p.hero)!;
    const wait = p.skillReadyTurn - p.turnsTaken;
    tags.push({
      label: wait > 0 ? `技能 冷却 ${wait}` : '技能 就绪',
      desc: `【${hero.skill.name}】${hero.skill.desc}。不花灵丹，用后冷却 ${cfg.rules.skillCooldownTurns} 个自己的回合（按 K 或在「出符」菜单发动）。`,
    });
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
      `· 洞府首次建成${Object.keys(cfg.cultivationOnBuild).map((lv) => `${b[Number(lv)].name} +${cfg.cultivationOnBuild[lv]}`).join(' / ')}`,
      `· 灵脉之主（某灵域灵田最多且 ≥${cfg.veinLordMinLands} 块）：+${cfg.veinLordCultivation}`,
      '· 完成宗门任务：每张 +1',
      `· 对天魔造成最后一击：+${cfg.rules.demonLastHitCultivation}`,
      `· 五雷符让修为唯一第一者的洞府降级：+${cfg.rules.bountyCultivation}`,
      `· 斗法击败持悬赏令者：+${cfg.rules.bountyDuelCultivation}`,
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
