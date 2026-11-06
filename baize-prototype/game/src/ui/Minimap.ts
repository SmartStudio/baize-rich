// HUD minimap under the utility pills: the board shrunk to fit, every node's top face in its region colour
// (or its owner's colour), each seat's token and the camera's viewport. Clicking or dragging on it pans the
// camera; the button under it recentres on the current token.
import Phaser from 'phaser';
import type { BoardData, GameState, NodeId } from '../core/types';
import { MINI, RIGHT, type Rect } from './layout';
import { COLORS, FLOAT_ALPHA, FS, PLAYER_COLORS } from './theme';
import { Button } from './widgets';
import type { Point, WorldMap } from './world';

const PAD = 6;
const NEUTRAL = 0x8a84a8;

export class Minimap {
  private owners: Phaser.GameObjects.Graphics;
  private live: Phaser.GameObjects.Graphics;
  readonly btnRecentre: Button;
  private scale: number;
  private ox: number;
  private oy: number;

  constructor(scene: Phaser.Scene, private world: WorldMap, data: BoardData, onPan: (p: Point) => void) {
    const b = world.bounds;
    const w = RIGHT.w;
    const y = RIGHT.utilY + RIGHT.utilH + MINI.gap;
    this.scale = Math.min((w - 2 * PAD) / b.w, (MINI.maxH - 2 * PAD) / b.h);
    const h = b.h * this.scale + 2 * PAD;
    this.ox = RIGHT.x + (w - b.w * this.scale) / 2;
    this.oy = y + PAD;

    const frame = scene.add.rectangle(RIGHT.x, y, w, h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    const nodes = scene.add.graphics();
    for (const n of data.nodes) {
      const colour = n.region ? Phaser.Display.Color.HexStringToColor(data.regions[n.region].color).color : NEUTRAL;
      nodes.fillStyle(colour, 1).fillRect(...this.face(n.id, 0.85));
    }
    this.owners = scene.add.graphics();
    this.live = scene.add.graphics();
    this.btnRecentre = new Button(scene, RIGHT.x, y + h + 4, { w, h: MINI.btnH, label: '回到棋子 · H', size: FS.sm });
    scene.add.container(0, 0, [frame, nodes, this.owners, this.live, this.btnRecentre]).setDepth(50);

    const pan = (p: Phaser.Input.Pointer): void => onPan({ x: b.x + (p.x - this.ox) / this.scale, y: b.y + (p.y - this.oy) / this.scale });
    frame.setInteractive({ useHandCursor: true });
    frame.on('pointerdown', pan);
    frame.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) pan(p); });
  }

  /** Owner colours, from a (snapshot) state. */
  render(state: GameState): void {
    this.owners.clear();
    for (const [id, t] of Object.entries(state.tiles)) {
      if (t.owner === null) continue;
      this.owners.fillStyle(PLAYER_COLORS[t.owner], 1).fillRect(...this.face(id, 0.5));
    }
  }

  /** Per frame: viewport rect, live token positions. */
  update(view: Rect, tokens: Point[], current: number): void {
    const g = this.live.clear();
    tokens.forEach((t, i) => {
      if (i === current) return;
      g.fillStyle(PLAYER_COLORS[i], 1).fillCircle(...this.pt(t), 3).lineStyle(1, COLORS.outline, 1).strokeCircle(...this.pt(t), 3);
    });
    const c = tokens[current];
    if (c) g.fillStyle(PLAYER_COLORS[current], 1).fillCircle(...this.pt(c), 4.5).lineStyle(1.5, 0xffffff, 1).strokeCircle(...this.pt(c), 4.5);
    const b = this.world.bounds;
    const x0 = Math.max(b.x, view.x);
    const y0 = Math.max(b.y, view.y);
    const x1 = Math.min(b.x + b.w, view.x + view.w);
    const y1 = Math.min(b.y + b.h, view.y + view.h);
    if (x1 > x0 && y1 > y0) g.lineStyle(1.5, 0xffffff, 0.9).strokeRect(...this.box({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
  }

  private pt(p: Point): [number, number] {
    const b = this.world.bounds;
    return [this.ox + (p.x - b.x) * this.scale, this.oy + (p.y - b.y) * this.scale];
  }

  /** A node's top face on the minimap, shrunk about its centre by `k`. */
  private face(id: NodeId, k: number): [number, number, number, number] {
    const r = this.world.rect(id);
    return this.box({ x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });
  }

  private box(r: Rect): [number, number, number, number] {
    const [x, y] = this.pt(r);
    return [x, y, Math.max(1, r.w * this.scale), Math.max(1, r.h * this.scale)];
  }
}
