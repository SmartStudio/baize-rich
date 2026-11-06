import Phaser from 'phaser';
import { defaultData } from '../core/data';
import { addImg } from '../ui/assets';
import { HowToPlay } from '../ui/HowToPlay';
import { TITLE_SUBTITLE, titleNarration } from '../ui/narration';
import { findResumable, markTutorialSeen, tutorialSeen } from '../ui/saves';
import { resumeSession } from '../ui/session';
import { COLORS, HEX, txt } from '../ui/theme';
import { Button, fadeToScene } from '../ui/widgets';

const INTRO = titleNarration(defaultData);
const LINE_MS = 3200;

/** Title: a skippable narrated intro over an animated backdrop, then 开始游戏 / 继续上局 / 玩法说明. */
export class TitleScene extends Phaser.Scene {
  private phase: 'intro' | 'menu' = 'intro';
  private help: HowToPlay | null = null;
  private altar!: Phaser.GameObjects.Image;
  private narration!: Phaser.GameObjects.Text;
  private skipHint!: Phaser.GameObjects.Text;
  private primary: (() => void) | null = null;

  constructor() {
    super('Title');
  }

  create(): void {
    this.phase = 'intro';
    this.help = null;
    this.cameras.main.setBackgroundColor(COLORS.bg).fadeIn(600);
    this.backdrop();
    this.altar = addImg(this, 640, 280, 'ft_altar').setAlpha(0);
    this.tweens.add({ targets: this.altar, alpha: 1, duration: 2400, ease: 'Sine.easeOut' });
    this.narration = txt(this, 640, 560, '', { size: 22, origin: [0.5, 0.5], stroke: HEX.ink, wrap: 1000, align: 'center' }).setAlpha(0);
    this.skipHint = txt(this, 1256, 700, '任意键 / 点击跳过', { size: 13, color: HEX.dim, origin: [1, 1] });
    this.tweens.add({ targets: this.skipHint, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });
    this.narrate(0);

    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.input.on('pointerdown', () => { if (this.phase === 'intro') this.showMenu(); });
  }

