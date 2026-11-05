// Right column: utility buttons, tile card, hand, action buttons, roll dock (whose turn + dice + 掷骰子).
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { nominalRent, rentFor } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import { addImg, setFrame } from './assets';
import { RIGHT } from './layout';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, panel, tab, txt, type Tab } from './theme';
import { Button } from './widgets';

const REGION_HEX: Record<string, string> = { wood: '#6FCF7F', fire: '#E0663A', water: '#5FB7E0', earth: '#B48BE0' };
const CAT_HEX: Record<string, string> = { attack: HEX.bad, guard: '#5FB7E0', move: HEX.good, wealth: HEX.gold };
const TILE_TAB = { label: '地块', fill: 0x3f8a4f };
const CARD_TAB = { label: '符箓', fill: 0x6a55c8 };
const CARD = { w: 88, h: 120, gap: 6 };

export class SidePanel {
  private tileTab: Tab;
  private tileTitle: Phaser.GameObjects.Text;
  private tileSub: Phaser.GameObjects.Text;
  private tileBody: Phaser.GameObjects.Text;
  private tileNote: Phaser.GameObjects.Text;
  private prevTile: Phaser.GameObjects.Image;
  private prevObj: Phaser.GameObjects.Image;
  private prevCard: Phaser.GameObjects.Image;
  private handTab: Phaser.GameObjects.Text;
  private handLayer: Phaser.GameObjects.Container;
  private dock: Phaser.GameObjects.Rectangle;
  private turnPortrait: Phaser.GameObjects.Image;
  private turnName: Phaser.GameObjects.Text;
  private turnHint: Phaser.GameObjects.Text;
  private dice: Phaser.GameObjects.Image[];
  private rollGlow: Phaser.GameObjects.Rectangle;
  private rollPulse: Phaser.Tweens.Tween;
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
  private hoverCard: string | null = null;

