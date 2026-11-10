// 炼丹房 overlay, built in screen space on the scene the caller passes (GameScene passes its Hud scene), so
// the board camera never matters. The human's stop here becomes the engine's `miniGame` answer. A human plays at real time whatever the game speed (a faster gauge would make
// the game harder, not quicker), and the gauge waits still under its legend until the player lights the fire, so it
// never runs while they are still reading. The AI-watch version (`auto`) runs about 1.2 s at 1× and scales with speed.
import Phaser from 'phaser';
import { addImg } from './assets';
import { H, W } from './layout';
import { COLORS, FS, HEX, txt } from './theme';

export type MiniGameTier = 'fail' | 'ok' | 'perfect';


export interface MiniGameOpts {
  /** Watch an AI play: no input. The gauge lands on this tier. */
  auto?: MiniGameTier;
  /** Game speed; scales only the watch version. */
  speed?: number;
  /** Who is playing, shown under the title, e.g. "P2·剑修". */
  who?: string;
}

const DEPTH = 9950;
const BOX = { x: W / 2 - 260, y: 168, w: 520, h: 384 };
const BAR = { x: W / 2 - 200, y: 448, w: 400, h: 20 };
/** Gauge zones as fractions of the bar: the green band and the gold centre inside it. */
const ZONE = { green: 0.3, gold: 0.07 };
/** One pass of the gauge pointer across the bar. */
const SWEEP_MS = 650;
const Y = { note: BOX.y + 34, stand: 404, sum: 448, legend: 474, prompt: 504, result: 494, detail: 530 };
const LEGEND: { color: number; text: string }[] = [
  { color: COLORS.good, text: '绿区 成丹' },
  { color: COLORS.gold, text: '金线 极品' },
  { color: 0x4a2a2a, text: '其余 炸炉' },
];

const HUMAN = { in: 220, alchemyLimit: 2600, reveal: 260, hold: 1100, out: 200 };
const WATCH = { in: 150, sweep: 450, reveal: 150, hold: 450, out: 150 };

const ALCHEMY_RESULT: Record<MiniGameTier, { text: string; color: string; pills: number }> = {
  perfect: { text: '极品丹成！', color: HEX.gold, pills: 3 },
  ok: { text: '丹成', color: HEX.good, pills: 1 },
  fail: { text: '炸炉了…', color: HEX.bad, pills: 0 },
};

/** Play one mini-game overlay and resolve with its tier once it has faded out. */
export async function playMiniGame(scene: Phaser.Scene, opts: MiniGameOpts = {}): Promise<MiniGameTier> {
  const watch = opts.auto !== undefined;
  const k = watch ? 1 / (opts.speed || 1) : 1;
  const ui = new Frame(scene, '炼丹房', COLORS.bad, !watch);
  const note = '看准火候：停在绿区成丹，正中金线出极品';
  ui.note.setText(opts.who ? `${opts.who} · ${note}` : note);
  const tier = await alchemy(scene, ui, opts.auto, k);
  await ui.close((watch ? WATCH.out : HUMAN.out) * k);
  return tier;
}

/** Tier for a gauge stop at `pos` (0–1) with the zones centred on `centre`. */
export function alchemyTier(pos: number, centre: number): MiniGameTier {
  const d = Math.abs(pos - centre);
  return d <= ZONE.gold / 2 ? 'perfect' : d <= ZONE.green / 2 ? 'ok' : 'fail';
}

/** A gauge position that `alchemyTier` scores as `tier`, for the watch version. */
function landing(tier: MiniGameTier, centre: number): number {
  if (tier === 'perfect') return centre;
  const off = tier === 'ok' ? (ZONE.gold + ZONE.green) / 4 : ZONE.green / 2 + 0.12;
  const sides = [centre - off, centre + off].filter((p) => p >= 0.02 && p <= 0.98);
  return sides[Math.floor(Math.random() * sides.length)];
}

