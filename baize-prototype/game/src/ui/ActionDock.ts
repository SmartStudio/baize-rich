// Floating HUD on the right: utility pills (倍速 / 战报 / 记录) at the top, and the action dock at
// the bottom with whose turn it is, the last roll, 掷骰子, 升级 / 出符 / 结束回合 and the hand as small
// cards. Clicking a card opens its detail, with a 施放 button when it can be cast now.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import type { GameState } from '../core/types';
import { addImg, setFrame } from './assets';
import { DOCK, H, RIGHT, type Rect } from './layout';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import type { Tooltip, TipContent } from './Tooltip';
import { Button } from './widgets';

/** Hand cards are the 88×120 card art at this scale. */
const CARD_SCALE = 0.4;
const CARD_GAP = 6;
const PORTRAIT = 36;

export class ActionDock {
  private x = RIGHT.x;
  private w = RIGHT.w;
  private frame: Phaser.GameObjects.Rectangle;
  private turnPortrait: Phaser.GameObjects.Image;
  private turnName: Phaser.GameObjects.Text;
  private turnHint: Phaser.GameObjects.Text;
  private dice: Phaser.GameObjects.Image[];
  private handLabel: Phaser.GameObjects.Text | null = null;
  private handLayer: Phaser.GameObjects.Container;
  private handTop = 0;
  private rollGlow: Phaser.GameObjects.Rectangle | null = null;
  private rollPulse: Phaser.Tweens.Tween | null = null;
  private rollWaiting = false;
  private lastTurn: [GameState, boolean] | null = null;
  readonly btnSpeed: Button;
  readonly btnLog: Button;
  readonly btnSave: Button;
  readonly btnUpgrade: Button;
  readonly btnCast: Button;
  readonly btnEnd: Button;
  readonly btnRoll: Button;
  private cardClick: ((card: string) => void) | null = null;
  private castable = new Set<string>();

