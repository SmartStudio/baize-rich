// A HUD panel with a full and a compact form. It folds to the compact form while the board camera is zoomed in,
// so the close-up board shows more; pointing at the compact form opens the full one until the pointer leaves it.
import Phaser from 'phaser';
import type { Rect } from './layout';

export class HudFold {
  private compact = false;
  private peek = false;
  private opener: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene, private full: Phaser.GameObjects.Container, private slim: Phaser.GameObjects.Container, fullRect: Rect, slimRect: Rect) {
    this.opener = scene.add.zone(slimRect.x, slimRect.y, slimRect.w, slimRect.h).setOrigin(0, 0).setInteractive()
      .on('pointerover', () => this.setPeek(true));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.peek && !inside(fullRect, p)) this.setPeek(false);
    });
    this.apply();
  }

  get folded(): boolean {
    return this.compact && !this.peek;
  }

  setCompact(on: boolean): void {
    if (this.compact === on) return;
    this.compact = on;
    this.peek = false;
    this.apply();
  }

  private setPeek(on: boolean): void {
    this.peek = on;
    this.apply();
  }

  private apply(): void {
    const folded = this.folded;
    this.full.setVisible(!folded);
    this.slim.setVisible(folded);
    this.opener.setVisible(folded);
  }
}

/** Everything `build` adds to the scene, moved into one container at the origin so it shows and hides together. */
export function gather(scene: Phaser.Scene, build: () => void): Phaser.GameObjects.Container {
  const before = new Set(scene.children.list);
  build();
  const added = scene.children.list.filter((o) => !before.has(o));
  return scene.add.container(0, 0, added);
}

function inside(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}
