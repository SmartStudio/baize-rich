// The cells of a board pick (pickPlan.ts) drawn over the board: one tag per lit cell holding its number badge,
// its label and a line per cost. Tags read at the same screen size at either zoom and are placed by pickLayout
// so they never cover each other or a token. Clicks still land on BoardView's node zones.
import Phaser from 'phaser';
import type { Rect } from './layout';
import { placeTags, type Size } from './pickLayout';
import type { PickCell } from './pickPlan';
import { COLORS, FLOAT_ALPHA, FS, HEX, txt } from './theme';
import { DEPTH, type WorldMap } from './world';

const BADGE = 22;
const PAD = 3;
const COST_LINE = 15;

interface Tag {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  size: Size;
}

export class BoardPick {
  private layer: Phaser.GameObjects.Container;
  private zoom = 1;

  constructor(private scene: Phaser.Scene, private world: WorldMap) {
    this.layer = scene.add.container(0, 0).setDepth(DEPTH.top);
    const follow = (): void => this.followZoom();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, follow);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow));
  }

  /** `avoid`: world boxes no tag may cover (the tokens). */
  show(cells: readonly PickCell[], avoid: readonly Rect[]): void {
    this.clear();
    const tags = cells.map((cell) => this.tag(cell));
    const spots = placeTags(cells.map((c) => this.world.rect(c.node)), tags.map((t) => t.size), avoid);
    tags.forEach(({ root, body, size }, i) => {
      const { anchor, origin } = spots[i];
      root.setPosition(anchor.x, anchor.y).setScale(1 / this.zoom);
      body.setPosition(-origin[0] * size.w, -origin[1] * size.h);
      this.layer.add(root);
    });
    const primary = cells.findIndex((c) => c.primary);
    if (primary >= 0) {
      const body = tags[primary].body;
      this.scene.tweens.add({ targets: body, y: body.y - 2, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  clear(): void {
    for (const root of this.layer.list as Phaser.GameObjects.Container[]) this.scene.tweens.killTweensOf(root.list);
    this.layer.removeAll(true);
  }

  private followZoom(): void {
    const zoom = this.scene.cameras.main.zoom;
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    for (const root of this.layer.list as Phaser.GameObjects.Container[]) root.setScale(1 / zoom);
  }

  /** Badge and label on one row, each cost on its own line under them, on an ink plate. */
  private tag(cell: PickCell): Tag {
    const s = this.scene;
    const label = txt(s, PAD + BADGE + 4, PAD + BADGE / 2, cell.label, { size: FS.md, bold: true, color: HEX.parchment, origin: [0, 0.5] });
    const costs = (cell.sub?.split(' · ') ?? []).map((line) => txt(s, 0, 0, line, { size: FS.sm, color: HEX.gold, origin: [0.5, 0] }));
    const w = Math.ceil(Math.max(label.x + label.width + PAD, ...costs.map((t) => t.width + 2 * PAD)));
    const h = PAD + BADGE + costs.length * COST_LINE + PAD;
    costs.forEach((t, i) => t.setPosition(w / 2, PAD + BADGE + i * COST_LINE));
    const edge = cell.primary ? COLORS.gold : COLORS.focus;
    const plate = s.add.rectangle(0, 0, w, h, COLORS.ink, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(1, edge);
    const badge = s.add.rectangle(PAD, PAD, BADGE, BADGE, cell.primary ? COLORS.gold : COLORS.panel).setOrigin(0, 0).setStrokeStyle(1, COLORS.gold);
    const digit = txt(s, PAD + BADGE / 2, PAD + BADGE / 2, cell.key ?? '·', { size: FS.lg, bold: true, color: cell.primary ? HEX.ink : HEX.gold, origin: [0.5, 0.5] });
    const body = s.add.container(0, 0, [plate, badge, digit, label, ...costs]);
    return { root: s.add.container(0, 0, [body]), body, size: { w, h } };
  }
}
