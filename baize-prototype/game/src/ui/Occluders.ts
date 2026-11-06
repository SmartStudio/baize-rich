// Tall art in front of a token (a landmark, a building, the altar statue) can hide it, mostly at zoom 2. Every
// frame this checks each token against the art registered here and tells the token whether it is covered, so it
// can draw its x-ray outline. Free of Phaser at runtime, so the cover test runs under vitest.
import type Phaser from 'phaser';
import type { Rect } from './layout';

/** Art that may stand in front of a token: its drawn box comes from its position, size and origin. */
export type Stand = Pick<Phaser.GameObjects.Image, 'x' | 'y' | 'displayWidth' | 'displayHeight' | 'originX' | 'originY' | 'depth' | 'visible'>;

export interface Coverable {
  readonly box: Rect;
  readonly depth: number;
  setCovered(on: boolean): void;
}

/** A token counts as covered once art in front of it overlaps this much of its head-and-body box. */
const COVERED_SHARE = 0.25;

function standRect(s: Stand): Rect {
  return { x: s.x - s.originX * s.displayWidth, y: s.y - s.originY * s.displayHeight, w: s.displayWidth, h: s.displayHeight };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Whether `s` draws in front of the token and over enough of its figure to hide it. */
export function covers(s: Stand, t: Coverable): boolean {
  return s.visible && s.depth > t.depth && overlapArea(standRect(s), t.box) >= COVERED_SHARE * t.box.w * t.box.h;
}

export class Occluders {
  private stands: Stand[] = [];

  constructor(scene: Phaser.Scene, tokens: readonly Coverable[]) {
    const refresh = (): void => tokens.forEach((t) => t.setCovered(this.stands.some((s) => covers(s, t))));
    scene.events.on('postupdate', refresh);
    scene.events.once('shutdown', () => scene.events.off('postupdate', refresh));
  }

  add<T extends Stand>(s: T): T {
    this.stands.push(s);
    return s;
  }
}
