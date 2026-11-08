// Speech bubble for one first-game sentence. Only a click on the bubble closes it: every other click and key
// goes to the game as if it were not there, so "I read it" never gets mixed up with "I was doing something".
// It sits under modals, the alchemy overlay and cutscenes, so it never covers what the game is asking.
import Phaser from 'phaser';
import { bubbleOrigin } from './coachPlace';
import type { CoachAt, CoachCue, CoachStep } from './coachTriggers';
import { LEFT, type Rect } from './layout';
import { COLORS, FS, HEX, txt } from './theme';

const BUBBLE_W = 260;
const DEPTH = 9700;
const OK = { w: 64, h: 22 };

export class Coach {
  private root: Phaser.GameObjects.Container | null = null;
  private shown: CoachStep | null = null;
  private box: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private scene: Phaser.Scene, private onDismiss: () => void) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  get step(): CoachStep | null {
    return this.shown;
  }

  rect(): Rect {
    return this.box;
  }

  show(cue: CoachCue, at: Rect): void {
    this.clear();
    this.shown = cue.step;
    const built = buildBubble(this.scene, cue.text, at);
    built.hit.on('pointerdown', () => this.onDismiss());
    this.root = built.root;
    this.box = built.box;
  }

  /** Hides the bubble and returns the step that was up. */
  dismiss(): CoachStep | null {
    const step = this.shown;
    this.shown = null;
    this.clear();
    return step;
  }

  private clear(): void {
    this.root?.destroy(true);
    this.root = null;
  }
}

export function coachHudRect(at: CoachAt, seat: number): Rect | null {
  if (at.t === 'round') return { x: LEFT.x, y: LEFT.lineY, w: LEFT.w, h: LEFT.lineH };
  if (at.t === 'cult') return seatRect(seat, 40, 52, LEFT.w - 60, 12);
  if (at.t === 'herbs') return seatRect(seat, 6, 52, 48, 18);
  if (at.t === 'glow') return seatRect(seat, 0, 0, LEFT.w, LEFT.chipH);
  return null;
}

function seatRect(seat: number, dx: number, dy: number, w: number, h: number): Rect {
  const y = LEFT.chipY + seat * (LEFT.chipH + LEFT.chipGap);
  return { x: LEFT.x + dx, y: y + dy, w, h };
}

/** The parchment bubble with its 知道了 button; `hit` is the whole bubble, the button only shows where to click. */
function buildBubble(scene: Phaser.Scene, text: string, at: Rect): { root: Phaser.GameObjects.Container; hit: Phaser.GameObjects.Rectangle; box: Rect } {
  const body = txt(scene, 12, 10, text, { size: FS.md, color: HEX.ink, wrap: BUBBLE_W - 24 });
  const okY = Math.ceil(16 + body.height);
  const h = okY + OK.h + 10;
  const foot = txt(scene, 12, okY + OK.h / 2, '其他操作照常', { size: FS.xs, color: HEX.dim, origin: [0, 0.5] });
  const okBg = scene.add.rectangle(BUBBLE_W - 12 - OK.w, okY, OK.w, OK.h, COLORS.gold).setOrigin(0, 0).setStrokeStyle(1, COLORS.outline);
  const ok = txt(scene, BUBBLE_W - 12 - OK.w / 2, okY + OK.h / 2, '知道了', { size: FS.sm, bold: true, color: HEX.ink, origin: [0.5, 0.5] });
  const origin = bubbleOrigin(at, BUBBLE_W, h);
  const bg = scene.add.rectangle(0, 0, BUBBLE_W, h, COLORS.parchment).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold);
  bg.setInteractive({ useHandCursor: true });
  const tail = bubbleTail(scene, at, origin, h);
  const root = scene.add.container(origin.x, origin.y, [bg, tail, body, foot, okBg, ok]).setDepth(DEPTH).setName('coach');
  return { root, hit: bg, box: { x: origin.x, y: origin.y, w: BUBBLE_W, h } };
}

function bubbleTail(scene: Phaser.Scene, at: Rect, origin: { x: number; y: number }, h: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(COLORS.gold, 1);
  const ax = at.x + at.w / 2;
  const ay = at.y + at.h / 2;
  const midY = clamp(ay - origin.y, 18, h - 18);
  const midX = clamp(ax - origin.x, 18, BUBBLE_W - 18);
  if (ax >= origin.x + BUBBLE_W) g.fillTriangle(BUBBLE_W - 1, midY - 7, BUBBLE_W - 1, midY + 7, BUBBLE_W + 10, midY);
  else if (ax <= origin.x) g.fillTriangle(1, midY - 7, 1, midY + 7, -10, midY);
  else if (ay >= origin.y + h) g.fillTriangle(midX - 7, h - 1, midX + 7, h - 1, midX, h + 10);
  else g.fillTriangle(midX - 7, 1, midX + 7, 1, midX, -10);
  return g;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
