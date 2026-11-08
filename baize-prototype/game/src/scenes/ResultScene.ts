import Phaser from 'phaser';
import { sound } from '../audio/Sound';
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
/** Rows rise in from last place up, the winner last and from further down; times in ms. */
const ENTER = { fadeMs: 400, firstMs: 350, stepMs: 110, rowMs: 260, risePx: 18, winnerRisePx: 40, winnerMs: 420 };

type Part = Phaser.GameObjects.GameObject;

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(d: ResultData): void {
    const v = d.view;
    this.cameras.main.setBackgroundColor(COLORS.bg).fadeIn(ENTER.fadeMs, 15, 14, 26);
    sound.music('title');
    txt(this, 640, 44, v.title, { size: 40, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    txt(this, 640, 90, v.sub, { size: 18, origin: [0.5, 0.5] });
    txt(this, 640, 120, v.rule, { size: 14, color: HEX.dim, origin: [0.5, 0.5] });
    const rows = v.rows.map((row, rank) => this.add.container(0, 0, this.addRow(row, rank, ROW.y + rank * ROW.step)));
    rows.forEach((c, rank) => this.enter(c, rank, rows.length));
    this.addRecap(v);
    if (v.verdict) txt(this, 640, 614, `下局试试：${v.verdict.tip}`, { size: 15, bold: true, color: HEX.good, origin: [0.5, 0.5] });
    else txt(this, 640, 614, v.footer, { size: 14, color: HEX.dim, origin: [0.5, 0.5] });
    new Button(this, 300, 634, { w: 200, h: 52, label: '再来一局', size: 22, fill: 0x8a5a1e }).onClick(() => fadeToScene(this, 'HeroSelect'));
    new Button(this, 530, 634, { w: 220, h: 52, label: '下载对局记录', size: 20 }).onClick(() => downloadRecord(d.record));
    new Button(this, 780, 634, { w: 200, h: 52, label: '返回标题', size: 20 }).onClick(() => fadeToScene(this, 'Title'));
  }

  /** A row slides up into place on whole pixels; the winner's comes last, from further down, and overshoots. */
  private enter(row: Phaser.GameObjects.Container, rank: number, count: number): void {
    const first = rank === 0;
    const rise = first ? ENTER.winnerRisePx : ENTER.risePx;
    const t = { k: 0 };
    row.setAlpha(0).setY(rise).setDepth(first ? 1 : 0);
    this.tweens.add({
      targets: t, k: 1,
      delay: ENTER.firstMs + (count - 1 - rank) * ENTER.stepMs,
      duration: first ? ENTER.winnerMs : ENTER.rowMs,
      ease: first ? 'Back.easeOut' : 'Cubic.easeOut',
      onUpdate: () => row.setY(Math.round(rise * (1 - t.k))).setAlpha(Math.min(1, t.k * 2)),
      onComplete: () => row.setY(0).setAlpha(1),
    });
  }

  private addRow(row: ResultRow, rank: number, y: number): Part[] {
    const first = rank === 0;
    return [
      panel(this, ROW.x, y, ROW.w, ROW.h, first ? COLORS.panelLight : COLORS.panel, first ? COLORS.gold : COLORS.outline),
      this.add.rectangle(ROW.x, y, 8, ROW.h, PLAYER_COLORS[row.seat]).setOrigin(0, 0),
      txt(this, 270, y + ROW.h / 2, `第 ${rank + 1}`, { size: 22, bold: true, origin: [0, 0.5], color: first ? HEX.gold : HEX.parchment }),
      addImg(this, 350, y + 3, `por_${row.hero}`).setOrigin(0, 0),
      txt(this, 430, y + 8, `${row.name}  ${row.label}`, { size: 18, bold: true, color: PLAYER_HEX[row.seat] }),
      ...this.addStats(row, y + 34),
      txt(this, 430, y + 54, row.extra, { size: 12, color: HEX.dim }),
      txt(this, ROW.x + ROW.w - 16, y + 8, row.note, { size: 14, bold: true, color: HEX.gold, origin: [1, 0] }),
    ];
  }

  /** The tie-break stats in a row; the one that settled this place is boxed in gold. */
  private addStats(row: ResultRow, y: number): Part[] {
    const parts: Part[] = [];
    let x = 430;
    for (const s of row.stats) {
      const t = txt(this, x + 4, y, s.text, { size: 14, bold: s.deciding, color: s.deciding ? HEX.gold : HEX.parchment });
      parts.push(t);
      if (s.deciding) parts.push(this.add.rectangle(x, y - 2, t.width + 8, t.height + 4).setOrigin(0, 0).setStrokeStyle(1.5, COLORS.gold));
      x += t.width + 20;
    }
    return parts;
  }

  private addRecap(v: ResultView): void {
    panel(this, ROW.x, RECAP.y, ROW.w, RECAP.top + v.recap.lines.length * RECAP.line + RECAP.pad, COLORS.panel, COLORS.gold);
    const title = v.verdict ? `${v.recap.title} · ${v.verdict.standing}` : v.recap.title;
    txt(this, ROW.x + 20, RECAP.y + 10, title, { size: 16, bold: true, color: HEX.gold });
    v.recap.lines.forEach((line, i) => txt(this, ROW.x + 20, RECAP.y + 34 + i * RECAP.line, line, { size: 14 }));
  }
}
