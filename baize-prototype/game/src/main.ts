import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HeroSelectScene } from './scenes/HeroSelectScene';
import { HudScene } from './scenes/HudScene';
import { ResultScene } from './scenes/ResultScene';
import { SetupScene } from './scenes/SetupScene';
import { TitleScene } from './scenes/TitleScene';
import { VersusScene } from './scenes/VersusScene';
import { H, W } from './ui/layout';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: W,
  height: H,
  backgroundColor: '#1B1A2E',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, TitleScene, HeroSelectScene, SetupScene, VersusScene, GameScene, HudScene, ResultScene],
});

(window as unknown as { __phaser: Phaser.Game }).__phaser = game;