  constructor(private scene: Phaser.Scene, private game: Game) {
    const s = scene;
    const x = RIGHT.x;
    const w = RIGHT.w;
    // --- utility row
    const uw = (w - 8) / 3;
    this.btnSpeed = new Button(s, x, RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '', size: 12 });
    this.btnLog = new Button(s, x + uw + 4, RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '战报 · L', size: 12 });
    this.btnSave = new Button(s, x + 2 * (uw + 4), RIGHT.utilY, { w: uw, h: RIGHT.utilH, label: '记录 · S', size: 12 });
    // --- tile card
    const ty = RIGHT.tileY;
    panel(s, x, ty, w, RIGHT.tileH);
    this.tileTab = tab(s, x + w / 2, ty, TILE_TAB.label, TILE_TAB.fill);
    s.add.rectangle(x + 10, ty + 18, 68, 68, COLORS.outline).setOrigin(0, 0);
    this.prevTile = addImg(s, x + 12, ty + 20, 'tile_gate').setOrigin(0, 0);
    this.prevObj = addImg(s, x + 44, ty + 68, 'obj_gate').setOrigin(0.5, 1);
    this.prevCard = addImg(s, x + 44, ty + 52, 'card_attack').setScale(0.5).setVisible(false);
    this.tileTitle = txt(s, x + 88, ty + 16, '', { size: 17, bold: true });
    this.tileSub = txt(s, x + 88, ty + 40, '', { size: 11, color: HEX.good, wrap: w - 96 });
    this.tileBody = txt(s, x + 88, ty + 58, '', { size: 11, wrap: w - 96, lineSpacing: 1 });
    this.tileNote = txt(s, x + 10, ty + 92, '', { size: 11, color: HEX.dim, wrap: 72 });
    // --- hand
    panel(s, x, RIGHT.handY, w, RIGHT.handH);
    this.handTab = tab(s, x + w / 2, RIGHT.handY, '符箓', CARD_TAB.fill).label;
    this.handLayer = s.add.container(0, 0);
    // --- action buttons (key hints on the buttons replace the old legend)
    const bw = (w - 16) / 3;
    const by = RIGHT.btnY;
    this.btnUpgrade = new Button(s, x, by, { w: bw, h: RIGHT.btnH, label: '升级', hint: 'B' });
    this.btnCast = new Button(s, x + (bw + 8), by, { w: bw, h: RIGHT.btnH, label: '出符', hint: 'C' });
    this.btnEnd = new Button(s, x + 2 * (bw + 8), by, { w: bw, h: RIGHT.btnH, label: '结束回合', hint: 'Enter', fill: 0xc03a40, hintColor: HEX.parchment });
    // --- roll dock: whose turn, dice, 掷骰子
    const dy = RIGHT.dockY;
    this.dock = panel(s, x, dy, w, RIGHT.dockH, COLORS.panel, COLORS.gold);
    this.turnPortrait = addImg(s, x + 12, dy + 12, 'por_body').setOrigin(0, 0).setScale(48 / 64);
    this.turnName = txt(s, x + 70, dy + 14, '', { size: 16, bold: true });
    this.turnHint = txt(s, x + 70, dy + 38, '', { size: 12, color: HEX.dim, wrap: w - 80 });
    this.dice = [addImg(s, x + w / 2 - 36, dy + 110, 'die_1').setScale(2), addImg(s, x + w / 2 + 36, dy + 110, 'die_6').setScale(2)];
    this.btnRoll = new Button(s, x + 12, dy + 158, { w: w - 24, h: 86, label: '掷骰子', hint: '空格', size: 28, fill: COLORS.gold, textColor: HEX.ink, hintColor: HEX.ink });
    this.rollGlow = s.add.rectangle(x + 6, dy + 152, w - 12, 98).setOrigin(0, 0).setStrokeStyle(4, COLORS.parchment).setAlpha(0);
    this.rollPulse = s.tweens.add({ targets: this.rollGlow, alpha: { from: 0.15, to: 1 }, duration: 450, yoyo: true, repeat: -1, paused: true });
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
    this.turnHint.setText(state.over ? '' : human ? (this.rollWaiting ? '轮到你了：掷骰，或先升级、出符' : '可升级、出符，或结束回合') :'AI 正在行动…').setColor(human ? HEX.gold : HEX.dim);
    this.dock.setStrokeStyle(human && !state.over ? 4 : 2, human && !state.over ? PLAYER_COLORS[p.seat] : COLORS.gold);
  }

  /** The roll button breathes while it waits for a human to press it. */
  setRollWaiting(on: boolean): void {
    this.rollWaiting = on;
    if (this.lastTurn) this.setTurn(...this.lastTurn);
    if (on) this.rollPulse.resume();
    else {
      this.rollPulse.pause();
      this.rollGlow.setAlpha(0);
    }
  }

  showTile(id: NodeId | null, state: GameState): void {
    const g = this.game;
    if (this.hoverCard) return;
    this.setTab(TILE_TAB);
    this.prevCard.setVisible(false);
    const node = id ?? state.players[state.current].pos;
    const n = g.board.node(node);
    const tt = g.data.board.tileTypes[n.type];
    this.tileTab.label.setText(id ? '地块' : '脚下地块');
    this.prevTile.setVisible(n.type !== 'altar');
    this.prevObj.setVisible(n.type !== 'altar');
    if (n.type === 'land') {
      const t = state.tiles[node];
      const region = g.data.board.regions[n.region!];
      setFrame(this.prevTile, `tile_land_${n.region}`);
      setFrame(this.prevObj, t.level > 0 ? `bld_${t.level}` : `decor_${n.region}`);
      this.tileTitle.setText(n.name);
      this.tileSub.setText(`${region.name} · ${t.owner === null ? '无主灵田' : `${g.pn(t.owner)} 的${g.data.board.buildings[t.level].name}`}`).setColor(REGION_HEX[n.region!]);
      const lines = [`售价 ${n.price}${t.owner !== null ? `  当前租金 ${rentFor(state, g.board, g.data, node).amount}` : ''}`];
      for (let lv = 0; lv <= 4; lv++) {
        lines.push(`${t.level === lv && t.owner !== null ? '▶' : '  '}Lv${lv} ${g.data.board.buildings[lv].name}  租 ${nominalRent(g.data, n.price!, lv)}`);
      }
      this.tileBody.setText(lines.join('\n'));
      this.tileNote.setText(`${region.element} · ${region.ruleName}`);
    } else {
      if (n.type !== 'altar') {
        setFrame(this.prevTile, `tile_${n.type}`);
        setFrame(this.prevObj, `obj_${n.type}`);
      }
      this.tileTitle.setText(n.name);
      this.tileSub.setText(n.outer ? `外环 ${node}` : n.type === 'altar' ? '秘境中心' : `问道之路 ${node}`).setColor(HEX.dim);
      this.tileBody.setText(tt.desc);
      this.tileNote.setText('');
    }
  }

  /** While a hand card is hovered, the tile card shows that card instead. */
  private showCard(card: string): void {
    const g = this.game;
    const spell = g.spellById.get(card)!;
    const cat = g.data.spells.categories[spell.cat];
    this.hoverCard = card;
    this.setTab(CARD_TAB);
    this.prevTile.setVisible(false);
    this.prevObj.setVisible(false);
    setFrame(this.prevCard, `card_${spell.cat}`);
    this.prevCard.setVisible(true);
    this.tileTitle.setText(spell.name);
    this.tileSub.setText(`${cat.name} · ${spell.cost} 灵丹`).setColor(CAT_HEX[spell.cat]);
    this.tileBody.setText(`时机：${timingName(spell.timing)}\n${spell.desc}`);
    this.tileNote.setText('');
  }

  private setTab(t: { label: string; fill: number }): void {
    this.tileTab.label.setText(t.label);
    this.tileTab.ribbon.setFillStyle(t.fill);
  }

  renderHand(state: GameState, viewer: number | null): void {
    const g = this.game;
    this.handLayer.removeAll(true);
    const s = this.scene;
    const limit = g.data.config.handLimit;
    const p = viewer === null ? null : state.players[viewer];
    const shown = p ?? state.players[state.current];
    const n = shown.hand.length;
    const x = RIGHT.x;
    const top = RIGHT.handY + 18;
    const room = RIGHT.handH - 26;
    // shrink cards so the whole hand fits side by side in the panel
    const k = Math.min(1, (RIGHT.w - 20 - (n - 1) * CARD.gap) / (Math.max(1, n) * CARD.w), room / CARD.h);
    const cw = CARD.w * k;
    const ch = CARD.h * k;
    const step = cw + CARD.gap;
    const left = x + (RIGHT.w - (n * step - CARD.gap)) / 2;
    const by = top + (room - ch) / 2;
    this.handTab.setText(`符箓 ${n} / ${limit}`);
    if (!p) {
      this.handLayer.add(txt(s, x + RIGHT.w / 2, top + 10, `${shown.name} 的手牌（不可见）`, { size: 12, color: HEX.dim, origin: [0.5, 0.5] }));
      shown.hand.forEach((_, i) => {
        this.handLayer.add(s.add.rectangle(left + i * step, by + 16, cw, Math.min(90, ch) - 16, COLORS.panelLight).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline));
      });
      return;
    }
    p.hand.forEach((card, i) => {
      const spell = g.spellById.get(card)!;
      const bx = left + i * step;
      const can = this.castable.has(card);
      const c = s.add.container(bx, by);
      const img = addImg(s, 0, 0, `card_${spell.cat}`).setOrigin(0, 0).setScale(k);
      const cat = txt(s, 8 * k, 6 * k, g.data.spells.categories[spell.cat].name, { size: k < 1 ? 10 : 11, color: HEX.parchment, stroke: HEX.ink });
      const name = txt(s, 44 * k, 82 * k, spell.name, { size: k < 1 ? 12 : 13, color: HEX.ink, origin: [0.5, 0.5], bold: true });
      const cost = s.add.circle(76 * k, 11 * k, k < 1 ? 7 : 8, 0xe0663a).setStrokeStyle(2, COLORS.outline);
      const costT = txt(s, 76 * k, 11 * k, `${spell.cost}`, { size: 11, origin: [0.5, 0.5], bold: true });
      const glow = s.add.rectangle(-2, -2, cw + 4, ch + 4).setOrigin(0, 0).setStrokeStyle(2, can ? COLORS.gold : COLORS.outline);
      c.add([img, cat, name, cost, costT, glow]);
      if (!can) c.setAlpha(0.7);
      img.setInteractive({ useHandCursor: can });
      img.on('pointerover', () => {
        c.y = by - 6;
        this.handLayer.bringToTop(c);
        this.showCard(card);
      });
      img.on('pointerout', () => { c.y = by; this.hoverCard = null; this.showTile(null, g.state); });
      img.on('pointerdown', () => { if (this.castable.has(card)) this.cardClick?.(card); });
      this.handLayer.add(c);
    });
    if (n === 0) this.handLayer.add(txt(s, x + RIGHT.w / 2, top + room / 2, `${p.name} 暂无符箓`, { size: 12, color: PLAYER_HEX[p.seat], origin: [0.5, 0.5] }));
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
