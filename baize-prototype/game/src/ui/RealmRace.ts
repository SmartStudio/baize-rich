// Right-column race to 化神: one row per seat in standing order, its 修为 laid out realm by realm toward the goal,
// with who leads and the win rule underneath. Hover for each seat's numbers.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { realmName } from '../core/rules';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { barSegments } from './hudReadout';
import { RACE, RIGHT } from './layout';
import { raceView, winRule, type RaceRow, type RaceView } from './raceReadout';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, txt } from './theme';
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
const TRACK_W = RIGHT.w - TRACK_X - PAD - GOAL_W - GROUP_GAP;

export class RealmRace {
  private faces: Phaser.GameObjects.Image[];
  private rings: Phaser.GameObjects.Rectangle[];
  private track: Phaser.GameObjects.Graphics;
  private lead: Phaser.GameObjects.Text;
  private state: GameState;

  constructor(scene: Phaser.Scene, private game: Game, tip: Tooltip) {
    const { x, w } = RIGHT;
    const y = RACE.y;
    this.state = game.state;
    scene.add.rectangle(x, y, w, RACE.h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    this.track = scene.add.graphics();
    const view = this.view();
    this.addHeader(scene, view);
    this.rings = game.state.players.map((_, i) => scene.add.rectangle(0, 0, FACE + 2, FACE + 2).setOrigin(0, 0).setStrokeStyle(2, PLAYER_COLORS[i]));
    this.faces = game.state.players.map((p) => addImg(scene, 0, 0, `por_${p.hero}_s`).setOrigin(0, 0).setDisplaySize(FACE, FACE));
    const below = y + PAD + HEAD_H + view.rows.length * ROW_H + 2;
    this.lead = txt(scene, x + PAD, below, '', { size: FS.sm, color: HEX.gold });
    txt(scene, x + PAD, below + 19, winRule(game.data).join('\n'), { size: FS.sm, lineSpacing: 3 });
    tip.attach(x, y, w, RACE.h, () => ({ title: `${view.goal}之路`, body: this.tipBody() }));
    this.render(game.state);
  }

  render(state: GameState): void {
    this.state = state;
    const view = this.view();
    this.track.clear();
    view.rows.forEach((row, k) => this.paintRow(view, row, RACE.y + PAD + HEAD_H + k * ROW_H));
    this.lead.setText(view.lead);
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
