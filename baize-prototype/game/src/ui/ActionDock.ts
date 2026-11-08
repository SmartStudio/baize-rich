// Floating HUD on the right. Utility pills (倍速, 战报, 记录, the speaker) sit on top. The dock under them lists the
// human's current choices: a roll, or the upgrades, 服丹 and 闭关 the engine is offering.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import type { GameState } from '../core/types';
import { addImg, hasFrame, setFrame } from './assets';
import { IDLE_PLAN, type DockOffer, type DockPlan } from './dockPlan';
import { DOCK, H, RIGHT, type Rect } from './layout';
import { SoundControl } from './SoundControl';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import type { Tooltip, TipContent } from './Tooltip';
import { Button } from './widgets';

const CARD_SCALE = 0.4;
const CARD_GAP = 6;
const PORTRAIT = 40;
const OFFER_H = 48;
const OFFER_GAP = 4;
const PILL_W = { text: 62, sound: 32 };
const QUIET_END = COLORS.panelLight;
const LOUD_END = 0xc03a40;

interface OfferButton {
  id: string;
  button: Button;
  rect: Rect;
}

export class ActionDock {
  private x = RIGHT.x;
  private w = RIGHT.w;
  private frame: Phaser.GameObjects.Rectangle;
  private turnPortrait: Phaser.GameObjects.Image;
  private turnName: Phaser.GameObjects.Text;
  private turnHint: Phaser.GameObjects.Text;
  private planHint: Phaser.GameObjects.Text;
  private dice: Phaser.GameObjects.Image[];
  private handLabel: Phaser.GameObjects.Text | null = null;
  private handLayer: Phaser.GameObjects.Container;
  private handTop = 0;
  private rollGlow: Phaser.GameObjects.Rectangle | null = null;
  private rollPulse: Phaser.Tweens.Tween | null = null;
  private lastTurn: [GameState, boolean] | null = null;
  private plan: DockPlan = IDLE_PLAN;
  /** A board pick's line. While set the dock only explains the lit cells: no roll button. */
  private pickHint: string | null = null;
  /** Backs out of a board pick the engine lets you cancel; null hides 取消. */
  private pickCancel: (() => void) | null = null;
  private offerButtons: OfferButton[] = [];
  private moreButton: Button | null = null;
  private offerHandler: ((id: string) => void) | null = null;
  private moreHandler: (() => void) | null = null;
  private rollRectBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private endRectBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly halfW: number;
  readonly btnSpeed: Button;
  readonly btnLog: Button;
  readonly btnSave: Button;
  readonly sound: SoundControl;
  readonly btnCast: Button;
  readonly btnEnd: Button;
  readonly btnRoll: Button;
  private btnBack: Button;
  private cardClick: ((card: string) => void) | null = null;
  private castable = new Set<string>();

