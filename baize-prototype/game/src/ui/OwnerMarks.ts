// Who owns which land, readable at zoom 1 at every level: a pennant in the owner's colour planted on the land's
// front-left corner, and the owner's colour washed over its top face inside a rim that doubles once the owner
// holds the whole street. Cloth and wash are white, tinted per seat.
import Phaser from 'phaser';
import type { Board } from '../core/board';
import type { GameState, NodeId } from '../core/types';
import { STAND_DY } from './Ambient';
import { ensureCanvas } from './assets';
import { paintPixels } from './sprites';
import { PLAYER_COLORS } from './theme';
import { DEPTH, type Point, type WorldMap } from './world';

const POLE = ['yY', 'Yy', ...Array<string>(13).fill('nN')];
/** Two flutter frames of a swallow-tailed pennant flying right from the pole; `m` is the fold shading. */
const CLOTH = [
  [
    'WWWWWWWWWWW',
    'mWWWWWWWWW.',
    'mmWWWWWWW..',
    'mWWWWWWW...',
    'mmWWWWWWW..',
    'mWWWWWWWWW.',
    'WWWWWWWWWWW',
  ],
  [
    'WWWWWmWWWWW',
    'WWWWmmWWWW.',
    'WWWWWmWWW..',
    'WWWWmmWW...',
    'WWWWWmWWW..',
    'WWWWmmWWWW.',
    'WWWWWmWWWWW',
  ],
];
/** The pole's foot, from the top face's front-left corner. Tokens and buildings keep the middle of the face. */
const FOOT = { dx: 2, dy: -2 };
/** The cloth hangs off the pole's right outline, just under the finial. */
const CLOTH_AT = { dx: 3, dy: 3 };
const FLUTTER_MS = 520;
/** A new pennant falls this far onto its pole foot. */
const PLANT_DROP = 14;
const WASH_ALPHA = 0.22;

interface Mark {
  wash: Phaser.GameObjects.Image;
  flag: Phaser.GameObjects.Container;
  cloth: Phaser.GameObjects.Image;
  /** Neighbouring flags flutter out of step, so the board ripples instead of blinking. */
  phase: number;
}

/** A pixel map painted 1:1 with its outline, so the canvas is the map plus one pixel on every side. */
function pixelKey(scene: Phaser.Scene, key: string, rows: string[]): string {
  const w = rows[0].length + 2;
  const h = rows.length + 2;
  ensureCanvas(scene, key, w, h, (ctx) => paintPixels(ctx, w, h, { rows, scale: 1 }));
  return key;
}

/** The owner's wash over a w×h top face: a faint fill inside a 2-px rim, a second rim inside it for a whole street. */
function washKey(scene: Phaser.Scene, w: number, h: number, street: boolean): string {
  const key = `own_wash_${w}x${h}${street ? '_street' : ''}`;
  ensureCanvas(scene, key, w, h, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = WASH_ALPHA;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    if (street) ctx.strokeRect(7, 7, w - 14, h - 14);
  });
  return key;
}

export class OwnerMarks {
  private marks = new Map<NodeId, Mark>();
  private tick = 0;
  private flutterTimer: Phaser.Time.TimerEvent;

  constructor(private scene: Phaser.Scene, private world: WorldMap, private board: Board) {
    for (const id of board.allNodeIds()) if (board.node(id).type === 'land') this.marks.set(id, this.mount(id));
    const washes = [...this.marks.values()].map((m) => m.wash);
    scene.tweens.add({ targets: washes, alpha: 0.6, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.flutterTimer = scene.time.addEvent({ delay: FLUTTER_MS, loop: true, callback: () => this.flutter() });
  }

  private mount(id: NodeId): Mark {
    const s = this.scene;
    const r = this.world.rect(id);
    const f = this.world.footprint(id);
    const wash = s.add.image(r.x, r.y, washKey(s, r.w, r.h, false)).setOrigin(0, 0).setDepth(DEPTH.face(f.r0)).setVisible(false);
    const pole = s.add.image(0, 0, pixelKey(s, 'own_pole', POLE)).setOrigin(0, 1);
    const cloth = s.add.image(CLOTH_AT.dx, CLOTH_AT.dy - pole.height, pixelKey(s, 'own_cloth0', CLOTH[0])).setOrigin(0, 0);
    pixelKey(s, 'own_cloth1', CLOTH[1]);
    // Sorted on the building's foot line: drawn over the building, under any token standing on the cell.
    const buildingFoot = r.y + r.h / 2 + STAND_DY;
    const flag = s.add.container(r.x + FOOT.dx, r.y + r.h + FOOT.dy, [pole, cloth])
      .setDepth(DEPTH.stand(buildingFoot) + 0.05).setVisible(false);
    return { wash, flag, cloth, phase: (f.c0 + f.r0) % CLOTH.length };
  }

  private flutter(): void {
    // The title scene paints a board once and destroys its objects; the clock outlives them.
    if ([...this.marks.values()].some((m) => !m.cloth.active)) {
      this.flutterTimer.remove();
      return;
    }
    this.tick = (this.tick + 1) % CLOTH.length;
    for (const m of this.marks.values()) m.cloth.setTexture(`own_cloth${(this.tick + m.phase) % CLOTH.length}`);
  }

  /** Paint every tile's marks from a state, except the `held` ones (their purchase has not landed yet). */
  render(state: GameState, held: ReadonlySet<NodeId> = new Set()): void {
    for (const id of this.marks.keys()) if (!held.has(id)) this.paint(id, state);
  }

  /** Paint one tile's marks; a pennant that was not up drops onto its pole foot over `ms`, a pixel at a time. */
  plant(id: NodeId, state: GameState, ms: number): void {
    const m = this.marks.get(id);
    if (!m) return;
    const was = m.flag.visible;
    this.paint(id, state);
    if (was || !m.flag.visible || ms <= 0) return;
    const rest = m.flag.y;
    const t = { k: 0 };
    m.flag.setY(rest - PLANT_DROP);
    this.scene.tweens.add({
      targets: t, k: 1, duration: ms, ease: 'Bounce.easeOut',
      onUpdate: () => m.flag.setY(Math.round(rest - PLANT_DROP * (1 - t.k))),
      onComplete: () => m.flag.setY(rest),
    });
  }

  /** World point at the pennant's cloth, where the stones that buy a bare tile land. */
  flagAt(id: NodeId): Point {
    const r = this.world.rect(id);
    return { x: r.x + FOOT.dx + CLOTH_AT.dx + 5, y: r.y + r.h + FOOT.dy - POLE.length + CLOTH_AT.dy + 4 };
  }

  private paint(id: NodeId, state: GameState): void {
    const m = this.marks.get(id)!;
    const { owner } = state.tiles[id];
    m.wash.setVisible(owner !== null);
    m.flag.setVisible(owner !== null);
    if (owner === null) return;
    const street = this.board.streetOf(id);
    const whole = street.length > 0 && street.every((s) => state.tiles[s].owner === owner);
    const r = this.world.rect(id);
    m.wash.setTexture(washKey(this.scene, r.w, r.h, whole)).setTint(PLAYER_COLORS[owner]);
    m.cloth.setTint(PLAYER_COLORS[owner]);
  }
}
