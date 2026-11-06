// The cells of a board pick (pickPlan.ts) drawn over the board: a number badge on each lit cell, its label
// along the bottom of the top face and any cost just above it, all inside the face so neighbours never overlap.
// Clicks still land on BoardView's node zones.
import Phaser from 'phaser';
import type { PickCell } from './pickPlan';
import { COLORS, FS, HEX, txt } from './theme';
import { DEPTH, type WorldMap } from './world';

const BADGE = 16;

export class BoardPick {
  private layer: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene, private world: WorldMap) {
    this.layer = scene.add.container(0, 0).setDepth(DEPTH.top);
  }

  show(cells: readonly PickCell[]): void {
    this.clear();
    for (const cell of cells) this.layer.add(this.mark(cell));
  }

  clear(): void {
    this.scene.tweens.killTweensOf(this.layer.list);
    this.layer.removeAll(true);
  }

  private mark(cell: PickCell): Phaser.GameObjects.Container {
    const s = this.scene;
    const r = this.world.rect(cell.node);
    const root = s.add.container(r.x, r.y);
    const fill = cell.primary ? COLORS.gold : COLORS.ink;
    root.add(s.add.rectangle(2, 2, BADGE, BADGE, fill).setOrigin(0, 0).setStrokeStyle(1, cell.primary ? COLORS.ink : COLORS.gold));
    const digit = cell.key ?? '·';
    root.add(txt(s, 2 + BADGE / 2, 2 + BADGE / 2, digit, { size: FS.sm, bold: true, color: cell.primary ? HEX.ink : HEX.gold, origin: [0.5, 0.5] }));
    const cx = r.w / 2;
    root.add(txt(s, cx, r.h - 1, cell.label, { size: FS.xs, bold: true, color: HEX.parchment, stroke: HEX.ink, origin: [0.5, 1] }));
    if (cell.sub) root.add(txt(s, cx, r.h - 13, cell.sub, { size: FS.xs, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 1] }));
    if (cell.primary) s.tweens.add({ targets: root, y: r.y - 2, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return root;
  }
}
