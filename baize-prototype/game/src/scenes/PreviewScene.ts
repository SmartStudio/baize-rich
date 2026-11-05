import Phaser from 'phaser';
import { addImg } from '../ui/assets';
import { playMiniGame, type MiniGameOpts, type MiniGameSpec, type MiniGameTier } from '../ui/MiniGame';
import { addSpirit, possessionAura } from '../ui/Spirits';
import { COLORS, FS, HEX, txt } from '../ui/theme';
import { Button } from '../ui/widgets';

/** v0.6 placeholder frames, shown on the grid so new art can be checked at a glance. */
const FRAMES = [
  'tile_shop', 'tile_minigame', 'tile_hospital', 'obj_shop', 'obj_minigame', 'obj_minigame_alchemy',
  'obj_minigame_dice', 'obj_hospital', 'bld_garden', 'bld_bazaar', 'bld_portal', 'spirit_fox',
  'spirit_heart', 'mg_cup', 'card_dice', 'card_barrier', 'card_blast', 'card_turnback',
];

const DICE_WIN: MiniGameSpec = { game: 'dice', stake: 100, side: 'big', roll: [5, 4], win: true };
const DICE_LOSE: MiniGameSpec = { game: 'dice', stake: 200, side: 'small', roll: [6, 5], win: false };

const RUNS: { label: string; spec: MiniGameSpec; opts?: MiniGameOpts }[] = [
  { label: '炼丹房（亲手）', spec: { game: 'alchemy' } },
  { label: '灵骰台 押大·赢', spec: DICE_WIN },
  { label: '灵骰台 押小·输', spec: DICE_LOSE },
  { label: '观战 炼丹·极品', spec: { game: 'alchemy' }, opts: { auto: 'perfect' } },
  { label: '观战 炼丹·成丹', spec: { game: 'alchemy' }, opts: { auto: 'ok' } },
  { label: '观战 炼丹·炸炉', spec: { game: 'alchemy' }, opts: { auto: 'fail' } },
  { label: '观战 灵骰·赢', spec: DICE_WIN, opts: { auto: 'perfect' } },
  { label: '观战 灵骰·输', spec: DICE_LOSE, opts: { auto: 'fail' } },
];

const SPEEDS = [1, 2, 4];

/** `?preview=minigame`: try the mini-game overlays and look over the v0.6 art without an engine. */
export class PreviewScene extends Phaser.Scene {
  private busy = false;
  private speed = 1;
  /** Every tier the overlays returned, oldest first (read by the browser check). */
  readonly results: MiniGameTier[] = [];

  constructor() {
    super('Preview');
  }

  create(): void {
    this.add.rectangle(0, 0, 1280, 720, COLORS.bg).setOrigin(0, 0);
    txt(this, 24, 16, '小游戏与 v0.6 美术预览', { size: FS.xl, bold: true, color: HEX.gold });
    const last = txt(this, 24, 610, '上次结果：—', { size: FS.md }).setName('pv-result');
    RUNS.forEach((r, i) => {
      new Button(this, 24, 60 + i * 52, { w: 220, h: 44, label: r.label, size: FS.md }).onClick(() => void this.run(r.spec, r.opts, last));
    });
    const speedBtn = new Button(this, 24, 60 + RUNS.length * 52, { w: 220, h: 36, label: '观战倍速 ×1', size: FS.sm });
    speedBtn.onClick(() => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      speedBtn.setLabel(`观战倍速 ×${this.speed}`);
    });

    FRAMES.forEach((name, i) => {
      const cx = 330 + (i % 6) * 152;
      const cy = 70 + Math.floor(i / 6) * 160;
      this.add.rectangle(cx - 70, cy - 8, 140, 150, COLORS.panel).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline);
      const img = addImg(this, cx, cy + 112, name).setOrigin(0.5, 1);
      img.setScale(Math.min(2, 120 / img.width, 116 / img.height));
      txt(this, cx, cy + 128, name, { size: FS.xs, color: HEX.dim, origin: [0.5, 0.5] });
    });

    txt(this, 330, 560, '待机 / 附身：', { size: FS.md, color: HEX.dim });
    for (const [x, kind] of [[480, 'fox'], [560, 'heart']] as const) addSpirit(this, x, 640, kind).setScale(2);
    for (const [x, hero, kind] of [[680, 'body', 'fox'], [780, 'sword', 'heart']] as const) {
      const base = this.add.ellipse(0, -2, 22, 8, COLORS.gold).setStrokeStyle(1, COLORS.outline);
      const tok = this.add.container(x, 650, [base, addImg(this, 0, 0, `tok_${hero}`).setOrigin(0.5, 1)]).setScale(2);
      possessionAura(this, tok, kind);
    }
    for (const [x, tile, obj] of [[900, 'tile_shop', 'obj_shop'], [990, 'tile_minigame', 'obj_minigame_dice'], [1080, 'tile_hospital', 'obj_hospital']] as const) {
      addImg(this, x, 590, tile).setOrigin(0, 0).setScale(72 / 64);
      addImg(this, x + 36, 590 + 54, obj).setOrigin(0.5, 1);
    }
  }

  private async run(spec: MiniGameSpec, opts: MiniGameOpts | undefined, out: Phaser.GameObjects.Text): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const tier = await playMiniGame(this, spec, opts && { ...opts, speed: this.speed, who: 'P2·剑修' });
    this.results.push(tier);
    out.setText(`上次结果：${tier}`);
    this.busy = false;
  }
}
