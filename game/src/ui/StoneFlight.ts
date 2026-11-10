// 灵石 changing hands: a few stone icons hop in an arc, in screen space on the HUD scene, from the payer's token
// to where the money goes (the payee's seat chip, or the tile that was bought). Positions stay on whole pixels.
import type Phaser from 'phaser';
import { addImg } from './assets';
import type { Point } from './world';

const DEPTH = 9800;
const LIFT = 46;
const STAGGER_MS = 70;

/** Resolves when the last stone lands. */
export function flyStones(scene: Phaser.Scene, from: Point, to: Point, coins: number, ms: number): Promise<void> {
  const lift = LIFT + Math.min(80, Math.abs(to.x - from.x) * 0.15);
  const hops = Array.from({ length: coins }, (_, i) => hop(scene, from, to, lift, ms, i * STAGGER_MS));
  return Promise.all(hops).then(() => undefined);
}

function hop(scene: Phaser.Scene, from: Point, to: Point, lift: number, ms: number, delay: number): Promise<void> {
  const img = addImg(scene, from.x, from.y, 'ic_stone').setDepth(DEPTH).setVisible(false);
  img.setDisplayOrigin(Math.floor(img.width / 2), Math.floor(img.height / 2));
  const t = { k: 0 };
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: t, k: 1, duration: ms, delay, ease: 'Sine.easeIn',
      onStart: () => img.setVisible(true),
      onUpdate: () => img.setPosition(
        Math.round(from.x + (to.x - from.x) * t.k),
        Math.round(from.y + (to.y - from.y) * t.k - lift * 4 * t.k * (1 - t.k)),
      ),
      onComplete: () => {
        img.destroy();
        resolve();
      },
    });
  });
}
