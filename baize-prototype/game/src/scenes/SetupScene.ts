import Phaser from 'phaser';
import { DIFFICULTY_LABEL, PERSONALITY_LABEL, type Difficulty, type Personality } from '../ai/ai';
import { defaultData } from '../core/data';
import { HERO_IDS } from '../core/heroes';
import type { HeroId } from '../core/types';
import { addImg, setFrame } from '../ui/assets';
import { newSession, quickSeats, randomSeed, urlSeed, urlSpeed, type SeatConfig } from '../ui/session';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from '../ui/theme';
import { Button, fadeToScene } from '../ui/widgets';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const PERSONAS: Personality[] = ['steady', 'aggressive', 'miser'];

/** 高级设置: for each of the 4 seats, human / AI (difficulty + personality) and hero, plus the seed. Starts prefilled from HeroSelect. */
export class SetupScene extends Phaser.Scene {
  private seats: SeatConfig[] = [];
  private seed = 0;
  private renderers: (() => void)[] = [];

  constructor() {
    super('Setup');
  }

  create(data: { seats?: SeatConfig[] } = {}): void {
    this.cameras.main.setBackgroundColor(COLORS.bg).fadeIn(250);
    this.renderers = [];
    this.seed = urlSeed();
    this.seats = (data.seats ?? quickSeats(HERO_IDS[0], 'normal')).map((s) => ({ ...s }));
    txt(this, 640, 64, '高级设置', { size: 36, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    const { winCultivation, rounds } = defaultData.config;
    txt(this, 640, 110, `把多个席位设为「玩家」即可多人同屏轮流操作 · 率先修至 ${winCultivation} 点修为飞升，否则第 ${rounds} 轮结束时修为最高者胜`, { size: 15, origin: [0.5, 0.5], color: HEX.dim });
    this.seats.forEach((_, i) => this.buildRow(i));
    const seedText = txt(this, 640, 600, '', { size: 13, color: HEX.dim, origin: [0.5, 0.5] });
    const refreshSeed = () => seedText.setText(`随机种子 ${this.seed}（点击更换）`);
    refreshSeed();
    seedText.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.seed = randomSeed(); refreshSeed(); });
    new Button(this, 410, 625, { w: 200, h: 56, label: '◀ 返回选人', size: 18 }).onClick(() => fadeToScene(this, 'HeroSelect'));
    new Button(this, 650, 625, { w: 220, h: 56, label: '开始对局 ▶', size: 22, fill: 0x8a5a1e }).onClick(() => this.start());
    txt(this, 640, 700, '空格 / Enter 开始 · Esc 返回', { size: 12, color: HEX.dim, origin: [0.5, 0.5] });
    this.input.keyboard?.on('keydown-SPACE', () => this.start());
    this.input.keyboard?.on('keydown-ENTER', () => this.start());
    this.input.keyboard?.on('keydown-ESC', () => fadeToScene(this, 'HeroSelect'));
  }

  private start(): void {
    fadeToScene(this, 'Versus', newSession(this.seed, this.seats, urlSpeed(1)));
  }

  private buildRow(i: number): void {
    const y = 150 + i * 106;
    const x = 200;
    panel(this, x, y, 880, 96);
    this.add.rectangle(x, y, 8, 96, PLAYER_COLORS[i]).setOrigin(0, 0);
    txt(this, x + 24, y + 14, `席位 ${i + 1}`, { size: 18, bold: true, color: PLAYER_HEX[i] });
    const por = addImg(this, x + 24, y + 40, `por_${this.seats[i].hero}`).setOrigin(0, 0).setScale(0.75);
    const heroName = txt(this, x + 130, y + 14, '', { size: 18, bold: true });
    const heroDesc = txt(this, x + 130, y + 40, '', { size: 12, color: HEX.dim, wrap: 360 });
    const kind = new Button(this, x + 520, y + 12, { w: 110, h: 34, label: '' });
    const diff = new Button(this, x + 640, y + 12, { w: 110, h: 34, label: '' });
    const pers = new Button(this, x + 760, y + 12, { w: 110, h: 34, label: '' });
    const prev = new Button(this, x + 520, y + 52, { w: 52, h: 32, label: '◀' });
    const next = new Button(this, x + 578, y + 52, { w: 52, h: 32, label: '▶' });
    txt(this, x + 640, y + 60, '◀ ▶ 切换修士（同局不重复）', { size: 11, color: HEX.dim });
    const refresh = () => this.renderers.forEach((r) => r());
    const render = () => {
      const s = this.seats[i];
      const h = defaultData.heroes.find((x) => x.id === s.hero)!;
      setFrame(por, `por_${s.hero}`);
      heroName.setText(`${h.name} · ${h.role}`);
      heroDesc.setText(`被动【${h.passive.name}】${h.passive.desc}`);
      kind.setLabel(s.human ? '玩家' : 'AI');
      diff.setLabel(DIFFICULTY_LABEL[s.difficulty]).setEnabled(!s.human);
      pers.setLabel(PERSONALITY_LABEL[s.personality]).setEnabled(!s.human);
    };
    this.renderers.push(render);
    kind.onClick(() => { this.seats[i].human = !this.seats[i].human; render(); });
    diff.onClick(() => { const s = this.seats[i]; s.difficulty = DIFFS[(DIFFS.indexOf(s.difficulty) + 1) % DIFFS.length]; render(); });
    pers.onClick(() => { const s = this.seats[i]; s.personality = PERSONAS[(PERSONAS.indexOf(s.personality) + 1) % PERSONAS.length]; render(); });
    const cycle = (d: number) => {
      const cur = this.seats[i].hero;
      const nextHero: HeroId = HERO_IDS[(HERO_IDS.indexOf(cur) + d + HERO_IDS.length) % HERO_IDS.length];
      const other = this.seats.findIndex((s) => s.hero === nextHero);
      if (other >= 0) this.seats[other].hero = cur; // swap to keep heroes unique
      this.seats[i].hero = nextHero;
      refresh();
    };
    prev.onClick(() => cycle(-1));
    next.onClick(() => cycle(1));
    render();
  }
}