  /** `actions`: false for an all-AI game, which only needs the turn header. */
  constructor(private scene: Phaser.Scene, private game: Game, private tip: Tooltip, private actions: boolean) {
    const s = scene;
    const { x, w } = this;
    // 倍速 takes the slack: its label is the only one that grows (×0.5).
    const speedW = w - PILL_W.sound - 2 * PILL_W.text - 12;
    let px = x;
    const pill = (pw: number, label: string) => {
      const b = new Button(s, px, RIGHT.utilY, { w: pw, h: RIGHT.utilH, label, size: FS.sm });
      px += pw + 4;
      return b;
    };
    this.btnSpeed = pill(speedW, '');
    this.btnLog = pill(PILL_W.text, '战报 · L');
    this.btnSave = pill(PILL_W.text, '记录 · S');
    this.sound = new SoundControl(s, px, RIGHT.utilY, PILL_W.sound, RIGHT.utilH);

    const rowW = w - 2 * DOCK.pad;
    this.halfW = Math.floor((rowW - DOCK.gap) / 2);
    this.frame = s.add.rectangle(x, 0, w, 10, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold);
    this.turnPortrait = addImg(s, 0, 0, 'por_body_s').setOrigin(0, 0);
    this.turnName = txt(s, 0, 0, '', { size: FS.md, bold: true });
    this.turnHint = txt(s, 0, 0, '', { size: FS.xs, color: HEX.dim });
    this.planHint = txt(s, 0, 0, '', { size: FS.sm, color: HEX.gold, wrap: rowW });
    this.dice = [0, 1].map(() => addImg(s, 0, 0, 'die_1'));
    this.btnRoll = new Button(s, 0, 0, { w: rowW, h: DOCK.rollH, label: '掷骰子 · 空格', size: FS.xl, fill: COLORS.gold, textColor: HEX.ink });
    this.btnCast = new Button(s, 0, 0, { w: this.halfW, h: DOCK.btnH, label: '出符 · C', size: FS.sm });
    this.btnEnd = new Button(s, 0, 0, { w: this.halfW, h: DOCK.btnH, label: '结束 · ↵', size: FS.sm, fill: LOUD_END });
    this.btnBack = new Button(s, 0, 0, { w: rowW, h: DOCK.btnH, label: '取消 · Esc', size: FS.sm }).onClick(() => this.pickCancel?.());
    this.handLayer = s.add.container(0, 0);
    if (actions) {
      this.handLabel = txt(s, 0, 0, '', { size: FS.xs, color: HEX.dim });
      this.rollGlow = s.add.rectangle(0, 0, rowW + 8, DOCK.rollH + 8).setOrigin(0, 0).setStrokeStyle(3, COLORS.parchment).setAlpha(0);
      this.rollPulse = s.tweens.add({ targets: this.rollGlow, alpha: { from: 0.15, to: 1 }, duration: 450, yoyo: true, repeat: -1, paused: true });
    }
    this.layout();
  }

  onCardClick(fn: (card: string) => void): void {
    this.cardClick = fn;
  }

  onOffer(fn: (id: string) => void): void {
    this.offerHandler = fn;
  }

  onMore(fn: () => void): void {
    this.moreHandler = fn;
  }

  setCastable(cards: string[]): void {
    this.castable = new Set(cards);
  }

  setPlan(plan: DockPlan): void {
    this.plan = plan;
    this.pickHint = null;
    this.pickCancel = null;
    this.layout();
    if (this.lastTurn) this.applyTurn(this.lastTurn[0], this.lastTurn[1]);
  }

  /** Answer on the board: the plan goes idle and the dock shows `hint` instead, and 取消 when `cancel` is given. */
  setPick(hint: string, cancel: (() => void) | null): void {
    this.setPlan(IDLE_PLAN);
    this.pickHint = hint;
    this.pickCancel = cancel;
    this.layout();
    if (this.lastTurn) this.applyTurn(this.lastTurn[0], this.lastTurn[1]);
  }

  rollRect(): Rect {
    return this.rollRectBox;
  }

  endRect(): Rect {
    return this.endRectBox;
  }

  offerRect(id: string): Rect | null {
    return this.offerButtons.find((row) => row.id === id)?.rect ?? null;
  }

  setTurn(state: GameState, human: boolean): void {
    this.lastTurn = [state, human];
    this.applyTurn(state, human);
  }

  private applyTurn(state: GameState, human: boolean): void {
    const p = state.players[state.current];
    setFrame(this.turnPortrait, `por_${p.hero}_s`);
    this.turnName.setText(state.over ? '对局结束' : `${p.name} 的回合`).setColor(PLAYER_HEX[p.seat]);
    this.turnHint.setText(this.phaseLine(state, human)).setColor(human && !state.over ? HEX.gold : HEX.dim);
    const lit = human && !state.over;
    this.frame.setStrokeStyle(lit ? 3 : 2, lit ? PLAYER_COLORS[p.seat] : COLORS.gold);
  }

  private phaseLine(state: GameState, human: boolean): string {
    if (state.over) return '';
    if (!human) return 'AI 正在行动…';
    if (this.pickHint !== null) return '在棋盘上选';
    if (this.plan.roll) return '掷骰前';
    if (this.plan.end) return '行动阶段';
    return '';
  }

  setRollWaiting(on: boolean): void {
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
    p.hand.forEach((card, i) => this.addCard(card, i, left, top, cw, ch));
    if (n === 0) this.handLayer.add(txt(s, left, top + ch / 2, '暂无符箓', { size: FS.sm, color: PLAYER_HEX[p.seat], origin: [0, 0.5] }));
  }

