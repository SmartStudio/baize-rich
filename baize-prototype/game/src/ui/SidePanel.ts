// Right column: current tile info, hand, 战报 log, action buttons, dice button.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import { nominalRent, rentFor } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import { addImg, setFrame } from './assets';
import { RIGHT } from './layout';
import { COLORS, HEX, PLAYER_HEX, panel, tab, txt, type Tab } from './theme';
import { Button } from './widgets';

const REGION_HEX: Record<string, string> = { wood: '#6FCF7F', fire: '#E0663A', water: '#5FB7E0', earth: '#B48BE0' };
const CAT_HEX: Record<string, string> = { attack: HEX.bad, guard: '#5FB7E0', move: HEX.good, wealth: HEX.gold };
const TILE_TAB = { label: '当前地块', fill: 0x3f8a4f };
const CARD_TAB = { label: '符箓', fill: 0x6a55c8 };
const CARD = { w: 88, h: 120, gap: 6 };
/** 战报 panel; text rows live between `textY` and `textBottom`. */
const LOG = { y: 430, h: 106, textY: 444, textBottom: 532, maxLines: 200, wheelPx: 34 };

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
  private logText: Phaser.GameObjects.Text;
  /** Each logged line, pre-wrapped into display rows. */
  private logEntries: string[][] = [];
  /** Rows scrolled up from the newest line; 0 = stuck to the bottom. */
  private logScroll = 0;
  private logRows: number;
  private logWheel = 0;
  private logThumb: Phaser.GameObjects.Rectangle;
  private dice: Phaser.GameObjects.Image[];
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
    // --- tile info (y 80–252)
    panel(s, x, 80, RIGHT.w, 172);
    this.tileTab = tab(s, x + RIGHT.w / 2, 80, TILE_TAB.label, TILE_TAB.fill);
    s.add.rectangle(x + 10, 98, 68, 68, COLORS.outline).setOrigin(0, 0);
    this.prevTile = addImg(s, x + 12, 100, 'tile_gate').setOrigin(0, 0);
    this.prevObj = addImg(s, x + 44, 148, 'obj_gate').setOrigin(0.5, 1);
    this.prevCard = addImg(s, x + 44, 132, 'card_attack').setScale(0.5).setVisible(false);
    this.tileTitle = txt(s, x + 90, 96, '', { size: 18, bold: true });
    this.tileSub = txt(s, x + 90, 122, '', { size: 12, color: HEX.good });
    this.tileBody = txt(s, x + 90, 140, '', { size: 12, wrap: RIGHT.w - 100, lineSpacing: 2 });
    this.tileNote = txt(s, x + 10, 172, '', { size: 11, color: HEX.dim, wrap: 74 });
    // --- hand (y 266–416)
    panel(s, x, 266, RIGHT.w, 150);
    this.handTab = tab(s, x + RIGHT.w / 2, 266, '符箓', CARD_TAB.fill).label;
    this.handLayer = s.add.container(0, 0);
    // --- log (y 430–536)
    panel(s, x, LOG.y, RIGHT.w, LOG.h);
    tab(s, x + RIGHT.w / 2, LOG.y, '战报', 0xb03a40);
    this.logText = txt(s, x + 10, LOG.textY, 'x', { size: 12, wrap: RIGHT.w - 26, lineSpacing: 3 });
    const oneRow = this.logText.height;
    const rowH = this.logText.setText('x\nx').height - oneRow;
    this.logRows = 1 + Math.floor((LOG.textBottom - LOG.textY - oneRow) / rowH);
    this.logText.setText('');
    s.add.rectangle(x + RIGHT.w - 10, LOG.textY, 6, LOG.textBottom - LOG.textY, COLORS.outline).setOrigin(0, 0);
    this.logThumb = s.add.rectangle(x + RIGHT.w - 9, LOG.textY, 4, 10, COLORS.dim).setOrigin(0, 0).setVisible(false);
    s.input.on('wheel', (ptr: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (ptr.x < x || ptr.x > x + RIGHT.w || ptr.y < LOG.y || ptr.y > LOG.y + LOG.h) return;
      this.logWheel += dy;
      const rows = Math.trunc(this.logWheel / LOG.wheelPx);
      if (rows === 0) return;
      this.logWheel -= rows * LOG.wheelPx;
      this.logScroll -= rows;
      this.renderLog();
    });
    // --- buttons (y 546)
    const bw = (RIGHT.w - 16) / 3;
    this.btnUpgrade = new Button(s, x, 546, { w: bw, h: 34, label: '升级' });
    this.btnCast = new Button(s, x + (bw + 8), 546, { w: bw, h: 34, label: '出符' });
    this.btnEnd = new Button(s, x + 2 * (bw + 8), 546, { w: bw, h: 34, label: '结束', fill: 0xc03a40 });
    // --- dice + roll (y 590–712)
    panel(s, x, 590, RIGHT.w, 122, COLORS.panel, COLORS.gold);
    this.dice = [addImg(s, x + 36, 650, 'die_1'), addImg(s, x + 72, 660, 'die_6')];
    this.btnRoll = new Button(s, x + 104, 604, { w: RIGHT.w - 118, h: 94, label: '掷骰子', size: 26, fill: COLORS.gold, textColor: HEX.ink });
  }

  onCardClick(fn: (card: string) => void): void {
    this.cardClick = fn;
  }

  setCastable(cards: string[]): void {
    this.castable = new Set(cards);
  }

  showTile(id: NodeId | null, state: GameState): void {
    const g = this.game;
    if (this.hoverCard) return;
    this.setTab(TILE_TAB);
    this.prevCard.setVisible(false);
    const node = id ?? state.players[state.current].pos;
    const n = g.board.node(node);
    const tt = g.data.board.tileTypes[n.type];
    this.prevTile.setVisible(n.type !== 'altar');
    this.prevObj.setVisible(n.type !== 'altar');
    if (n.type === 'land') {
      const t = state.tiles[node];
      const region = g.data.board.regions[n.region!];
      setFrame(this.prevTile, `tile_land_${n.region}`);
      setFrame(this.prevObj, t.level > 0 ? `bld_${t.level}` : `decor_${n.region}`);
      this.tileTitle.setText(n.name);
      this.tileSub.setText(`${region.name} · ${t.owner === null ? '无主灵田' : `${g.pn(t.owner)} 的${g.data.board.buildings[t.level].name}`}`).setColor(REGION_HEX[n.region!]);
      const lines = [`售价 ${n.price}${t.owner !== null ? `   当前租金 ${rentFor(state, g.board, g.data, node).amount}` : ''}`];
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
      this.tileSub.setText(n.ringIndex >= 0 ? `外环 ${node}` : n.type === 'altar' ? '秘境中心' : `问道之路 ${node}`).setColor(HEX.dim);
      this.tileBody.setText(tt.desc);
      this.tileNote.setText('');
    }
  }

  /** While a hand card is hovered, the info panel shows that card instead of the tile. */
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
    // shrink cards so the whole hand fits side by side in the panel
    const k = Math.min(1, (RIGHT.w - 20 - (n - 1) * CARD.gap) / (Math.max(1, n) * CARD.w));
    const cw = CARD.w * k;
    const ch = CARD.h * k;
    const step = cw + CARD.gap;
    const by = 346 - ch / 2;
    this.handTab.setText(`符箓 ${n} / ${limit}`);
    if (!p) {
      this.handLayer.add(txt(s, RIGHT.x + RIGHT.w / 2, 300, `${shown.name} 的手牌（不可见）`, { size: 12, color: HEX.dim, origin: [0.5, 0.5] }));
      shown.hand.forEach((_, i) => {
        const bx = RIGHT.x + 10 + i * step;
        this.handLayer.add(s.add.rectangle(bx, 318, cw, Math.min(90, ch), COLORS.panelLight).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline));
      });
      return;
    }
    p.hand.forEach((card, i) => {
      const spell = g.spellById.get(card)!;
      const bx = RIGHT.x + 10 + i * step;
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
    if (n === 0) this.handLayer.add(txt(s, RIGHT.x + RIGHT.w / 2, 340, `${p.name} 暂无符箓`, { size: 12, color: PLAYER_HEX[p.seat], origin: [0.5, 0.5] }));
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

  log(line: string): void {
    const rows = this.logText.getWrappedText(line);
    this.logEntries.push(rows);
    if (this.logEntries.length > LOG.maxLines) this.logEntries.shift();
    // reading older lines: keep the same rows in view while new ones arrive
    if (this.logScroll > 0) this.logScroll += rows.length;
    this.renderLog();
  }

  private renderLog(): void {
    const all = this.logEntries.flat();
    const maxScroll = Math.max(0, all.length - this.logRows);
    this.logScroll = Phaser.Math.Clamp(this.logScroll, 0, maxScroll);
    const end = all.length - this.logScroll;
    this.logText.setText(all.slice(Math.max(0, end - this.logRows), end).join('\n'));
    this.logThumb.setVisible(maxScroll > 0);
    if (maxScroll > 0) {
      const track = LOG.textBottom - LOG.textY;
      const h = Math.max(8, (track * this.logRows) / all.length);
      this.logThumb.setSize(4, h).setY(LOG.textY + (track - h) * (1 - this.logScroll / maxScroll));
    }
  }
}

function timingName(t: string): string {
  return ({ action: '行动阶段', reaction: '被攻击 / 被收购时', rent: '付租时', start: '回合开始', preroll: '掷骰前' } as Record<string, string>)[t] ?? t;
}
