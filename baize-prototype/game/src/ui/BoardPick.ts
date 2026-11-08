// The cells of a board pick (pickPlan.ts) drawn over the board: one tag per lit cell holding its number badge,
// its label and a line per cost. Tags read at the same screen size at either zoom and are placed by pickLayout
// on the visible board, off the HUD panels; the layout is redone each time the camera comes to rest somewhere new.
// Clicks still land on BoardView's node zones.
import Phaser from 'phaser';
import type { Rect } from './layout';
import { boardFrame, placeTags, type Size } from './pickLayout';
import type { PickCell } from './pickPlan';
import { COLORS, FLOAT_ALPHA, FS, HEX, txt } from './theme';
import { DEPTH, type View, type WorldMap } from './world';

const BADGE = 22;
const PAD = 3;
const COST_LINE = 15;

interface Tag {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Rectangle;
  costs: Phaser.GameObjects.Text[];
  /** Screen size with all its cost lines, then with one fewer each, down to the badge row alone. */
  sizes: Size[];
}

export class BoardPick {
  private layer: Phaser.GameObjects.Container;
  private tags: Tag[] = [];
  private cells: readonly PickCell[] = [];
  private avoid: readonly Rect[] = [];
  /** The view the tags are laid out for, and the view seen last frame. */
  private solved: View | null = null;
  private last: View | null = null;

  constructor(private scene: Phaser.Scene, private world: WorldMap) {
    this.layer = scene.add.container(0, 0).setDepth(DEPTH.top);
    const follow = (): void => this.followCamera();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, follow);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow));
  }

  /** `avoid`: world boxes no tag may cover (the tokens). */
  show(cells: readonly PickCell[], avoid: readonly Rect[]): void {
    this.clear();
    this.cells = cells;
    this.avoid = avoid;
    this.tags = cells.map((cell) => this.tag(cell));
    this.tags.forEach((t) => this.layer.add(t.root));
    this.layout(this.view());
  }

  clear(): void {
    for (const t of this.tags) this.scene.tweens.killTweensOf(t.body);
    this.layer.removeAll(true);
    this.tags = [];
    this.solved = null;
  }

  private view(): View {
    const cam = this.scene.cameras.main;
    return { cx: cam.midPoint.x, cy: cam.midPoint.y, zoom: cam.zoom };
  }

  /** Keep tags at screen size through a zoom step, and lay them out again once the camera rests on a new view. */
  private followCamera(): void {
    if (this.tags.length === 0) return;
    const v = this.view();
    const resting = this.last !== null && same(v, this.last);
    this.last = v;
    if (resting && !same(v, this.solved!)) this.layout(v);
    else for (const t of this.tags) t.root.setScale(1 / v.zoom);
  }

  private layout(v: View): void {
    this.solved = v;
    const spots = placeTags(this.cells.map((c) => this.world.rect(c.node)), this.tags.map((t) => t.sizes), this.avoid, boardFrame(v));
    this.tags.forEach((t, i) => {
      const { anchor, origin, variant } = spots[i];
      const size = t.sizes[variant];
      t.costs.forEach((c, k) => c.setVisible(k < t.costs.length - variant).setX(size.w / 2));
      t.plate.setSize(size.w, size.h);
      t.root.setPosition(anchor.x, anchor.y).setScale(1 / v.zoom);
      this.scene.tweens.killTweensOf(t.body);
      t.body.setPosition(-origin[0] * size.w, -origin[1] * size.h);
    });
    const primary = this.cells.findIndex((c) => c.primary);
    if (primary >= 0) {
      const body = this.tags[primary].body;
      this.scene.tweens.add({ targets: body, y: body.y - 2, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** Badge and label on one row, each cost on its own line under them, on an ink plate. */
  private tag(cell: PickCell): Tag {
    const s = this.scene;
    const label = txt(s, PAD + BADGE + 4, PAD + BADGE / 2, cell.label, { size: FS.md, bold: true, color: HEX.parchment, origin: [0, 0.5] });
    const costs = (cell.sub?.split(' · ') ?? []).map((line) => txt(s, 0, 0, line, { size: FS.sm, color: HEX.gold, origin: [0.5, 0] }));
    const rowW = label.x + label.width + PAD;
    const sizes = costs.map((_, k) => sizeWith(rowW, costs.slice(0, costs.length - k))).concat(sizeWith(rowW, []));
    costs.forEach((t, i) => t.setY(PAD + BADGE + i * COST_LINE));
    const edge = cell.primary ? COLORS.gold : COLORS.focus;
    const plate = s.add.rectangle(0, 0, sizes[0].w, sizes[0].h, COLORS.ink, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(1, edge);
    const badge = s.add.rectangle(PAD, PAD, BADGE, BADGE, cell.primary ? COLORS.gold : COLORS.panel).setOrigin(0, 0).setStrokeStyle(1, COLORS.gold);
    const digit = txt(s, PAD + BADGE / 2, PAD + BADGE / 2, cell.key ?? '·', { size: FS.lg, bold: true, color: cell.primary ? HEX.ink : HEX.gold, origin: [0.5, 0.5] });
    const body = s.add.container(0, 0, [plate, badge, digit, label, ...costs]);
    return { root: s.add.container(0, 0, [body]), body, plate, costs, sizes };
  }
}

function sizeWith(rowW: number, costs: Phaser.GameObjects.Text[]): Size {
  return { w: Math.ceil(Math.max(rowW, ...costs.map((t) => t.width + 2 * PAD))), h: PAD + BADGE + costs.length * COST_LINE + PAD };
}

function same(a: View, b: View): boolean {
  return a.cx === b.cx && a.cy === b.cy && a.zoom === b.zoom;
}