  /** Map art drifting behind a dark veil, a breathing glow behind the altar, clouds and rising spirit motes. */
  private backdrop(): void {
    const map = addImg(this, 640, 360, 'centre_bg').setScale(3).setAlpha(0.32);
    this.tweens.add({ targets: map, scale: 3.15, x: 610, duration: 14000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.rectangle(0, 0, 1280, 720, COLORS.bg, 0.45).setOrigin(0, 0);
    const glow = this.add.graphics();
    glow.fillStyle(COLORS.gold, 0.10).fillCircle(640, 300, 190);
    glow.fillStyle(COLORS.parchment, 0.08).fillCircle(640, 300, 130);
    this.tweens.add({ targets: glow, alpha: 0.4, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    for (let i = 0; i < 7; i++) this.cloud(Phaser.Math.Between(0, 1280), 60 + i * 95, Phaser.Math.FloatBetween(0.6, 1.4), i % 2 ? 1 : -1);
    for (let i = 0; i < 40; i++) this.mote();
  }

  private cloud(x: number, y: number, s: number, dir: 1 | -1): void {
    const g = this.add.graphics({ x, y });
    g.fillStyle(COLORS.parchment, 0.10);
    g.fillRect(-60 * s, -8 * s, 120 * s, 16 * s);
    g.fillRect(-36 * s, -20 * s, 64 * s, 14 * s);
    g.fillRect(-12 * s, -28 * s, 30 * s, 10 * s);
    const span = 1280 + 300 * s;
    const from = dir > 0 ? -150 * s : 1280 + 150 * s;
    const to = from + dir * span;
    const first = Math.abs(to - x) / span;
    const duration = Phaser.Math.Between(40000, 70000);
    this.tweens.add({
      targets: g, x: to, duration: duration * first,
      onComplete: () => { g.x = from; this.tweens.add({ targets: g, x: to, duration, repeat: -1 }); },
    });
  }

  private mote(): void {
    const color = Phaser.Utils.Array.GetRandom([COLORS.gold, COLORS.parchment, 0x7fe0e8]);
    const r = this.add.rectangle(Phaser.Math.Between(0, 1280), 740, 3, 3, color, 0.8);
    this.tweens.add({
      targets: r, y: Phaser.Math.Between(80, 400), x: `+=${Phaser.Math.Between(-60, 60)}`, alpha: 0,
      duration: Phaser.Math.Between(5000, 9000), delay: Phaser.Math.Between(0, 8000), repeat: -1,
    });
  }

  private narrate(i: number): void {
    if (this.phase !== 'intro') return;
    if (i >= INTRO.length) { this.showMenu(); return; }
    this.narration.setText(INTRO[i]).setAlpha(0);
    this.tweens.add({
      targets: this.narration, alpha: 1, duration: 600, hold: LINE_MS - 1100, yoyo: true,
      onComplete: () => this.narrate(i + 1),
    });
  }

  private showMenu(): void {
    if (this.phase === 'menu') return;
    this.phase = 'menu';
    this.tweens.killTweensOf([this.narration, this.altar, this.skipHint]);
    this.narration.destroy();
    this.skipHint.destroy();
    this.altar.setAlpha(1);
    this.tweens.add({ targets: this.altar, y: 272, duration: 2600, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [8] });

    const title = txt(this, 640, 96, '白泽秘境大富翁', { size: 60, bold: true, color: HEX.gold, origin: [0.5, 0.5], stroke: HEX.ink });
    const sub = txt(this, 640, 150, TITLE_SUBTITLE, { size: 20, origin: [0.5, 0.5], color: HEX.parchment, stroke: HEX.ink });
    title.setAlpha(0).setY(60);
    sub.setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, y: 96, duration: 500, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, delay: 250 });

    const saved = findResumable();
    const startNew = () => this.startNew();
    const resume = saved ? () => fadeToScene(this, 'Game', resumeSession(saved.record)) : null;
    const items: { label: string; hint?: string; primary?: boolean; fn: () => void }[] = [
      ...(resume && saved ? [{ label: '继续上局', hint: saved.summary, primary: true, fn: resume }] : []),
      { label: saved ? '开始新游戏' : '开始游戏', primary: !saved, fn: startNew },
      { label: '玩法说明', fn: () => this.openHelp() },
    ];
    // With an unfinished save, Space / Enter resumes it; starting over takes a click so a save is never lost by accident.
    this.primary = resume ?? startNew;
    items.forEach((it, k) => {
      const b = new Button(this, 520, 452 + k * 66, {
        w: 240, h: 54, label: it.label, size: 20, hint: it.hint, fill: it.primary ? 0x8a5a1e : COLORS.panelLight,
      }).onClick(it.fn);
      b.setAlpha(0);
      this.tweens.add({ targets: b, alpha: 1, duration: 400, delay: 350 + k * 120 });
    });
    const { rounds } = defaultData.config;
    txt(this, 640, 700, `率先渡劫化神即胜；第 ${rounds} 轮秘境关闭时境界最高者胜 · 空格 / Enter 确认 · H 玩法说明`, {
      size: 13, color: HEX.dim, origin: [0.5, 0.5],
    });
  }

  private startNew(): void {
    if (tutorialSeen()) { fadeToScene(this, 'HeroSelect'); return; }
    this.openHelp(() => fadeToScene(this, 'HeroSelect'), '去选修士 ▶');
  }

  private openHelp(then?: () => void, closeLabel?: string): void {
    if (this.help?.isOpen) return;
    this.help = new HowToPlay(this, () => { markTutorialSeen(); then?.(); }, { closeLabel });
  }

  private onKey(ev: KeyboardEvent): void {
    if (this.phase === 'intro') { this.showMenu(); return; }
    if (this.help?.isOpen) return;
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); this.primary?.(); }
    else if (ev.key === 'h' || ev.key === 'H') this.openHelp();
  }
}
