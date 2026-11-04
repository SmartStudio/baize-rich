import Phaser from 'phaser';
import { DIFFICULTY_LABEL, PERSONALITY_LABEL, type Difficulty, type Personality } from '../ai/ai';
import { defaultData } from '../core/data';
import { HERO_IDS } from '../core/heroes';
import { replayRecord, type GameRecord } from '../core/record';
import type { HeroId } from '../core/types';
import { addImg, setFrame } from '../ui/assets';
import { loadAutosave } from '../ui/saves';
import { newSession, randomSeed, urlParams, type SeatConfig } from '../ui/session';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, txt } from '../ui/theme';
import { Button } from '../ui/widgets';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const PERSONAS: Personality[] = ['steady', 'aggressive', 'miser'];

/** Choose, for each of the 4 seats, human / AI (difficulty + personality) and hero. */
export class SetupScene extends Phaser.Scene {
  private seats: SeatConfig[] = [];
  private seed = randomSeed();
  private renderers: (() => void)[] = [];

  constructor() {
    super('Setup');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.renderers = [];
    const fixed = urlParams().get('seed');
    if (fixed !== null) this.seed = Number(fixed);
    this.seats = HERO_IDS.map((hero, i) => ({
      human: i === 0, hero, difficulty: 'normal', personality: PERSONAS[i % 3],
    }));
    txt(this, 640, 70, '白泽秘境大富翁', { size: 40, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    txt(this, 640, 116, '凡人散修踏入白泽秘境 · 率先修至 10 点修为渡劫飞升', { size: 15, origin: [0.5, 0.5], color: HEX.dim });
    this.seats.forEach((_, i) => this.buildRow(i));
    const seedText = txt(this, 640, 600, '', { size: 13, color: HEX.dim, origin: [0.5, 0.5] });
    const refreshSeed = () => seedText.setText(`随机种子 ${this.seed}（点击更换）`);
    refreshSeed();
    seedText.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.seed = randomSeed(); refreshSeed(); });
    const saved = this.resumable();
    new Button(this, saved ? 410 : 540, 625, { w: 200, h: 56, label: '开始游戏', size: 22, fill: 0x8a5a1e }).onClick(() => this.start());
    if (saved) {
      new Button(this, 650, 625, { w: 220, h: 56, label: '继续上局', size: 20, hint: saved.summary }).onClick(() => this.resume(saved.record));
    }
    txt(this, 640, 700, '快捷键：空格 掷骰/确认 · B 升级 · C 出符 · T 交易 · Enter 结束回合 · Esc 取消 · F 2 倍速', { size: 12, color: HEX.dim, origin: [0.5, 0.5] });
    // With an unfinished save, the shortcut resumes it; starting over takes a click so a save is never lost by accident.
    const quick = saved ? () => this.resume(saved.record) : () => this.start();
    this.input.keyboard?.on('keydown-SPACE', quick);
    this.input.keyboard?.on('keydown-ENTER', quick);
  }

  private start(): void {
    this.scene.start('Game', newSession(this.seed, this.seats, 1));
  }

  /** An unfinished autosave that still replays, with a one-line summary for the button. */
  private resumable(): { record: GameRecord; summary: string } | null {
    const record = loadAutosave();
    if (!record || record.finished) return null;
    let st;
    try {
      st = replayRecord(record).state;
    } catch (e) {
      console.info('[baize] 自动存档无法继续', e);
      return null;
    }
    const humans = record.seats.filter((s) => s.human).length;
    return { record, summary: `第 ${st.round}/${defaultData.config.rounds} 轮 · ${st.players[st.current].name} · 玩家 ${humans} 人` };
  }

  private resume(r: GameRecord): void {
    this.scene.start('Game', { setup: r.setup, seats: r.seats, speed: 1, history: r.history });
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
      heroDesc.setText(`被动【${h.passive.name}】${h.passive.desc}\n大招【${h.ult.name}】${h.ult.desc}`);
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
