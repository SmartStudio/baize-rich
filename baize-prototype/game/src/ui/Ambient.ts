// Living detail on the board, all tweens and particles over whatever frame stands there, so it survives the art
// swap: water glints on springs, a swirl around secret-realm portals, smoke and embers over alchemy furnaces,
// a slow glow on the altar statue, spirit motes drifting over the board, and the 白泽现世 light. Nothing is scaled
// by a non-integer; effects fade, tint and move.
import Phaser from 'phaser';
import type { Board } from '../core/board';
import type { TileType } from '../core/types';
import { ensureCanvas } from './assets';
import { COLORS } from './theme';
import { DEPTH, type Point, type WorldMap } from './world';

/** A landmark's feet sit this far below its cell's top-face centre (docs/assets.md §2b). */
export const STAND_DY = 10;
const GOLD_LIGHT = 0xffe7a0;

type Effect = (scene: Phaser.Scene, feet: Point) => void;

/** Glints that blink in and out at fresh spots across the spring's water. */
const springShimmer: Effect = (s, feet) => {
  for (let i = 0; i < 4; i++) {
    const g = s.add.image(0, 0, 'fx_glint').setTint(0xc8f6ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(DEPTH.stand(feet.y) + 0.05);
    const move = (): void => { g.setPosition(feet.x + Phaser.Math.Between(-18, 18), feet.y - Phaser.Math.Between(2, 22)); };
    move();
    s.tweens.add({ targets: g, alpha: 0.9, duration: 380, yoyo: true, hold: 120, repeat: -1, repeatDelay: Phaser.Math.Between(500, 1600), delay: i * 420, onRepeat: move });
  }
};

/** Motes orbiting the portal on a flat ellipse; the near half draws in front of the landmark, the far half behind. */
const portalSwirl: Effect = (s, feet) => {
  const n = 8;
  const centre = { x: feet.x, y: feet.y - 26 };
  const motes = Array.from({ length: n }, (_, i) => s.add.image(0, 0, 'fx_mote').setTint(i % 2 ? 0xc9b6f2 : 0x8fe3ff).setBlendMode(Phaser.BlendModes.ADD));
  const spin = { t: 0 };
  s.tweens.add({
    targets: spin, t: 1, duration: 2600, repeat: -1,
    onUpdate: () => motes.forEach((m, i) => {
      const a = (spin.t + i / n) * Math.PI * 2;
      const near = Math.sin(a);
      m.setPosition(Math.round(centre.x + Math.cos(a) * 17), Math.round(centre.y + near * 6 - i % 3));
      m.setDepth(DEPTH.stand(feet.y) + (near > 0 ? 0.05 : -0.05)).setAlpha(near > 0 ? 0.95 : 0.45);
    }),
  });
};

/** Grey smoke puffs and bright embers rising from the furnace's chimney. */
const furnaceSmoke: Effect = (s, feet) => {
  const depth = DEPTH.stand(feet.y) + 0.05;
  const top = feet.y - 46;
  s.add.particles(feet.x, top, 'fx_smoke', {
    speedY: { min: -16, max: -9 }, speedX: { min: -4, max: 4 }, lifespan: 2400, frequency: 420,
    alpha: { start: 0.5, end: 0 }, tint: [0x8a8698, 0xa8a4b4],
  }).setDepth(depth);
  s.add.particles(feet.x, top + 4, 'fx_ember', {
    speedY: { min: -34, max: -18 }, speedX: { min: -8, max: 8 }, lifespan: 900, frequency: 300,
    alpha: { start: 1, end: 0 }, tint: [0xffb050, 0xffe08a, 0xff7a3a], blendMode: 'ADD',
  }).setDepth(depth);
};

const EFFECTS: Partial<Record<TileType, Effect>> = {
  spring: springShimmer,
  secret: portalSwirl,
  alchemy: furnaceSmoke,
};

/** A slow breathing glow on the altar statue. */
function altarGlow(s: Phaser.Scene, statue: Point, depth: number): void {
  const glow = s.add.image(statue.x, statue.y, 'fx_aura').setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.06).setDepth(depth);
  s.tweens.add({ targets: glow, alpha: 0.22, duration: 3200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
}

/** A few pale motes drifting up over the whole board, each fading in and out. */
function spiritMotes(s: Phaser.Scene, world: WorldMap): void {
  const b = world.bounds;
  s.add.particles(0, 0, 'fx_mote', {
    speedY: { min: -9, max: -4 }, speedX: { min: -3, max: 3 }, lifespan: 7000, frequency: 600, maxAliveParticles: 12,
    alpha: { values: [0, 0.75, 0.75, 0] },
    tint: [0xfff2c0, 0xc8f6ff, 0xe6dcff], blendMode: 'ADD',
    emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(b.x, b.y + 40, b.w, b.h - 40), quantity: 1 },
  }).setDepth(DEPTH.top - 1);
}

/** Small light textures for the effects, drawn once per game. */
function ensureFxTextures(s: Phaser.Scene): void {
  const radial = (key: string, w: number, h: number, peak: number): void => ensureCanvas(s, key, w, h, (ctx) => {
    ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, `rgba(255,255,255,${peak})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  radial('fx_glow', 96, 96, 0.9);
  radial('fx_aura', 160, 136, 1);
  ensureCanvas(s, 'fx_beam', 76, 384, (ctx) => {
    const across = ctx.createLinearGradient(0, 0, 76, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 76, 384);
    ctx.globalCompositeOperation = 'destination-in';
    const up = ctx.createLinearGradient(0, 0, 0, 384);
    up.addColorStop(0, 'rgba(0,0,0,0)');
    up.addColorStop(0.6, 'rgba(0,0,0,1)');
    up.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = up;
    ctx.fillRect(0, 0, 76, 384);
  });
  const block = (key: string, w: number, h: number, fill = '#ffffff'): void => ensureCanvas(s, key, w, h, (ctx) => { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); });
  block('fx_mote', 2, 2);
  block('fx_ember', 2, 1);
  block('fx_glint', 3, 1);
  ensureCanvas(s, 'fx_smoke', 4, 4, (ctx) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(1, 0, 2, 4); ctx.fillRect(0, 1, 4, 2); });
  ensureCanvas(s, 'fx_spark', 6, 6, (ctx) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(1, 0, 4, 6); ctx.fillRect(0, 1, 6, 4); });
}

/** Every landmark's ambient effect, the altar glow and the drifting motes. */
export function addAmbient(scene: Phaser.Scene, world: WorldMap, board: Board, statue: Point): void {
  ensureFxTextures(scene);
  for (const id of board.allNodeIds()) {
    const effect = EFFECTS[board.node(id).type];
    const c = world.centre(id);
    effect?.(scene, { x: c.x, y: c.y + STAND_DY });
  }
  altarGlow(scene, { x: statue.x, y: statue.y - 40 }, DEPTH.stand(statue.y) - 0.1);
  spiritMotes(scene, world);
}

/**
 * 白泽现世 on the altar statue: a pillar of light rising from its feet, a glow on it, halo rings pulsing out
 * across the dais, and sparks drifting up. The beast itself is the altar art.
 */
export class Manifest {
  private layer: Phaser.GameObjects.Container;
  private parts: { beam: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; halos: Phaser.GameObjects.Ellipse[] };
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private loops: Phaser.Tweens.Tween[] = [];
  private on = false;

  constructor(private scene: Phaser.Scene, feet: Point) {
    const s = scene;
    ensureFxTextures(s);
    const depth = DEPTH.stand(feet.y) + 0.1;
    const beam = s.add.image(0, 0, 'fx_beam').setOrigin(0.5, 1).setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const glow = s.add.image(0, -44, 'fx_glow').setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const halos = [0, 1].map(() => s.add.ellipse(0, 0, 150, 96).setStrokeStyle(3, COLORS.gold).setFillStyle());
    this.parts = { beam, glow, halos };
    this.layer = s.add.container(feet.x, feet.y, [beam, ...halos, glow]).setDepth(depth).setVisible(false);
    this.sparks = s.add.particles(feet.x, feet.y, 'fx_spark', {
      speedY: { min: -70, max: -30 }, speedX: { min: -12, max: 12 }, lifespan: 1800,
      alpha: { start: 1, end: 0 }, frequency: 90, tint: [GOLD_LIGHT, 0xffffff], blendMode: 'ADD',
      emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 130, 80), quantity: 1 },
      emitting: false,
    }).setDepth(depth + 0.01);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const t of this.loops) t.remove();
    this.loops = [];
    if (!on) {
      this.layer.setVisible(false);
      this.sparks.stop();
      return;
    }
    const s = this.scene;
    const { beam, glow, halos } = this.parts;
    this.layer.setVisible(true).setAlpha(0);
    this.sparks.start();
    this.loops.push(
      s.tweens.add({ targets: this.layer, alpha: 1, duration: 700 }),
      s.tweens.add({ targets: beam, alpha: { from: 0.55, to: 0.9 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      s.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.8 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      ...halos.map((h, i) => s.tweens.add({
        targets: h, scale: { from: 0.5, to: 1.5 }, alpha: { from: 1, to: 0 }, duration: 1600, delay: i * 800, repeat: -1, ease: 'Sine.easeOut',
      })),
    );
  }
}
