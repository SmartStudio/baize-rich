import Phaser from 'phaser';
import { DIFFICULTY_LABEL, type Difficulty } from '../ai/ai';
import { defaultData } from '../core/data';
import { HERO_IDS, skillTerms } from '../core/heroes';
import type { HeroData, HeroId } from '../core/types';
import { addImg } from '../ui/assets';
import { newSession, quickSeats, urlSeed, urlSpeed } from '../ui/session';
import { COLORS, HEX, txt } from '../ui/theme';
import { Button, fadeToScene } from '../ui/widgets';
import { loadSpeed } from '../ui/saves';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

const CARD_W = 276;
const CARD_H = 454;
const GAP = 24;
const CARD_Y = 362;
const QUOTE_Y = 608;
const PORTRAIT_SCALE = 2;
const BACKING_H = 144;
const COPY_W = CARD_W - 28;
const COPY_SIZE = 14;
const cardX = (i: number) => 640 + (i - (HERO_IDS.length - 1) / 2) * (CARD_W + GAP);

interface AbilityCopy {
  title: string;
  terms?: string;
  body: string;
}

function heroAbilities(hero: HeroData): AbilityCopy[] {
  return [
    { title: `技能【${hero.skill.name}】`, terms: skillTerms(hero.skill), body: hero.skill.desc },
    { title: `被动【${hero.passive.name}】`, body: hero.passive.desc },
  ];
}

function stackAbilities(scene: Phaser.Scene, x: number, y: number, lines: AbilityCopy[]): Phaser.GameObjects.Text[] {
  const placed: Phaser.GameObjects.Text[] = [];
  let cursor = y;
  for (const line of lines) {
    const title = txt(scene, x, cursor, line.title, {
      size: COPY_SIZE, bold: true, color: HEX.gold, wrap: COPY_W, lineSpacing: 2,
    });
    placed.push(title);
    cursor += title.height;
    if (line.terms) {
      const terms = txt(scene, x, cursor, line.terms, { size: COPY_SIZE - 2, color: HEX.dim });
      // Terms stay whole: beside the title when they fit, otherwise on their own row.
      if (title.width + 6 + terms.width <= COPY_W) terms.setPosition(x + title.width + 6, title.y + (title.height - terms.height) / 2);
      else cursor += terms.height + 2;
      placed.push(terms);
    }
    cursor += 2;
    const body = txt(scene, x, cursor, line.body, {
      size: COPY_SIZE, color: HEX.parchment, wrap: COPY_W, lineSpacing: 2,
    });
    cursor += body.height + 6;
    placed.push(body);
  }
  return placed;
}

interface Card {
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Rectangle;
  badge: Phaser.GameObjects.Container;
}

/** Pick the hero you play; the other three become AI at one difficulty. 高级设置 opens the per-seat SetupScene. */
export class HeroSelectScene extends Phaser.Scene {
  private chosen: HeroId = HERO_IDS[0];
  private difficulty: Difficulty = 'normal';
  private cards = new Map<HeroId, Card>();
  private hovered: HeroId | null = null;
  private quote!: Phaser.GameObjects.Text;
  private quoted: HeroId | null = null;
  private diffButtons: Button[] = [];

  constructor() {
    super('HeroSelect');
  }

  create(): void {
    this.cards.clear();
    this.hovered = null;
    this.quoted = null;
    this.cameras.main.setBackgroundColor(COLORS.bg).fadeIn(300);
    txt(this, 640, 44, '选择你的修士', { size: 34, bold: true, color: HEX.gold, origin: [0.5, 0.5], stroke: HEX.ink });
    txt(this, 640, 84, '点选一名修士作为「你」，其余三位由 AI 扮演 · 你坐 1 号位，第一个行动', { size: 15, color: HEX.dim, origin: [0.5, 0.5] });
    HERO_IDS.forEach((h, i) => this.buildCard(h, i));
    this.quote = txt(this, 640, QUOTE_Y, '', { size: 18, color: HEX.parchment, origin: [0.5, 0.5] });

    new Button(this, 40, 632, { w: 120, h: 52, label: '◀ 返回', size: 16 }).onClick(() => fadeToScene(this, 'Title'));
    txt(this, 214, 658, 'AI 难度', { size: 16, bold: true, origin: [0, 0.5] });
    this.diffButtons = DIFFS.map((d, k) => new Button(this, 290 + k * 100, 636, { w: 92, h: 44, label: DIFFICULTY_LABEL[d], size: 16 })
      .onClick(() => { this.difficulty = d; this.render(); }));
    new Button(this, 740, 632, { w: 170, h: 52, label: '高级设置', size: 16, hint: '多人同屏 · AI 性格 · 种子' })
      .onClick(() => fadeToScene(this, 'Setup', { seats: quickSeats(this.chosen, this.difficulty) }));
    new Button(this, 1060, 626, { w: 180, h: 62, label: '开始对局 ▶', size: 22, fill: 0x8a5a1e }).onClick(() => this.start());

    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.render(true);
  }

