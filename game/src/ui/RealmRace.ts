// Right-column race to 化神: one row per seat in standing order, its 修为 laid out realm by realm toward the goal,
// with who leads and the win rule underneath. Hover for each seat's numbers. While the camera is zoomed in it folds
// to one line of seats in standing order, each with its realm (HudFold).
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { realmName } from '../core/rules';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { barSegments } from './hudReadout';
import { gather, HudFold } from './HudFold';
import { RACE, RIGHT, SLIM_RACE } from './layout';
import { raceView, winRule, type RaceRow, type RaceView } from './raceReadout';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import type { Tooltip } from './Tooltip';

const PAD = 8;
const HEAD_H = 16;
const ROW_H = 22;
const FACE = 20;
const TRACK_X = PAD + FACE + 6;
const GOAL_W = 26;
const GROUP_GAP = 4;
const CELL_GAP = 1;
const CELL_H = 10;
const SLIM_FACE = 16;
const SLIM_SEAT_W = 52;
const TRACK_W = RIGHT.w - TRACK_X - PAD - GOAL_W - GROUP_GAP;

export class RealmRace {
  private faces!: Phaser.GameObjects.Image[];
  private rings!: Phaser.GameObjects.Rectangle[];
  private track!: Phaser.GameObjects.Graphics;
  private lead!: Phaser.GameObjects.Text;
  private state: GameState;
  private slimFaces: Phaser.GameObjects.Image[] = [];
  private slimRealms: Phaser.GameObjects.Text[] = [];
  private fold: HudFold;

  constructor(scene: Phaser.Scene, private game: Game, tip: Tooltip) {
    this.state = game.state;
    const full = gather(scene, () => this.buildFull(scene, tip));
    const slim = gather(scene, () => this.buildSlim(scene));
    const { x, w } = RIGHT;
    this.fold = new HudFold(scene, full, slim, { x, y: RACE.y, w, h: RACE.h }, { x, y: RACE.y, w, h: SLIM_RACE.h });
    this.render(game.state);
  }

  /** Bottom edge of the panel in its current form, for what sits under it. */
  get bottom(): number {
    return RACE.y + (this.fold.folded ? SLIM_RACE.h : RACE.h);
  }

  setCompact(on: boolean): void {
    this.fold.setCompact(on);
  }

  render(state: GameState): void {
    this.state = state;
    const view = this.view();
    this.track.clear();
    view.rows.forEach((row, k) => this.paintRow(view, row, RACE.y + PAD + HEAD_H + k * ROW_H));
    this.lead.setText(view.lead);
    view.rows.forEach((row, k) => this.paintSlimSeat(row.seat, k));
  }

