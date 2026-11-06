// Player chips floating in the left margin: portrait, name, 修为, 灵石 and who is acting.
// Hovering the 修为 line explains it; clicking a chip pins a popover with everything else.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { skillTerms } from '../core/heroes';
import { barFull, barSize, insightBonus, isGlowing, realmName, winRealm } from '../core/rules';
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

const PORTRAIT = 40;
const TEXT_X = 60;
const BAR_W = LEFT.w - TEXT_X - 10;

export class PlayerCards {
  private views: ChipView[] = [];
  private tags: StatusTag[][] = [];
  private state: GameState;

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
      addImg(s, x + 9, y + (LEFT.chipH - PORTRAIT) / 2, `por_${p.hero}_s`).setOrigin(0, 0);
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

  render(state: GameState): void {
    const g = this.game;
    this.state = state;
    state.players.forEach((p, i) => {
      const v = this.views[i];
      const bar = barSize(g.data, p);
      const ready = barFull(g.data, p);
      const active = state.current === i && !state.over;
      v.frame.setStrokeStyle(active ? 3 : 2, active ? PLAYER_COLORS[i] : COLORS.outline).setFillStyle(active ? COLORS.panelLight : COLORS.panel, FLOAT_ALPHA);
      v.marker.setVisible(active);
      v.cultBar.width = bar > 0 ? Math.min(1, p.cult / bar) * BAR_W : BAR_W;
      v.cult.setText(`${realmName(g.data, p.realm)} ${p.cult}/${bar}${ready ? ' · 可闭关' : ''}`).setColor(ready ? HEX.gold : HEX.parchment);
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

  /** Everything the chip leaves out: resources, statuses, skill. */
  private detailTip(i: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const st = this.state;
    const p = st.players[i];
    const lines = [
      `${this.labels[i]} · 修为 ${p.cult}/${barSize(g.data, p)} · 心境 ${p.mind}`,
      `灵石 ${p.stones} · 丹药 ${p.pills} · 灵草 ${p.herbs} · 符箓 ${p.hand.length}/${cfg.handLimit}`,
      this.cultTip(i).body.split('\n')[1],
      '',
      this.statusTip(i).body,
    ];
    return { title: `${p.name} · ${realmName(g.data, p.realm)}`, body: lines.join('\n') };
  }

  private statusTags(state: GameState, i: number): StatusTag[] {
    const g = this.game;
    const cfg = g.data.config;
    const p = state.players[i];
    const tags: StatusTag[] = [];
    if (p.bound) tags.push({ label: '定身', desc: '中了定身符：下回合不能移动，原地结算。' });
    if (isGlowing(state, g.data, i)) tags.push({ label: '宝光', desc: `身怀 ${cfg.duel.glowAt} 颗以上丹药：斗法输了会被夺 ${cfg.duel.glowSteal} 颗。` });
    if (p.guidance > 0) tags.push({ label: '指点', desc: `下次闭关突破 +${cfg.breakthrough.guidanceBonus}。` });
    if (p.momentum) tags.push({ label: '战意', desc: `斗法得胜的余势：下次闭关突破 +${cfg.breakthrough.momentumBonus}，闭关时用掉。` });
    if (p.insight > 0) tags.push({ label: `感悟 ${p.insight}`, desc: `过目不忘：下次闭关突破 +${insightBonus(g.data, p)}，闭关时用尽。` });
    if (p.dazed) tags.push({ label: '迷魂', desc: '中了迷魂丹：下一次掷骰移动的步数减半（向下取整，至少 1）。' });
    const hero = g.data.heroes.find((h) => h.id === p.hero)!;
    const wait = p.skillReadyTurn - p.turnsTaken;
    tags.push({
      label: wait > 0 ? `技能 冷却 ${wait}` : '技能 就绪',
      desc: `【${hero.skill.name}】${hero.skill.desc}。${skillTerms(hero.skill)}（按 K 或在「出符」菜单发动）。\n被动【${hero.passive.name}】${hero.passive.desc}。`,
    });
    return tags;
  }

  private statusTip(i: number): TipContent {
    return { title: `${this.state.players[i].name} 的状态`, body: this.tags[i].map((t) => `${t.label}：${t.desc}`).join('\n') };
  }

  private cultTip(i: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const p = this.state.players[i];
    const realm = cfg.realms[p.realm];
    const top = p.realm >= winRealm(g.data);
    const lines = [
      '先突破到化神者获胜；否则秘境关闭时比境界。',
      top ? '已化神。' : `修为条满 ${realm.bar} 后，在白泽灵台或自家洞府闭关：2D6 + 加成 ≥ ${realm.target} 即突破。`,
      '',
      '修为来源：每回合吐纳 +1、洞府打坐、灵泉、阵眼、服丹。条满后多余的修为会溢出。',
      '突破失败：修为条减半，心境 +1（下次突破更稳）。',
    ];
    return { title: `${realmName(g.data, p.realm)} · 修为 ${p.cult}/${realm.bar}`, body: lines.join('\n') };
  }
}
