import Phaser from 'phaser';
import type { GameRecord } from '../core/record';
import { addImg } from '../ui/assets';
import type { ResultRow, ResultView } from '../ui/resultReadout';
import { downloadRecord } from '../ui/saves';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from '../ui/theme';
import { Button, fadeToScene } from '../ui/widgets';

export interface ResultData {
  record: GameRecord;
  view: ResultView;
}

const ROW = { x: 240, y: 142, w: 800, h: 70, step: 76 };
const RECAP = { y: 452, top: 34, line: 21, pad: 8 };

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(d: ResultData): void {
    const v = d.view;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    txt(this, 640, 44, v.title, { size: 40, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    txt(this, 640, 90, v.sub, { size: 18, origin: [0.5, 0.5] });
    txt(this, 640, 120, v.rule, { size: 14, color: HEX.dim, origin: [0.5, 0.5] });
    v.rows.forEach((row, rank) => this.addRow(row, rank, ROW.y + rank * ROW.step));
    this.addRecap(v);
    txt(this, 640, 614, v.footer, { size: 14, color: HEX.dim, origin: [0.5, 0.5] });
    new Button(this, 300, 634, { w: 200, h: 52, label: '再来一局', size: 22, fill: 0x8a5a1e }).onClick(() => fadeToScene(this, 'HeroSelect'));
    new Button(this, 530, 634, { w: 220, h: 52, label: '下载对局记录', size: 20 }).onClick(() => downloadRecord(d.record));
    new Button(this, 780, 634, { w: 200, h: 52, label: '返回标题', size: 20 }).onClick(() => fadeToScene(this, 'Title'));
  }

  private addRow(row: ResultRow, rank: number, y: number): void {
    const first = rank === 0;
    panel(this, ROW.x, y, ROW.w, ROW.h, first ? COLORS.panelLight : COLORS.panel, first ? COLORS.gold : COLORS.outline);
    this.add.rectangle(ROW.x, y, 8, ROW.h, PLAYER_COLORS[row.seat]).setOrigin(0, 0);
    txt(this, 270, y + ROW.h / 2, `第 ${rank + 1}`, { size: 22, bold: true, origin: [0, 0.5], color: first ? HEX.gold : HEX.parchment });
    addImg(this, 350, y + 3, `por_${row.hero}`).setOrigin(0, 0);
    txt(this, 430, y + 8, `${row.name}  ${row.label}`, { size: 18, bold: true, color: PLAYER_HEX[row.seat] });
    this.addStats(row, y + 34);
    txt(this, 430, y + 54, row.extra, { size: 12, color: HEX.dim });
    txt(this, ROW.x + ROW.w - 16, y + 8, row.note, { size: 14, bold: true, color: HEX.gold, origin: [1, 0] });
  }

  /** The tie-break stats in a row; the one that settled this place is boxed in gold. */
  private addStats(row: ResultRow, y: number): void {
    let x = 430;
    for (const s of row.stats) {
      const t = txt(this, x + 4, y, s.text, { size: 14, bold: s.deciding, color: s.deciding ? HEX.gold : HEX.parchment });
      if (s.deciding) this.add.rectangle(x, y - 2, t.width + 8, t.height + 4).setOrigin(0, 0).setStrokeStyle(1.5, COLORS.gold);
      x += t.width + 20;
    }
  }

  private addRecap(v: ResultView): void {
    panel(this, ROW.x, RECAP.y, ROW.w, RECAP.top + v.recap.lines.length * RECAP.line + RECAP.pad, COLORS.panel, COLORS.gold);
    txt(this, ROW.x + 20, RECAP.y + 10, v.recap.title, { size: 16, bold: true, color: HEX.gold });
    v.recap.lines.forEach((line, i) => txt(this, ROW.x + 20, RECAP.y + 34 + i * RECAP.line, line, { size: 14 }));
  }
}