  private buildFull(scene: Phaser.Scene, tip: Tooltip): void {
    const { x, w } = RIGHT;
    const y = RACE.y;
    scene.add.rectangle(x, y, w, RACE.h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    this.track = scene.add.graphics();
    const view = this.view();
    this.addHeader(scene, view);
    this.rings = this.state.players.map((_, i) => scene.add.rectangle(0, 0, FACE + 2, FACE + 2).setOrigin(0, 0).setStrokeStyle(2, PLAYER_COLORS[i]));
    this.faces = this.state.players.map((p) => addImg(scene, 0, 0, `por_${p.hero}_s`).setOrigin(0, 0).setDisplaySize(FACE, FACE));
    const below = y + PAD + HEAD_H + view.rows.length * ROW_H + 2;
    this.lead = txt(scene, x + PAD, below, '', { size: FS.sm, color: HEX.gold });
    txt(scene, x + PAD, below + 19, winRule(this.game.data).join('\n'), { size: FS.sm, lineSpacing: 3 });
    tip.attach(x, y, w, RACE.h, () => ({ title: `${view.goal}之路`, body: this.tipBody() }));
  }

  private buildSlim(scene: Phaser.Scene): void {
    const { x, w } = RIGHT;
    const mid = RACE.y + SLIM_RACE.h / 2;
    scene.add.rectangle(x, RACE.y, w, SLIM_RACE.h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    txt(scene, x + PAD, mid, `${this.view().goal}之路`, { size: FS.xs, color: HEX.gold, bold: true, origin: [0, 0.5] });
    this.state.players.forEach((p) => {
      this.slimFaces.push(addImg(scene, 0, mid, `por_${p.hero}_s`).setOrigin(0, 0.5).setDisplaySize(SLIM_FACE, SLIM_FACE));
      this.slimRealms.push(txt(scene, 0, mid, '', { size: FS.xs, origin: [0, 0.5] }));
    });
  }

  /** Seat `seat` in standing place `k` on the folded line. */
  private paintSlimSeat(seat: number, k: number): void {
    const sx = RIGHT.x + RIGHT.w - PAD - (this.state.players.length - k) * SLIM_SEAT_W;
    this.slimFaces[seat].setX(sx);
    this.slimRealms[seat].setX(sx + SLIM_FACE + 3).setText(realmName(this.game.data, this.state.players[seat].realm)).setColor(PLAYER_HEX[seat]);
  }

  private view(): RaceView {
    return raceView(this.state, this.game.board, this.game.data);
  }

  private addHeader(scene: Phaser.Scene, view: RaceView): void {
    const y = RACE.y + PAD;
    view.realms.forEach((r, k) => {
      const g = groupSpan(view, k);
      txt(scene, g.x + g.w / 2, y, r.name, { size: FS.xs, color: HEX.dim, origin: [0.5, 0] });
    });
    txt(scene, RIGHT.x + RIGHT.w - PAD - GOAL_W / 2, y, view.goal, { size: FS.xs, color: HEX.gold, bold: true, origin: [0.5, 0] });
  }

  /** Seat portraits move with their row, since rows follow the standings. */
  private paintRow(view: RaceView, row: RaceRow, y: number): void {
    this.rings[row.seat].setPosition(RIGHT.x + PAD - 1, y - 1);
    this.faces[row.seat].setPosition(RIGHT.x + PAD, y);
    const cy = y + (FACE - CELL_H) / 2;
    const colour = PLAYER_COLORS[row.seat];
    view.realms.forEach((r, g) => {
      const span = groupSpan(view, g);
      let cx = span.x;
      barSegments(span.w, r.bar, CELL_GAP).forEach((cw, c) => {
        this.track.fillStyle(c < row.cells[g] ? colour : COLORS.disabled, 1).fillRect(cx, cy, cw, CELL_H);
        cx += cw + CELL_GAP;
      });
    });
    const gx = RIGHT.x + RIGHT.w - PAD - GOAL_W;
    this.track.fillStyle(row.ascended ? COLORS.gold : COLORS.ink, 1).fillRect(gx, cy - 2, GOAL_W, CELL_H + 4);
    this.track.lineStyle(1, COLORS.gold, 1).strokeRect(gx, cy - 2, GOAL_W, CELL_H + 4);
  }

  private tipBody(): string {
    const data = this.game.data;
    const lines = this.view().rows.map(({ seat }) => {
      const p = this.state.players[seat];
      const bar = data.config.realms[p.realm].bar;
      return bar > 0 ? `${p.name}：${realmName(data, p.realm)}，修为 ${p.cult}/${bar}` : `${p.name}：${realmName(data, p.realm)}`;
    });
    return [...winRule(data), '修为条满后闭关突破，才能进入下一境界。', '', ...lines].join('\n');
  }
}

/** Screen span of realm k's group of cells. */
function groupSpan(view: RaceView, k: number): { x: number; w: number } {
  const n = view.realms.length;
  const w = Math.floor((TRACK_W - (n - 1) * GROUP_GAP) / n);
  return { x: RIGHT.x + TRACK_X + k * (w + GROUP_GAP), w };
}