function tweenP(s: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((res) => s.tweens.add({ ...cfg, onComplete: () => res() }));
}

function waitMs(s: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((res) => s.time.delayedCall(ms, () => res()));
}

/**
 * The shared chrome: dim, panel, title ribbon, note line, prompt and result text. A human overlay takes
 * Space / Enter / a click anywhere, but only while `waitInput` is waiting; otherwise input is ignored.
 */
class Frame {
  readonly root: Phaser.GameObjects.Container;
  readonly note: Phaser.GameObjects.Text;
  private prompt: Phaser.GameObjects.Text;
  private result: Phaser.GameObjects.Text;
  private detail: Phaser.GameObjects.Text;
  private waiting: ((acted: boolean) => void) | null = null;
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    ev.preventDefault();
    this.waiting?.(true);
  };
  private readonly teardown = (): void => {
    this.scene.input.keyboard?.off('keydown', this.onKey);
    this.waiting = null;
  };

  constructor(private scene: Phaser.Scene, title: string, color: number, interactive: boolean) {
    const s = scene;
    const shade = s.add.rectangle(0, 0, W, H, 0x0f0e1a, interactive ? 0.6 : 0.3).setOrigin(0, 0);
    const box = s.add.rectangle(BOX.x, BOX.y, BOX.w, BOX.h, COLORS.panel, 0.96).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold);
    const inner = s.add.rectangle(BOX.x + 8, BOX.y + 52, BOX.w - 16, BOX.h - 60, COLORS.bg, 0.9).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline);
    const ribbon = s.add.rectangle(W / 2, BOX.y, 180, 34, color).setStrokeStyle(3, COLORS.outline);
    const ribbonLine = s.add.rectangle(W / 2, BOX.y - 11, 172, 3, COLORS.gold);
    const head = txt(s, W / 2, BOX.y + 1, title, { size: FS.xl, bold: true, stroke: HEX.ink, origin: [0.5, 0.5] });
    this.note = txt(s, W / 2, Y.note, '', { size: FS.md, color: HEX.parchment, origin: [0.5, 0.5] });
    this.prompt = txt(s, W / 2, Y.prompt, '', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] }).setVisible(false);
    this.result = txt(s, W / 2, Y.result, '', { size: FS.hero, bold: true, stroke: HEX.ink, origin: [0.5, 0.5] }).setVisible(false);
    this.detail = txt(s, W / 2, Y.detail, '', { size: FS.sm, color: HEX.dim, origin: [0.5, 0.5] });
    this.root = s.add.container(0, 0, [shade, box, inner, ribbon, ribbonLine, head, this.note, this.prompt, this.result, this.detail])
      .setDepth(DEPTH).setName('minigame');
    if (interactive) {
      shade.setInteractive().on('pointerdown', () => this.waiting?.(true));
      s.input.keyboard?.on('keydown', this.onKey);
    }
    s.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown);
  }

  /** Add the game's own pieces, kept under the prompt / result texts. */
  add(...objs: Phaser.GameObjects.GameObject[]): void {
    this.root.addAt(objs, this.root.getIndex(this.prompt));
  }

  enter(ms: number): Promise<void> {
    this.root.setAlpha(0).setScale(0.96);
    this.root.setPosition(W / 2 * 0.04, H / 2 * 0.04);
    return tweenP(this.scene, { targets: this.root, alpha: 1, scale: 1, x: 0, y: 0, duration: ms, ease: 'Back.easeOut' });
  }

  /** Blink `label` until the player acts (true) or `limit` ms pass (false); with no limit, until they act. */
  waitInput(label: string, limit?: number): Promise<boolean> {
    const s = this.scene;
    this.prompt.setText(label).setVisible(true).setAlpha(1);
    const blink = s.tweens.add({ targets: this.prompt, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
    return new Promise((res) => {
      const timer = limit === undefined ? null : s.time.delayedCall(limit, () => this.waiting?.(false));
      this.waiting = (acted) => {
        this.waiting = null;
        timer?.remove();
        blink.remove();
        this.prompt.setVisible(false);
        res(acted);
      };
    });
  }

  showResult(text: string, color: string, detail = ''): void {
    this.result.setText(text).setColor(color).setVisible(true).setScale(0.4).setAlpha(0);
    this.detail.setText(detail);
    this.scene.tweens.add({ targets: this.result, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
  }

  close(ms: number): Promise<void> {
    this.teardown();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.teardown);
    return tweenP(this.scene, { targets: this.root, alpha: 0, duration: ms }).then(() => this.root.destroy());
  }
}

// ------------------------------------------------------------------ 炼丹房

async function alchemy(s: Phaser.Scene, ui: Frame, auto: MiniGameTier | undefined, k: number): Promise<MiniGameTier> {
  const centre = Phaser.Math.FloatBetween(0.35, 0.65);
  const glow = s.add.ellipse(W / 2, Y.stand - 6, 150, 34, 0xe0663a, 0.35);
  const flames = [-34, 0, 34].map((dx, i) => s.add.triangle(W / 2 + dx, Y.stand + 2, 0, 26, 10, 0, 20, 26, i === 1 ? COLORS.gold : 0xe0663a).setOrigin(0.5, 1));
  const furnace = addImg(s, W / 2, Y.stand, 'obj_furnace').setOrigin(0.5, 1).setScale(3);
  const bar = s.add.rectangle(BAR.x, BAR.y, BAR.w, BAR.h, 0x4a2a2a).setOrigin(0, 0.5).setStrokeStyle(2, COLORS.outline);
  const green = s.add.rectangle(BAR.x + (centre - ZONE.green / 2) * BAR.w, BAR.y, ZONE.green * BAR.w, BAR.h - 4, COLORS.good).setOrigin(0, 0.5).setName('mg-green');
  const gold = s.add.rectangle(BAR.x + (centre - ZONE.gold / 2) * BAR.w, BAR.y, ZONE.gold * BAR.w, BAR.h - 4, COLORS.gold).setOrigin(0, 0.5).setName('mg-gold');
  const needle = s.add.rectangle(0, 0, 4, BAR.h + 14, COLORS.parchment).setStrokeStyle(1, COLORS.outline);
  const tip = s.add.triangle(0, -BAR.h / 2 - 12, 0, 0, 16, 0, 8, 10, COLORS.parchment).setStrokeStyle(1, COLORS.outline);
  const pointer = s.add.container(BAR.x, BAR.y, [needle, tip]).setName('mg-pointer');
  ui.add(glow, ...flames, furnace, bar, green, gold, pointer);
  const flicker = flames.map((f) => s.tweens.add({
    targets: f, scaleY: { from: 0.6, to: 1.35 }, scaleX: { from: 1.1, to: 0.85 }, duration: Phaser.Math.Between(110, 200), yoyo: true, repeat: -1,
  }));
  flicker.push(s.tweens.add({ targets: glow, alpha: 0.6, duration: 300, yoyo: true, repeat: -1 }));
  const p = { t: 0 };
  const follow = (): void => { pointer.x = BAR.x + p.t * BAR.w; };

  let tier: MiniGameTier;
  let detail = '';
  if (auto) {
    await ui.enter(WATCH.in * k);
    await tweenP(s, { targets: p, t: 1, duration: WATCH.sweep * k * 0.55, ease: 'Sine.easeInOut', onUpdate: follow });
    await tweenP(s, { targets: p, t: landing(auto, centre), duration: WATCH.sweep * k * 0.45, ease: 'Cubic.easeOut', onUpdate: follow });
    tier = auto;
  } else {
    const legend = legendRow(s);
    ui.add(legend);
    follow();
    await ui.enter(HUMAN.in);
    await ui.waitInput('空格 / 点击 点火，指针开始走');
    const sweep = s.tweens.add({ targets: p, t: 1, duration: SWEEP_MS, yoyo: true, repeat: -1, onUpdate: follow });
    const acted = await ui.waitInput('空格 / 点击 收火', HUMAN.alchemyLimit);
    sweep.remove();
    legend.setVisible(false);
    tier = acted ? alchemyTier(p.t, centre) : 'fail';
    if (!acted) detail = '火候已过';
  }
  const hold = (auto ? WATCH.hold * k : HUMAN.hold);
  s.tweens.add({ targets: pointer, scale: 1.3, duration: 90, yoyo: true });
  alchemyFx(s, ui, furnace, flames, tier, hold);
  ui.showResult(ALCHEMY_RESULT[tier].text, ALCHEMY_RESULT[tier].color, detail);
  await waitMs(s, hold);
  flicker.forEach((t) => t.remove());
  return tier;
}

/** Swatches under the bar saying what each colour of it brews. */
function legendRow(s: Phaser.Scene): Phaser.GameObjects.Container {
  const gap = 28;
  const items = LEGEND.map(({ color, text }) => {
    const swatch = s.add.rectangle(0, 0, 14, 14, color).setOrigin(0, 0.5).setStrokeStyle(1, COLORS.outline);
    const label = txt(s, 20, 0, text, { size: FS.md, color: HEX.parchment, origin: [0, 0.5] });
    return { parts: [swatch, label], w: 20 + label.width };
  });
  const total = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1);
  const row = s.add.container(W / 2 - total / 2, Y.legend).setName('mg-legend');
  let x = 0;
  for (const it of items) {
    it.parts.forEach((o) => { o.x += x; });
    row.add(it.parts);
    x += it.w + gap;
  }
  return row;
}

function alchemyFx(s: Phaser.Scene, ui: Frame, furnace: Phaser.GameObjects.Image, flames: Phaser.GameObjects.Triangle[], tier: MiniGameTier, ms: number): void {
  const top = furnace.y - furnace.displayHeight * 0.7;
  if (tier === 'fail') {
    s.tweens.add({ targets: furnace, x: furnace.x + 5, duration: 50, yoyo: true, repeat: 4 });
    flames.forEach((f) => f.setFillStyle(0x6a6480));
    for (let i = 0; i < 6; i++) {
      const puff = s.add.circle(furnace.x + Phaser.Math.Between(-30, 30), top, Phaser.Math.Between(10, 18), 0x8a86a8, 0.8);
      ui.add(puff);
      s.tweens.add({
        targets: puff, y: top - Phaser.Math.Between(40, 80), x: puff.x + Phaser.Math.Between(-30, 30), scale: 2, alpha: 0,
        duration: ms * 0.8, delay: i * 40, ease: 'Sine.easeOut',
      });
    }
    return;
  }
  s.tweens.add({ targets: furnace, scale: 3.25, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
  const ring = s.add.circle(furnace.x, top, 20).setStrokeStyle(4, tier === 'perfect' ? COLORS.gold : COLORS.good);
  ui.add(ring);
  s.tweens.add({ targets: ring, scale: tier === 'perfect' ? 5 : 3, alpha: 0, duration: ms * 0.6, ease: 'Cubic.easeOut' });
  const n = ALCHEMY_RESULT[tier].pills;
  for (let i = 0; i < n; i++) {
    const dx = n === 1 ? 0 : (i - (n - 1) / 2) * 70;
    const pill = addImg(s, furnace.x, top, 'ic_pill').setScale(2.5);
    ui.add(pill);
    s.tweens.add({ targets: pill, x: furnace.x + dx, duration: ms * 0.55, delay: i * 70 });
    s.tweens.add({ targets: pill, y: top - 70, duration: ms * 0.3, delay: i * 70, ease: 'Quad.easeOut', yoyo: true });
    s.tweens.add({ targets: pill, angle: 360, duration: ms * 0.55, delay: i * 70 });
  }
}

