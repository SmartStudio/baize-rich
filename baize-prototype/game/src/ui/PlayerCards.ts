// Player chips floating in the left margin: portrait, name, 修为, 灵石 and who is acting.
// Hovering the 修为 line explains it; clicking a chip pins a popover with everything else.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { breakthroughCost, breakthroughsAvailable, cultivation, realmName } from '../core/rules';
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

  render(state: GameState): void {
    const g = this.game;
    this.state = state;
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

  /** Everything the chip leaves out: resources, statuses, skill. */
  private detailTip(i: number): TipContent {
    const g = this.game;
    const cfg = g.data.config;
    const st = this.state;
    const p = st.players[i];
    const c = cultivation(st, g.data, i);
    const lines = [
      `${this.labels[i]} · 修为 ${c}/${cfg.winCultivation}`,
      `灵石 ${p.stones} · 灵丹 ${p.pills} · 符箓 ${p.hand.length}/${cfg.handLimit}`,
      this.cultTip(i).body.split('\n')[1],
      '',
      this.statusTip(i).body,
    ];
    return { title: `${p.name} · ${realmName(g.data, c)}`, body: lines.join('\n') };
  }

  private statusTags(state: GameState, i: number): StatusTag[] {
    const g = this.game;
    const cfg = g.data.config;
    const p = state.players[i];
    const tags: StatusTag[] = [];
    if (p.bound) tags.push({ label: '定身', desc: '中了定身符：下回合不能移动，原地结算。' });
    if (p.chooseRoll) tags.push({ label: '灵兽引路', desc: '下次移动的点数可在 1–6 中任选。' });
    if (p.dazed) tags.push({ label: '迷魂', desc: '中了迷魂丹：下一次掷骰移动的步数减半（向下取整，至少 1）。' });
    const hero = g.data.heroes.find((h) => h.id === p.hero)!;
    const wait = p.skillReadyTurn - p.turnsTaken;
    tags.push({
      label: wait > 0 ? `技能 冷却 ${wait}` : '技能 就绪',
      desc: `【${hero.skill.name}】${hero.skill.desc}。不花灵丹，用后冷却 ${cfg.rules.skillCooldownTurns} 个自己的回合（按 K 或在「出符」菜单发动）。\n被动【${hero.passive.name}】${hero.passive.desc}。`,
    });
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
        ? `突破机会 ${bt} 次：停在中央白泽灵台选「突破」（本次 ${breakthroughCost(st, g.data, i)} 灵丹）。`
        : next !== undefined ? `修为（历史最高）达到 ${next} 时获得下一次突破机会。` : '突破机会已全部获得。',
      '',
      '修为来源：',
      `· 洞府首次建成${Object.keys(cfg.cultivationOnBuild).map((lv) => `${b[Number(lv)].name} +${cfg.cultivationOnBuild[lv]}`).join(' / ')}`,
      '破产重整会失去修为。',
    ];
    return { title: `修为 ${c} / ${cfg.winCultivation} · ${realmName(g.data, c)}`, body: lines.join('\n') };
  }
}