  private addCard(card: string, i: number, left: number, top: number, cw: number, ch: number): void {
    const spell = this.game.spellById.get(card)!;
    const s = this.scene;
    const bx = left + i * (cw + CARD_GAP);
    const can = this.castable.has(card);
    const rect: Rect = { x: bx, y: top, w: cw, h: ch };
    const c = s.add.container(bx, top);
    const frame = hasFrame(s, `card_${spell.id}`) ? `card_${spell.id}` : `card_${spell.cat}`;
    const img = addImg(s, 0, 0, frame).setOrigin(0, 0).setScale(CARD_SCALE);
    const name = txt(s, cw / 2, ch * 0.68, spell.name, { size: FS.xs, color: HEX.ink, origin: [0.5, 0.5], bold: true });
    const glow = s.add.rectangle(-2, -2, cw + 4, ch + 4).setOrigin(0, 0).setStrokeStyle(2, can ? COLORS.gold : COLORS.outline);
    c.add([img, name, glow]);
    if (!can) c.setAlpha(0.75);
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => { c.y = top - 4; });
    img.on('pointerout', () => { c.y = top; });
    img.on('pointerdown', () => this.tip.toggle(`card:${i}:${card}`, rect, this.cardTip(card)));
    this.handLayer.add(c);
  }

  private cardTip(card: string): TipContent {
    const spell = this.game.spellById.get(card)!;
    const cat = this.game.data.spells.categories[spell.cat];
    const can = this.castable.has(card);
    return {
      title: `${spell.name} · ${cat.name}`,
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

  private layout(): void {
    this.clearOffers();
    if (!this.actions) {
      this.placeChrome(H - 8 - headerH(), headerH());
      this.hideControls();
      return;
    }
    const hintH = this.measureHint();
    const h = dockHeight(hintH, offerBlock(this.plan), this.showsRoll(), this.showsRow());
    const y = H - 8 - h;
    this.placeChrome(y, h);
    let cursor = y + DOCK.pad + DOCK.headH;
    cursor = this.placeHint(cursor, hintH);
    cursor = this.placeOffers(cursor);
    cursor = this.placeRoll(cursor);
    cursor = this.placeRow(cursor);
    this.handTop = cursor + DOCK.gap;
    this.handLabel?.setPosition(this.x + DOCK.pad, this.handTop);
    this.paintControls();
  }

  private measureHint(): number {
    const hint = this.pickHint ?? this.plan.hint;
    this.planHint.setText(hint).setVisible(hint !== '');
    return hint ? Math.ceil(this.planHint.height) : 0;
  }

  private placeChrome(y: number, h: number): void {
    const p = DOCK.pad;
    this.frame.setPosition(this.x, y).setSize(this.w, h);
    this.turnPortrait.setPosition(this.x + p, y + p + (DOCK.headH - PORTRAIT) / 2);
    this.turnName.setPosition(this.x + p + PORTRAIT + 8, y + p + 4);
    this.turnHint.setPosition(this.x + p + PORTRAIT + 8, y + p + 25);
    this.dice.forEach((die, k) => die.setPosition(this.x + this.w - p - 15 - (1 - k) * 36, y + p + DOCK.headH / 2));
  }

  private placeHint(cursor: number, hintH: number): number {
    if (hintH === 0) return cursor;
    const y = cursor + DOCK.gap;
    this.planHint.setPosition(this.x + DOCK.pad, y);
    return y + hintH;
  }

  private placeOffers(cursor: number): number {
    if (this.plan.offers.length === 0 && this.plan.more === 0) return cursor;
    let y = cursor + DOCK.gap;
    const x = this.x + DOCK.pad;
    const w = this.w - 2 * DOCK.pad;
    for (const offer of this.plan.offers) y = this.addOffer(offer, x, y, w);
    if (this.plan.more > 0) y = this.addMore(x, y, w);
    return y - OFFER_GAP;
  }

  private addOffer(offer: DockOffer, x: number, y: number, w: number): number {
    const button = new Button(this.scene, x, y, {
      w, h: OFFER_H, label: offer.title, hint: offer.detail, hintColor: HEX.ink,
      size: FS.sm, fill: COLORS.gold, textColor: HEX.ink,
    }).onClick(() => this.offerHandler?.(offer.id));
    this.offerButtons.push({ id: offer.id, button, rect: { x, y, w, h: OFFER_H } });
    return y + OFFER_H + OFFER_GAP;
  }

  private addMore(x: number, y: number, w: number): number {
    this.moreButton = new Button(this.scene, x, y, {
      w, h: OFFER_H, label: `还有 ${this.plan.more} 块 · B`, size: FS.sm,
    }).onClick(() => this.moreHandler?.());
    return y + OFFER_H + OFFER_GAP;
  }

  private placeRoll(cursor: number): number {
    const show = this.showsRoll();
    this.btnRoll.setVisible(show);
    if (!show) {
      this.rollRectBox = { x: 0, y: 0, w: 0, h: 0 };
      return cursor;
    }
    const x = this.x + DOCK.pad;
    const y = cursor + DOCK.gap;
    this.btnRoll.setPosition(x, y);
    this.rollRectBox = { x, y, w: this.w - 2 * DOCK.pad, h: DOCK.rollH };
    this.rollGlow?.setPosition(x - 4, y - 4);
    return y + DOCK.rollH;
  }

  private placeRow(cursor: number): number {
    const showCast = this.plan.cast || this.plan.end;
    const showEnd = this.plan.end;
    const showBack = this.pickCancel !== null;
    this.btnCast.setVisible(this.actions && showCast);
    this.btnEnd.setVisible(this.actions && showEnd);
    this.btnBack.setVisible(this.actions && showBack);
    if (!showCast && !showEnd && !showBack) {
      this.endRectBox = { x: 0, y: 0, w: 0, h: 0 };
      return cursor;
    }
    const y = cursor + DOCK.gap;
    const x = this.x + DOCK.pad;
    this.btnCast.setPosition(x, y);
    this.btnBack.setPosition(x, y);
    const endX = showCast ? x + this.halfW + DOCK.gap : x;
    this.btnEnd.setPosition(endX, y);
    this.endRectBox = showEnd ? { x: endX, y, w: this.halfW, h: DOCK.btnH } : { x: 0, y: 0, w: 0, h: 0 };
    return y + DOCK.btnH;
  }

  private paintControls(): void {
    this.btnRoll.setEnabled(this.plan.roll);
    this.btnCast.setEnabled(this.plan.cast);
    this.btnEnd.setFill(this.plan.end && this.plan.endLoud ? LOUD_END : QUIET_END);
    this.btnEnd.setEnabled(this.plan.end);
  }

  private showsRoll(): boolean {
    return this.actions && !this.plan.end && this.pickHint === null;
  }

  private showsRow(): boolean {
    return this.actions && (this.plan.end || this.plan.cast || this.pickCancel !== null);
  }

  private hideControls(): void {
    this.btnRoll.setVisible(false);
    this.btnCast.setVisible(false);
    this.btnEnd.setVisible(false);
    this.btnBack.setVisible(false);
    this.planHint.setVisible(false);
  }

  private clearOffers(): void {
    for (const row of this.offerButtons) row.button.destroy(true);
    this.offerButtons = [];
    this.moreButton?.destroy(true);
    this.moreButton = null;
  }
}

function headerH(): number {
  return DOCK.pad * 2 + DOCK.headH;
}

function offerBlock(plan: DockPlan): number {
  const n = plan.offers.length + (plan.more > 0 ? 1 : 0);
  if (n === 0) return 0;
  return DOCK.gap + n * OFFER_H + (n - 1) * OFFER_GAP;
}

function dockHeight(hintH: number, offers: number, roll: boolean, row: boolean): number {
  const hint = hintH > 0 ? DOCK.gap + hintH : 0;
  const rollH = roll ? DOCK.gap + DOCK.rollH : 0;
  const rowH = row ? DOCK.gap + DOCK.btnH : 0;
  return DOCK.pad + DOCK.headH + hint + offers + rollH + rowH + DOCK.gap + DOCK.handH + DOCK.pad;
}

function timingName(t: string): string {
  return ({ action: '行动阶段', reaction: '被斗法 / 被夺丹时', rent: '付租时', preroll: '掷骰前', adjust: '掷骰后', closure: '闭关突破时' } as Record<string, string>)[t] ?? t;
}
