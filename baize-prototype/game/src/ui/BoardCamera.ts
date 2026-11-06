// Drives GameScene's main camera over the board world. It eases toward a goal view each frame; what the
// goal is depends on one mode:
//   follow — keep a seat's token inside a calm dead zone (and always inside the HUD-free SAFE area),
//   frame  — fit a world rect (choice targets, both ends of a teleport) into the SAFE area,
//   free   — the player dragged / zoomed / used the minimap; nothing moves the camera until the next
//            turn start or 回到棋子.
// The goal zoom is always one of ZOOMS; the view tweens between them and snaps onto the goal when it settles.
import Phaser from 'phaser';
import { H, SAFE, W, type Rect } from './layout';
import { keepInside, rectCentre, rectToScreen, toWorld, viewRect, ZOOMS, type Point, type View, type WorldMap, type Zoom } from './world';

type Mode =
  | { kind: 'follow'; seat: number }
  | { kind: 'frame'; rect: Rect; seat: number }
  | { kind: 'free' };

/** Screen box the followed token may wander in before the camera moves. */
const DEADZONE: Rect = { x: SAFE.x + SAFE.w * 0.25, y: SAFE.y + SAFE.h * 0.22, w: SAFE.w * 0.5, h: SAFE.h * 0.56 };
/** Hard limit: the followed token never leaves this box, however fast it moves. */
const KEEP: Rect = { x: SAFE.x + 40, y: SAFE.y + 50, w: SAFE.w - 80, h: SAFE.h - 70 };
/** Easing time constant at 1× speed, in ms; faster game speeds ease proportionally faster. */
const EASE_MS = 160;
const DRAG_START_PX = 6;
/** Wheel travel (summed deltaY) that steps one zoom level; a trackpad flick sums many small deltas. */
const WHEEL_STEP = 60;
/** Pinch spread ratio that steps one zoom level. */
const PINCH_STEP = 1.25;
/** Below this distance (screen px) and zoom difference the view lands exactly on its goal. */
const SNAP_PX = 0.5;
const SNAP_ZOOM = 1e-3;

export class BoardCamera {
  private view: View;
  private goal: View;
  /** The zoom the player chose; follow mode returns to it. */
  private userZoom: Zoom = 1;
  private mode: Mode = { kind: 'free' };
  private press: { start: Point; view: View } | null = null;
  private pinch: { dist: number } | null = null;
  private wheel = 0;
  /** The last press turned into a drag (stays set until the next press, so its release is not a click). */
  dragged = false;
  private manualFn: (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private world: WorldMap,
    private focus: (seat: number) => Point,
    private speed: () => number,
  ) {
    const c = rectCentre(world.bounds);
    this.view = world.clamp({ cx: c.x, cy: c.y, zoom: this.userZoom });
    this.goal = { ...this.view };
    this.apply();
    this.bindInput();
  }

  /** Called whenever the player takes the camera (drag, wheel, pinch). */
  onManual(fn: () => void): void {
    this.manualFn = fn;
  }

  /** Follow a seat's token, unless the player has taken the camera. */
  follow(seat: number): void {
    if (this.mode.kind === 'free') return;
    this.mode = { kind: 'follow', seat };
  }

  /** Centre on a seat's token and follow it from there (turn start, 回到棋子). */
  recentre(seat: number, snap = false): void {
    this.mode = { kind: 'follow', seat };
    const p = this.focus(seat);
    this.goal = this.world.clamp({ cx: p.x, cy: p.y, zoom: this.userZoom });
    if (snap) {
      this.view = { ...this.goal };
      this.apply();
    }
  }

  /** Show a pending choice's targets (and the deciding seat's token), even if the player had panned away. */
  frameChoice(rect: Rect, seat: number): void {
    this.setFrame(rect, seat, this.world.fitZoom(rect, this.userZoom) ?? ZOOMS[0]);
  }

  /** Show both ends of a teleport or swap when they fit on screen at a resting zoom; otherwise just follow. */
  frameTeleport(rect: Rect, seat: number): void {
    if (this.mode.kind === 'free') return;
    const zoom = this.world.fitZoom(rect, this.userZoom);
    if (zoom === null) this.follow(seat);
    else this.setFrame(rect, seat, zoom);
  }

  /** A framed choice or teleport is over: go back to following that seat from where the camera is. */
  release(): void {
    if (this.mode.kind !== 'frame') return;
    this.mode = { kind: 'follow', seat: this.mode.seat };
    this.goal = { ...this.view, zoom: this.userZoom };
  }

  /** Glide to a world point and stop following (minimap). */
  panTo(p: Point): void {
    this.mode = { kind: 'free' };
    this.goal = this.world.clamp({ cx: p.x, cy: p.y, zoom: this.goal.zoom });
  }

  /** World rect the whole screen shows right now. */
  visibleRect(): Rect {
    return viewRect(this.view);
  }

  /** World rect to screen coordinates at the current view. */
  toScreen(r: Rect): Rect {
    return rectToScreen(this.view, r);
  }

