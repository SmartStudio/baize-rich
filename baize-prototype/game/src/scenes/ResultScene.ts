import Phaser from 'phaser';
import { defaultData } from '../core/data';
import type { GameRecord } from '../core/record';
import type { GameState } from '../core/types';
import { addImg } from '../ui/assets';
import { resultNarration } from '../ui/narration';
import { downloadRecord } from '../ui/saves';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from '../ui/theme';
import { Button, fadeToScene } from '../ui/widgets';

export interface ResultData {
  record: GameRecord;
  state: GameState;
  ranking: number[];
  rows: { cult: number; realm: string; assets: number; label: string }[];
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(d: ResultData): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const st = d.state;
    const ending = resultNarration(defaultData, st);
    txt(this, 640, 70, ending.title, { size: 40, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    txt(this, 640, 120, ending.sub, { size: 18, origin: [0.5, 0.5] });
    d.ranking.forEach((seat, rank) => {
      const p = st.players[seat];
      const r = d.rows[seat];
      const name = defaultData.heroes.find((hero) => hero.id === p.hero)!.name;
      const succeeded = p.stats.breakthroughs - p.stats.breakthroughFails;
      const y = 170 + rank * 100;
      panel(this, 240, y, 800, 88, rank === 0 ? COLORS.panelLight : COLORS.panel, rank === 0 ? COLORS.gold : COLORS.outline);
      this.add.rectangle(240, y, 8, 88, PLAYER_COLORS[seat]).setOrigin(0, 0);
      txt(this, 270, y + 44, `第 ${rank + 1}`, { size: 22, bold: true, origin: [0, 0.5], color: rank === 0 ? HEX.gold : HEX.parchment });
      addImg(this, 350, y + 12, `por_${p.hero}`).setOrigin(0, 0);
      txt(this, 430, y + 14, `${name}  ${r.label}`, { size: 18, bold: true, color: PLAYER_HEX[seat] });
      txt(this, 430, y + 44, `${r.realm} · 修为 ${r.cult}    灵石 ${p.stones}    丹药 ${p.pills}    总资产 ${r.assets}`, { size: 14 });
      txt(this, 430, y + 66, `突破 ${succeeded} 成 / ${p.stats.breakthroughFails} 走火 · 炼丹 ${p.stats.pillsMade} · 斗法胜 ${p.stats.duelWins}`, { size: 12, color: HEX.dim });
    });
    txt(this, 640, 574, ending.footer, { size: 14, color: HEX.dim, origin: [0.5, 0.5] });
    new Button(this, 300, 600, { w: 200, h: 56, label: '再来一局', size: 22, fill: 0x8a5a1e }).onClick(() => fadeToScene(this, 'HeroSelect'));
    new Button(this, 530, 600, { w: 220, h: 56, label: '下载对局记录', size: 20 }).onClick(() => downloadRecord(d.record));
    new Button(this, 780, 600, { w: 200, h: 56, label: '返回标题', size: 20 }).onClick(() => fadeToScene(this, 'Title'));
  }
}