  private buildCard(hero: HeroId, i: number): void {
    const h = defaultData.heroes.find((x) => x.id === hero)!;
    const w = CARD_W;
    const top = -CARD_H / 2;
    const root = this.add.container(cardX(i), CARD_Y);
    const frame = this.add.rectangle(0, 0, w, CARD_H, COLORS.panel).setStrokeStyle(3, COLORS.outline);
    const backY = top + 10 + BACKING_H / 2;
    const backing = this.add.rectangle(0, backY, w - 28, BACKING_H, COLORS.panelLight).setStrokeStyle(2, COLORS.outline);
    const por = addImg(this, 0, backY, `por_${hero}`).setScale(PORTRAIT_SCALE);
    const nameY = backY + BACKING_H / 2 + 18;
    const name = txt(this, 0, nameY, h.name, { size: 26, bold: true, origin: [0.5, 0.5] });
    const roleY = nameY + 30;
    const role = this.add.rectangle(0, roleY, 108, 24, COLORS.ink).setStrokeStyle(2, COLORS.gold);
    const roleText = txt(this, 0, roleY, h.school, { size: 13, bold: true, color: HEX.gold, origin: [0.5, 0.5] });
    const sections = stackAbilities(this, -w / 2 + 14, roleY + 20, heroAbilities(h));
    const badgeBg = this.add.rectangle(0, 0, 64, 30, COLORS.gold).setStrokeStyle(2, COLORS.outline);
    const badge = this.add.container(-w / 2 + 40, top + 4, [badgeBg, txt(this, 0, 0, '你', { size: 18, bold: true, color: HEX.ink, origin: [0.5, 0.5] })]);
    root.add([frame, backing, por, name, role, roleText, ...sections, badge]);
    root.setSize(w, CARD_H);
    frame.setInteractive({ useHandCursor: true })
      .on('pointerover', () => { this.hovered = hero; this.render(); })
      .on('pointerout', () => { if (this.hovered === hero) this.hovered = null; this.render(); })
      .on('pointerdown', () => { this.chosen = hero; this.render(); });
    this.cards.set(hero, { root, frame, badge });
  }

  /** One pass sets every card from (chosen, hovered); the tweens make the chosen card pop. */
  private render(instant = false): void {
    for (const [hero, c] of this.cards) {
      const chosen = hero === this.chosen;
      const hover = hero === this.hovered;
      c.frame.setStrokeStyle(chosen ? 4 : 3, chosen ? COLORS.gold : hover ? COLORS.parchment : COLORS.outline);
      c.frame.setFillStyle(chosen ? COLORS.panelLight : COLORS.panel);
      c.badge.setVisible(chosen);
      const to = { scale: chosen ? 1.05 : hover ? 1.02 : 0.97, y: CARD_Y + (chosen ? -12 : 0), alpha: chosen || hover ? 1 : 0.72 };
      this.tweens.killTweensOf(c.root);
      if (instant) c.root.setScale(to.scale).setY(to.y).setAlpha(to.alpha);
      else this.tweens.add({ targets: c.root, ...to, duration: 160, ease: 'Back.easeOut' });
    }
    const chosenRoot = this.cards.get(this.chosen)!.root;
    this.children.bringToTop(chosenRoot);
    const h = defaultData.heroes.find((x) => x.id === this.chosen)!;
    if (this.quoted !== this.chosen) {
      this.quoted = this.chosen;
      this.quote.setText(`${h.name}（${h.origin}）：${h.quote}`).setAlpha(0);
      this.tweens.add({ targets: this.quote, alpha: 1, duration: 300 });
    }
    this.diffButtons.forEach((b, k) => b.setLabel(DIFFS[k] === this.difficulty ? `● ${DIFFICULTY_LABEL[DIFFS[k]]}` : DIFFICULTY_LABEL[DIFFS[k]]));
  }

  private start(): void {
    fadeToScene(this, 'Versus', newSession(urlSeed(), quickSeats(this.chosen, this.difficulty), urlSpeed(loadSpeed())));
  }

  private onKey(ev: KeyboardEvent): void {
    const i = HERO_IDS.indexOf(this.chosen);
    const n = HERO_IDS.length;
    if (ev.key === 'ArrowLeft') this.chosen = HERO_IDS[(i - 1 + n) % n];
    else if (ev.key === 'ArrowRight') this.chosen = HERO_IDS[(i + 1) % n];
    else if (ev.key >= '1' && ev.key <= String(n)) this.chosen = HERO_IDS[Number(ev.key) - 1];
    else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); this.start(); return; }
    else if (ev.key === 'Escape') { fadeToScene(this, 'Title'); return; }
    else return;
    this.render();
  }
}
