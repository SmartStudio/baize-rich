import Phaser from 'phaser';

/**
 * Screen-space overlay that runs above GameScene. It owns no logic: GameScene builds its HUD
 * widgets (chips, dock, popovers, modal, banners) on this scene, whose camera never scrolls or
 * zooms, so the board camera can move freely underneath.
 */
export class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }
}