  /** `actions`: false for an all-AI game, which only needs the turn header. */
  constructor(private scene: Phaser.Scene, private game: Game, private tip: Tooltip, actions: boolean) {
    const s = scene;
    const { x, w } = this;
    const uw = (w - 8) / 3;
    this.btnSpeed = new Button(s, x, RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '', size: FS.sm });
    this.btnLog = new Button(s, x + uw + 4, RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '战报 · L', size: FS.sm });
    this.btnSave = new Button(s, x + 2 * (uw + 4), RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '记录 · S', size: FS.sm });

    const p = DOCK.pad;
    const bodyH = actions ? DOCK.gap + DOCK.rollH + DOCK.gap + DOCK.btnH + DOCK.gap + DOCK.handH : 0;
    const h = p + DOCK.headH + bodyH + p;
    const y = H - 8 - h;
    this.frame = s.add.rectangle(x, y, w, h, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    this.turnPortrait = addImg(s, x + p, y + p + (DOCK.headH - PORTRAIT) / 2, 'por_body').setOrigin(0, 0).setScale(PORTRAIT / 64);
    this.turnName = txt(s, x + p + PORTRAIT + 8, y + p + 4, '', { size: FS.md, bold: true });
    this.turnHint = txt(s, x + p + PORTRAIT + 8, y + p + 25, '', { size: FS.xs, color: HEX.dim });
    this.dice = [0, 1].map((k) => addImg(s, x + w - p - 15 - (1 - k) * 36, y + p + DOCK.headH / 2, 'die_1'));

    const ry = y + p + DOCK.headH + DOCK.gap;
    this.btnRoll = new Button(s, x + p, ry, { w: w - 2 * p, h: DOCK.rollH, label: '掷骰子 · 空格', size: FS.xl, fill: COLORS.gold, textColor: HEX.ink });
    const by = ry + DOCK.rollH + DOCK.gap;
    const bw = (w - 2 * p - 2 * DOCK.gap) / 3;
    this.btnUpgrade = new Button(s, x + p, by, { w: bw, h: DOCK.btnH, label: '升级 · B', size: FS.sm });
    this.btnCast = new Button(s, x + p + bw + DOCK.gap, by, { w: bw, h: DOCK.btnH, label: '出符 · C', size: FS.sm });
    this.btnEnd = new Button(s, x + p + 2 * (bw + DOCK.gap), by, { w: bw, h: DOCK.btnH, label: '结束 · ↵', size: FS.sm, fill: 0xc03a40 });
    this.handTop = by + DOCK.btnH + DOCK.gap;
    this.handLayer = s.add.container(0, 0);
    if (actions) {
      this.handLabel = txt(s, x + p, this.handTop, '', { size: FS.xs, color: HEX.dim });
      this.rollGlow = s.add.rectangle(x + p - 4, ry - 4, w - 2 * p + 8, DOCK.rollH + 8).setOrigin(0, 0).setStrokeStyle(3, COLORS.parchment).setAlpha(0);
      this.rollPulse = s.tweens.add({ targets: this.rollGlow, alpha: { from: 0.15, to: 1 }, duration: 450, yoyo: true, repeat: -1, paused: true });
    } else {
      for (const b of [this.btnRoll, this.btnUpgrade, this.btnCast, this.btnEnd]) b.setVisible(false);
    }
  }

  onCardClick(fn: (card: string) => void): void {
    this.cardClick = fn;
  }

  setCastable(cards: string[]): void {
    this.castable = new Set(cards);
  }

  /** Dock header: whose turn it is. A human's own turn lights the dock up. */
  setTurn(state: GameState, human: boolean): void {
    this.lastTurn = [state, human];
    const p = state.players[state.current];
    setFrame(this.turnPortrait, `por_${p.hero}`);
    this.turnName.setText(state.over ? '对局结束' : `${p.name} 的回合`).setColor(PLAYER_HEX[p.seat]);
    this.turnHint.setText(state.over ? '' : human ? (this.rollWaiting ? '掷骰，或先升级、出符' : '可升级、出符，或结束回合') : 'AI 正在行动…').setColor(human ? HEX.gold : HEX.dim);
    const lit = human && !state.over;
    this.frame.setStrokeStyle(lit ? 3 : 2, lit ? PLAYER_COLORS[p.seat] : COLORS.gold);
  }

  /** The roll button breathes while it waits for a human to press it. */
  setRollWaiting(on: boolean): void {
    this.rollWaiting = on;
    if (this.lastTurn) this.setTurn(...this.lastTurn);
    if (on) this.rollPulse?.resume();
    else {
      this.rollPulse?.pause();
      this.rollGlow?.setAlpha(0);
    }
  }

  renderHand(state: GameState, viewer: number | null): void {
    if (!this.handLabel) return;
    const g = this.game;
    const s = this.scene;
    this.handLayer.removeAll(true);
    const p = viewer === null ? null : state.players[viewer];
    const shown = p ?? state.players[state.current];
    const n = shown.hand.length;
    this.handLabel.setText(p ? `符箓 ${n}/${g.data.config.handLimit} · 点击查看` : `${shown.name} 的符箓 ${n} 张（不可见）`);
    const cw = 88 * CARD_SCALE;
    const ch = 120 * CARD_SCALE;
    const top = this.handTop + DOCK.handH - ch - 2;
    const left = this.x + DOCK.pad;
    if (!p) {
      shown.hand.forEach((_, i) => {
        this.handLayer.add(s.add.rectangle(left + i * (cw + CARD_GAP), top, cw, ch, COLORS.panelLight).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline));
      });
      return;
    }
    p.hand.forEach((card, i) => {
      const spell = g.spellById.get(card)!;
      const bx = left + i * (cw + CARD_GAP);
      const can = this.castable.has(card);
      const rect: Rect = { x: bx, y: top, w: cw, h: ch };
      const c = s.add.container(bx, top);
      const img = addImg(s, 0, 0, `card_${spell.cat}`).setOrigin(0, 0).setScale(CARD_SCALE);
      const name = txt(s, cw / 2, ch * 0.68, spell.name, { size: FS.xs, color: HEX.ink, origin: [0.5, 0.5], bold: true });
      const cost = s.add.circle(cw - 5, 5, 6, 0xe0663a).setStrokeStyle(1, COLORS.outline);
      const costT = txt(s, cw - 5, 5, `${spell.cost}`, { size: FS.xs, origin: [0.5, 0.5], bold: true });
      const glow = s.add.rectangle(-2, -2, cw + 4, ch + 4).setOrigin(0, 0).setStrokeStyle(2, can ? COLORS.gold : COLORS.outline);
      c.add([img, name, cost, costT, glow]);
      if (!can) c.setAlpha(0.75);
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => { c.y = top - 4; });
      img.on('pointerout', () => { c.y = top; });
      img.on('pointerdown', () => this.tip.toggle(`card:${i}:${card}`, rect, this.cardTip(card)));
      this.handLayer.add(c);
    });
    if (n === 0) this.handLayer.add(txt(s, left, top + ch / 2, '暂无符箓', { size: FS.sm, color: PLAYER_HEX[p.seat], origin: [0, 0.5] }));
  }

  private cardTip(card: string): TipContent {
    const g = this.game;
    const spell = g.spellById.get(card)!;
    const cat = g.data.spells.categories[spell.cat];
    const can = this.castable.has(card);
    return {
      title: `${spell.name} · ${cat.name} · ${spell.cost} 灵丹`,
      body: `时机：${timingName(spell.timing)}\n${spell.desc}${can ? '' : '\n（现在不能施放）'}`,
      action: can ? { label: `施放 ${spell.name}`, onClick: () => this.cardClick?.(card) } : undefined,
    };
  }

  setDice(d: [number, number]): void {
    setFrame(this.dice[0], `die_${d[0]}`);
    setFrame(this.dice[1], `die_${d[1]}`);
  }

  shakeDice(ms: number): Promise<void> {
    return new Promise((res) => {
      const ticks = Math.max(2, Math.floor(ms / 50));
      let k = 0;
      this.scene.time.addEvent({
        delay: 50, repeat: ticks - 1,
        callback: () => {
          this.setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
          if (++k >= ticks) res();
        },
      });
    });
  }
}

function timingName(t: string): string {
  return ({ action: '行动阶段', reaction: '被攻击 / 被收购时', rent: '付租时', start: '回合开始', preroll: '掷骰前' } as Record<string, string>)[t] ?? t;
}
