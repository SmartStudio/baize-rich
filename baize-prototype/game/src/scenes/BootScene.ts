import Phaser from 'phaser';
import { HERO_IDS } from '../core/heroes';
import { ATLAS_KEY, ensureFrames } from '../ui/assets';
import { HEX, txt } from '../ui/theme';
import { newSession, randomSeed, urlParams } from '../ui/session';

/** Boot / Preload: loads the optional atlas, fills missing frames with placeholders. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    txt(this, 640, 360, '载入中…', { size: 18, color: HEX.parchment, origin: [0.5, 0.5] });
    if (__HAS_ATLAS__) {
      this.load.atlas(ATLAS_KEY, 'atlas.png', 'atlas.json');
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, () => console.warn('[baize] atlas failed to load; using placeholders'));
    }
  }

  create(): void {
    const { missing } = ensureFrames(this);
    if (missing.length) console.info(`[baize] ${missing.length} art frames missing from atlas → placeholders`);
    const q = urlParams();
    if (q.get('auto') === '1') {
      const session = newSession(
        Number(q.get('seed') ?? randomSeed()),
        HERO_IDS.map((hero, i) => ({
          human: false, hero, difficulty: 'normal' as const,
          personality: (['steady', 'aggressive', 'miser', 'steady'] as const)[i],
        })),
        Number(q.get('speed') ?? 2),
        true,
      );
      this.scene.start('Game', session);
    } else {
      this.scene.start('Setup');
    }
  }
}
