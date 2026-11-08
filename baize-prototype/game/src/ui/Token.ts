// One seat's figure on the board: a walker sprite whose feet sit on the container origin, a soft shadow and a
// ring in the seat's colour under them, and the current-turn pointer over its head. It faces the way it steps,
// cycles its walk frames while moving and bobs one pixel while it stands. Its feet stay on whole pixels.
// A light rim around its figure keeps it readable on dark art. While art in front covers it, an outline of its
// figure in the seat's colour draws above the whole board.
import Phaser from 'phaser';
import { addImg, ensureCanvas, frameRef, setFrame, TOKEN_FRAME, WALK_FRAMES, walkFrame, type WalkDir } from './assets';
import type { Rect } from './layout';
import { COLORS } from './theme';
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
/** The rim's share of the seat colour; the rest is parchment, so the rim reads as light, not as a pick highlight. */
const RIM_TINT = 0.3;
const RIM_ALPHA = 0.85;
/** Above every landmark, building and token, under the board's labels. */
const XRAY_DEPTH = DEPTH.top - 1;

/** The 1-px ring of pixels around a frame's figure, white so it tints: the token's rim and its x-ray. */
function outlineKey(scene: Phaser.Scene, name: string): string {
  const key = `outline_${name}`;
  const [texKey, frameName] = frameRef(scene, name);
  const f = scene.textures.getFrame(texKey, frameName);
  const { cutX, cutY, cutWidth: w, cutHeight: h } = f;
  ensureCanvas(scene, key, w, h, (ctx) => {
    ctx.drawImage(f.source.image as CanvasImageSource, cutX, cutY, w, h, 0, 0, w, h);
    const alpha = ctx.getImageData(0, 0, w, h).data;
    const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && alpha[(y * w + x) * 4 + 3] > 0;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return key;
}

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
  private rim: Phaser.GameObjects.Image;
  private xray: Phaser.GameObjects.Image;
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
    this.rim = scene.add.image(0, 0, '__DEFAULT').setTint(rimColour(colour)).setAlpha(RIM_ALPHA);
    this.pointer = scene.add.image(0, POINTER_Y, 'tok_pointer').setDisplayOrigin(4, 5).setTint(colour).setVisible(false);
    this.root = scene.add.container(0, 0, [shadow, ring, this.rim, this.figure, this.pointer]);
    this.xray = scene.add.image(0, 0, '__DEFAULT').setTint(colour).setDepth(XRAY_DEPTH).setVisible(false);
    this.pose();
    scene.time.addEvent({ delay: BOB_MS, startAt: seat * 130, loop: true, callback: () => this.tickBob() });
  }

  get x(): number { return this.root.x; }
  get y(): number { return this.root.y; }
  get depth(): number { return this.root.depth; }

  /** Head and body box around the feet, in world px. */
  get box(): Rect {
    return { x: this.x - TOKEN_BOX.w / 2, y: this.y - TOKEN_BOX.h, w: TOKEN_BOX.w, h: TOKEN_BOX.h };
  }

  /** Show or hide the x-ray outline, for while art drawn in front covers the figure. */
  setCovered(on: boolean): void {
    if (this.xray.visible === on) return;
    this.xray.setVisible(on);
    this.syncXray();
  }

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

  /** Turn on the spot toward a point, keeping the stand pose. */
  face(p: Point): void {
    this.facing = facingFor(this.root, p, this.facing);
    this.pose();
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
    this.syncXray();
  }

  private startCycle(frameMs: number): void {
    this.halt?.remove();
    this.halt = null;
    this.figure.y = this.rim.y = 0;
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
    if (!this.cycle) this.figure.y = this.rim.y = -this.bob;
    this.pointer.y = POINTER_Y - 2 * this.bob;
    this.syncXray();
  }

  private pose(): void {
    const { dir, flip } = POSE[this.facing];
    setFrame(this.figure, walkFrame(this.hero, dir, this.phase));
    this.figure.setFlipX(flip).setDisplayOrigin(TOKEN_FRAME.footX, TOKEN_FRAME.footY);
    this.rim.setTexture(outlineKey(this.scene, walkFrame(this.hero, dir, this.phase))).setFlipX(flip)
      .setDisplayOrigin(TOKEN_FRAME.footX, TOKEN_FRAME.footY);
    this.syncXray();
  }

  private syncXray(): void {
    if (!this.xray.visible) return;
    const { dir, flip } = POSE[this.facing];
    this.xray.setTexture(outlineKey(this.scene, walkFrame(this.hero, dir, this.phase))).setFlipX(flip)
      .setDisplayOrigin(TOKEN_FRAME.footX, TOKEN_FRAME.footY).setPosition(this.x, this.y + this.figure.y);
  }
}

function rimColour(seat: number): number {
  const mix = (shift: number): number => {
    const a = (seat >> shift) & 0xff;
    const b = (COLORS.parchment >> shift) & 0xff;
    return Math.round(a * RIM_TINT + b * (1 - RIM_TINT)) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}