  /** World rect to screen coordinates where the camera is heading (for placing a modal that opens now). */
  toScreenAtGoal(r: Rect): Rect {
    return rectToScreen(this.goal, r);
  }

  /** Ease one frame toward the goal; true when the view visibly moved. */
  update(dtMs: number): boolean {
    const m = this.mode;
    if (m.kind === 'follow') this.goal = keepInside({ ...this.goal, zoom: this.userZoom }, this.focus(m.seat), DEADZONE);
    this.goal = this.world.clamp(this.goal);
    const k = this.press && this.dragged ? 1 : 1 - Math.exp(-dtMs / Math.max(35, EASE_MS / this.speed()));
    const zoom = Math.exp(Math.log(this.view.zoom) + (Math.log(this.goal.zoom) - Math.log(this.view.zoom)) * k);
    let v: View = { cx: this.view.cx + (this.goal.cx - this.view.cx) * k, cy: this.view.cy + (this.goal.cy - this.view.cy) * k, zoom };
    if (m.kind === 'follow') v = this.world.clamp(keepInside(v, this.focus(m.seat), KEEP));
    v = this.settle(v);
    const moved = v.cx !== this.view.cx || v.cy !== this.view.cy || v.zoom !== this.view.zoom;
    this.view = v;
    if (moved) this.apply();
    return moved;
  }

  /** A view within a hair of the goal lands on it exactly, so the camera never rests at a fractional zoom. */
  private settle(v: View): View {
    const g = this.goal;
    const near = Math.abs(v.zoom - g.zoom) < SNAP_ZOOM
      && Math.abs(v.cx - g.cx) * g.zoom < SNAP_PX && Math.abs(v.cy - g.cy) * g.zoom < SNAP_PX;
    return near ? { ...g } : v;
  }

  private setFrame(rect: Rect, seat: number, zoom: Zoom): void {
    this.mode = { kind: 'frame', rect, seat };
    const c = rectCentre(rect);
    this.goal = this.world.clamp({ cx: c.x, cy: c.y, zoom });
  }

  private apply(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(this.view.zoom);
    cam.centerOn(this.view.cx, this.view.cy);
  }

  private takeOver(): void {
    if (this.mode.kind !== 'free') this.manualFn?.();
    this.mode = { kind: 'free' };
  }

  /** Step to a resting zoom; while following, about the screen centre, otherwise keeping `anchor` (screen px) still. */
  private zoomTo(zoom: Zoom, anchor: Point): void {
    if (zoom === this.userZoom && zoom === this.goal.zoom) return;
    this.userZoom = zoom;
    if (this.mode.kind === 'follow') {
      this.goal = { ...this.goal, zoom };
      return;
    }
    this.takeOver();
    const at = toWorld(this.goal, anchor);
    this.goal = this.world.clamp({ cx: at.x - (anchor.x - W / 2) / zoom, cy: at.y - (anchor.y - H / 2) / zoom, zoom });
  }

  private zoomStep(dir: 1 | -1, anchor: Point): void {
    const i = Phaser.Math.Clamp(ZOOMS.indexOf(this.userZoom) + dir, 0, ZOOMS.length - 1);
    this.zoomTo(ZOOMS[i], anchor);
  }

  private bindInput(): void {
    const input = this.scene.input;
    input.addPointer(1);
    // Re-test hover every frame: the board moves under a still pointer, so tile over/out must follow it.
    input.setPollAlways();
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.press = { start: { x: p.x, y: p.y }, view: { ...this.view } };
      this.dragged = false;
    });
    input.on('pointerup', () => {
      this.press = null;
      this.pinch = null;
    });
    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const [a, b] = [input.pointer1, input.pointer2];
      if (a?.isDown && b?.isDown) {
        this.onPinch(a, b);
        return;
      }
      if (!this.press || !p.isDown) {
        this.press = null;
        return;
      }
      const dx = p.x - this.press.start.x;
      const dy = p.y - this.press.start.y;
      if (!this.dragged && Math.hypot(dx, dy) < DRAG_START_PX) return;
      if (!this.dragged) this.takeOver();
      this.dragged = true;
      const z = this.press.view.zoom;
      this.goal = this.world.clamp({ cx: this.press.view.cx - dx / z, cy: this.press.view.cy - dy / z, zoom: this.goal.zoom });
    });
    input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.wheel = Math.sign(dy) === Math.sign(this.wheel) ? this.wheel + dy : dy;
      if (Math.abs(this.wheel) < WHEEL_STEP) return;
      this.zoomStep(this.wheel < 0 ? 1 : -1, { x: p.x, y: p.y });
      this.wheel = 0;
    });
  }

  /** A pinch steps one zoom level each time the fingers spread or close by PINCH_STEP. */
  private onPinch(a: Phaser.Input.Pointer, b: Phaser.Input.Pointer): void {
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    this.dragged = true;
    if (!this.pinch) {
      this.pinch = { dist };
      return;
    }
    const ratio = dist / this.pinch.dist;
    if (ratio < PINCH_STEP && ratio > 1 / PINCH_STEP) return;
    this.zoomStep(ratio > 1 ? 1 : -1, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    this.pinch = { dist };
  }
}
