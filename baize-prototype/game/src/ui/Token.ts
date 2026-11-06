// One seat's figure on the board: a walker sprite whose feet sit on the container origin, a soft shadow and a
// ring in the seat's colour under them, and the current-turn pointer over its head. It faces the way it steps,
// cycles its walk frames while moving and bobs one pixel while it stands. Its feet stay on whole pixels.
import Phaser from 'phaser';
import { addImg, ensureCanvas, setFrame, TOKEN_FRAME, WALK_FRAMES, walkFrame, type WalkDir } from './assets';
import { DEPTH, facingFor, type Facing, type Point } from './world';

const POSE: Record<Facing, { dir: WalkDir; flip: boolean }> = {
  down: { dir: 'd', flip: false },
  up: { dir: 'u', flip: false },
  right: { dir: 's', flip: false },
  left: { dir: 's', flip: true },
};
/** Walk frames per step: a step lasts 240 ms at 1×, so the cycle runs near 8 fps and scales with game speed. */
const FRAMES_PER_STEP = 2;
const BOB_MS = 560;
const POINTER_Y = -60;
/** Head and body box around the feet, for camera focus, modals and floating labels. */
export const TOKEN_BOX = { w: 32, h: 52 };

function ensureTokenTextures(scene: Phaser.Scene): void {
  const ellipse = (key: string, w: number, h: number, paint: (inside: (x: number, y: number, k: number) => boolean, ctx: CanvasRenderingContext2D) => void): void =>
    ensureCanvas(scene, key, w, h, (ctx) => paint((x, y, k) => ((x + 0.5 - w / 2) / (w / 2 * k)) ** 2 + ((y + 0.5 - h / 2) / (h / 2 * k)) ** 2 <= 1, ctx));
  ellipse('tok_shadow', 26, 8, (inside, ctx) => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 26; x++) {
        if (!inside(x, y, 1)) continue;
        ctx.fillStyle = inside(x, y, 0.65) ? 'rgba(10,8,20,0.45)' : 'rgba(10,8,20,0.22)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  ellipse('tok_ring', 30, 10, (inside, ctx) => {
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) if (inside(x, y, 1) && !inside(x, y, 0.8)) ctx.fillRect(x, y, 1, 1);
  });
  ensureCanvas(scene, 'tok_pointer', 9, 5, (ctx) => {
    ctx.fillStyle = '#0f0e1a';
    for (let i = 0; i < 5; i++) ctx.fillRect(i, i, 9 - 2 * i, 1);
    ctx.fillStyle = '#ffffff';
    for (let i = 1; i < 4; i++) ctx.fillRect(i + 1, i, 7 - 2 * i, 1);
  });
}

export class Token {
  readonly root: Phaser.GameObjects.Container;
  private figure: Phaser.GameObjects.Image;
  private pointer: Phaser.GameObjects.Image;
  private facing: Facing = 'down';
  private phase = 0;
  private bob = 0;
  private cycle: Phaser.Time.TimerEvent | null = null;
  private halt: Phaser.Time.TimerEvent | null = null;
  /** True while a walk or glide tween owns the position. */
  moving = false;

  constructor(private scene: Phaser.Scene, private hero: string, private seat: number, colour: number) {
    ensureTokenTextures(scene);
    const shadow = scene.add.image(0, 0, 'tok_shadow').setDisplayOrigin(13, 4);
    const ring = scene.add.image(0, 0, 'tok_ring').setDisplayOrigin(15, 5).setTint(colour).setAlpha(0.85);
    this.figure = addImg(scene, 0, 0, walkFrame(hero, 'd', 0)).setDisplayOrigin(TOKEN_FRAME.footX, TOKEN_FRAME.footY);
    this.pointer = scene.add.image(0, POINTER_Y, 'tok_pointer').setDisplayOrigin(4, 5).setTint(colour).setVisible(false);
    this.root = scene.add.container(0, 0, [shadow, ring, this.figure, this.pointer]);
    scene.time.addEvent({ delay: BOB_MS, startAt: seat * 130, loop: true, callback: () => this.tickBob() });
  }

  get x(): number { return this.root.x; }
  get y(): number { return this.root.y; }

  place(p: Point): void {
    this.setFeet(p.x, p.y);
  }

  /** One step of travel with the walk cycle, turning to face it first. */
  walkTo(p: Point, ms: number): Promise<void> {
    this.facing = facingFor(this.root, p, this.facing);
    this.startCycle(ms / FRAMES_PER_STEP);
    return this.travel(p, ms, 'Linear').then(() => {
      this.halt = this.scene.time.delayedCall(ms / FRAMES_PER_STEP, () => this.stand());
    });
  }

  /** Slide flat in the stand pose, keeping the current facing (teleports, making room on a shared cell). */
  glideTo(p: Point, ms: number): Promise<void> {
    return this.travel(p, ms, 'Sine.easeInOut');
  }

  setCurrent(on: boolean): void {
    this.pointer.setVisible(on);
  }

  private travel(p: Point, ms: number, ease: string): Promise<void> {
    const at = { x: this.root.x, y: this.root.y };
    this.moving = true;
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: at, x: p.x, y: p.y, duration: ms, ease,
        onUpdate: () => this.setFeet(at.x, at.y),
        onComplete: () => {
          this.setFeet(p.x, p.y);
          this.moving = false;
          resolve();
        },
      });
    });
  }

  private setFeet(x: number, y: number): void {
    const fx = Math.round(x);
    const fy = Math.round(y);
    this.root.setPosition(fx, fy).setDepth(DEPTH.token(fy, this.seat));
  }

  private startCycle(frameMs: number): void {
    this.halt?.remove();
    this.halt = null;
    this.figure.y = 0;
    this.pose();
    if (this.cycle?.delay === frameMs) return;
    this.cycle?.remove();
    this.cycle = this.scene.time.addEvent({ delay: frameMs, loop: true, callback: () => this.advance() });
  }

  private advance(): void {
    this.phase = (this.phase + 1) % WALK_FRAMES;
    this.pose();
  }

  private stand(): void {
    this.cycle?.remove();
    this.cycle = null;
    this.halt = null;
    this.phase = 0;
    this.pose();
  }

  private tickBob(): void {
    this.bob ^= 1;
    if (!this.cycle) this.figure.y = -this.bob;
    this.pointer.y = POINTER_Y - 2 * this.bob;
  }

  private pose(): void {
    const { dir, flip } = POSE[this.facing];
    setFrame(this.figure, walkFrame(this.hero, dir, this.phase));
    this.figure.setFlipX(flip).setDisplayOrigin(TOKEN_FRAME.footX, TOKEN_FRAME.footY);
  }
}
