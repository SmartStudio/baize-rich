// Speech bubble for one first-game sentence. It does not take the keyboard.
// GameScene dismisses it on a click or a key, then keeps handling that key.
import Phaser from 'phaser';
import type { CoachAt, CoachCue, CoachStep } from './coachTriggers';
import { LEFT, RIGHT, H, W, type Rect } from './layout';
import { COLORS, FS, HEX, txt } from './theme';

const BUBBLE_W = 260;
const DEPTH = 12000;

export class Coach {
  private root: Phaser.GameObjects.Container | null = null;
  private shown: CoachStep | null = null;
  private box: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private scene: Phaser.Scene) {}

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

function buildBubble(scene: Phaser.Scene, text: string, at: Rect): { root: Phaser.GameObjects.Container; box: Rect } {
  const body = txt(scene, 12, 10, text, { size: FS.md, color: HEX.ink, wrap: BUBBLE_W - 24 });
  const foot = txt(scene, 12, 16 + body.height, '点击或按任意键', { size: FS.xs, color: HEX.dim });
  const h = Math.ceil(foot.y + foot.height + 10);
  const origin = bubbleOrigin(at, BUBBLE_W, h);
  const bg = scene.add.rectangle(0, 0, BUBBLE_W, h, COLORS.parchment).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold);
  bg.setInteractive({ useHandCursor: true });
  const tail = bubbleTail(scene, at, origin, h);
  const root = scene.add.container(origin.x, origin.y, [bg, tail, body, foot]).setDepth(DEPTH);
  return { root, box: { x: origin.x, y: origin.y, w: BUBBLE_W, h } };
}

function bubbleOrigin(at: Rect, w: number, h: number): { x: number; y: number } {
  const gap = 14;
  const inLeft = at.x < LEFT.x + LEFT.w;
  const rightEdge = inLeft ? LEFT.x + LEFT.w : at.x + at.w;
  const onDock = at.x >= RIGHT.x;
  const limit = onDock ? W - 8 : RIGHT.x - gap;
  const right = rightEdge + gap;
  const left = at.x - gap - w;
  const side = right + w <= limit ? right : left >= 8 ? left : null;
  let x = side ?? 8;
  let y = at.y + at.h / 2 - h / 2;
  if (side === null) {
    y = at.y - h - gap;
    if (y < 8) y = at.y + at.h + gap;
    x = Math.max(8, Math.min(at.x, limit - w));
  }
  y = Math.max(8, Math.min(H - h - 8, y));
  return { x: Math.round(x), y: Math.round(y) };
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
