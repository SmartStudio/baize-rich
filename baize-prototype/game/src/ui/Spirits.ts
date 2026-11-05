// The two wandering spirits (§3.2 of the v0.6 draft): 福缘灵狐 and 心魔. `addSpirit` is the figure that
// roams the board; `possessionAura` marks a token while a spirit rides it. Both are plain containers
// with their own looping tweens, so they work in world space (BoardView) or screen space alike.
import Phaser from 'phaser';
import { addImg } from './assets';

export type SpiritKind = 'fox' | 'heart';

interface SpiritLook {
  frame: string;
  glow: number;
  ring: number;
  mote: number;
  /** Motes drift up for the fox, sink and smear for the heart demon. */
  moteSpeedY: number;
}

const LOOK: Record<SpiritKind, SpiritLook> = {
  fox: { frame: 'spirit_fox', glow: 0xffe7a0, ring: 0xf2b93b, mote: 0xfff4c0, moteSpeedY: -26 },
  heart: { frame: 'spirit_heart', glow: 0x8e2b8e, ring: 0xb03a6e, mote: 0x9a4ac8, moteSpeedY: -10 },
};

const GLOW_KEY = 'fx_spirit_glow';
const MOTE_KEY = 'fx_spirit_mote';

function ensureTextures(s: Phaser.Scene): void {
  if (!s.textures.exists(GLOW_KEY)) {
    const t = s.textures.createCanvas(GLOW_KEY, 64, 64)!;
    const ctx = t.getContext();
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    t.refresh();
  }
  if (!s.textures.exists(MOTE_KEY)) {
    const t = s.textures.createCanvas(MOTE_KEY, 4, 4)!;
    const ctx = t.getContext();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, 2, 4);
    ctx.fillRect(0, 1, 4, 2);
    t.refresh();
  }
}

/** Stop a container's looping tweens when it is destroyed. */
function ownTweens(c: Phaser.GameObjects.Container, tweens: Phaser.Tweens.Tween[]): void {
  c.once(Phaser.GameObjects.Events.DESTROY, () => tweens.forEach((t) => t.remove()));
}

/** A spirit standing at (x, y), bottom-centre: shadow, soft glow, and the figure bobbing above it. */
export function addSpirit(scene: Phaser.Scene, x: number, y: number, kind: SpiritKind): Phaser.GameObjects.Container {
  ensureTextures(scene);
  const look = LOOK[kind];
  const shadow = scene.add.ellipse(0, -1, 22, 6, 0x0f0e1a, 0.35);
  const glow = scene.add.image(0, -14, GLOW_KEY).setTint(look.glow).setScale(0.7).setBlendMode(Phaser.BlendModes.ADD);
  const fig = addImg(scene, 0, -3, look.frame).setOrigin(0.5, 1);
  const c = scene.add.container(x, y, [shadow, glow, fig]);
  const loops = [
    scene.tweens.add({ targets: fig, y: -8, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
    scene.tweens.add({ targets: shadow, scaleX: 0.75, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
    scene.tweens.add({ targets: glow, alpha: { from: 0.45, to: 0.9 }, scale: { from: 0.6, to: 0.8 }, duration: 900, yoyo: true, repeat: -1 }),
  ];
  if (kind === 'heart') loops.push(scene.tweens.add({ targets: fig, scaleX: 1.08, alpha: 0.8, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
  ownTweens(c, loops);
  return c;
}

/**
 * Mark a token as possessed: a pulsing ring at its feet, a glow behind it and motes around it.
 * The aura goes in at the bottom of the token's own container, so it follows every hop; destroy it to clear.
 */
export function possessionAura(scene: Phaser.Scene, token: Phaser.GameObjects.Container, kind: SpiritKind): Phaser.GameObjects.Container {
  ensureTextures(scene);
  const look = LOOK[kind];
  const ring = scene.add.ellipse(0, -2, 30, 10).setStrokeStyle(2, look.ring).setFillStyle(look.ring, 0.18);
  const glow = scene.add.image(0, -22, GLOW_KEY).setTint(look.glow).setScale(0.9, 1.2).setBlendMode(Phaser.BlendModes.ADD);
  const motes = scene.add.particles(0, -6, MOTE_KEY, {
    speedY: { min: look.moteSpeedY * 1.4, max: look.moteSpeedY }, speedX: { min: -8, max: 8 }, lifespan: 1100,
    scale: { start: 1, end: 0.3 }, alpha: { start: 0.9, end: 0 }, frequency: 160, tint: look.mote,
    emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 26, 8), quantity: 1 },
  });
  const aura = scene.add.container(0, 0, [ring, glow, motes]);
  token.addAt(aura, 0);
  ownTweens(aura, [
    scene.tweens.add({ targets: ring, scale: { from: 0.9, to: 1.15 }, alpha: { from: 1, to: 0.5 }, duration: 700, yoyo: true, repeat: -1 }),
    scene.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.75 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
  ]);
  return aura;
}
