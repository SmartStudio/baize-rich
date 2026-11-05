// Board rendering: tiles, objects, buildings, owner bars/flags, tokens, demon, Baize.
import Phaser from 'phaser';
import { ALTAR, type Board } from '../core/board';
import type { GameState, HeroId, NodeId } from '../core/types';
import { addImg, setFrame } from './assets';
import { ALTAR_RECT, BOARD, cellXY } from './layout';
import { COLORS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';

const S = BOARD.scale;
const C = BOARD.cell;
/** Board-local offsets are authored on the 64 px art grid; `u` maps them to screen pixels. */
const u = (v: number): number => v * S;

interface LandView {
  decor: Phaser.GameObjects.Image;
  bld: Phaser.GameObjects.Image;
  owner: Phaser.GameObjects.Image;
  flag: Phaser.GameObjects.Image;
  /** §17 禁制 marker, in the owner's seat colour. */
  trap: Phaser.GameObjects.Text;
}

export class BoardView {
  private lands = new Map<NodeId, LandView>();
  private tokens: Phaser.GameObjects.Container[] = [];
  private tokenNode: NodeId[] = [];
  private demon: Phaser.GameObjects.Image;
  private baize: Phaser.GameObjects.Image;
  private highlights: Phaser.GameObjects.Rectangle[] = [];
  private zones = new Map<NodeId, Phaser.GameObjects.Zone>();
  private hoverFn: ((n: NodeId | null) => void) | null = null;
  private clickFn: ((n: NodeId) => void) | null = null;
  private clickable = new Set<NodeId>();
  private currentMark: Phaser.GameObjects.Rectangle;
  /** §12 镇山 mountain marker. */
  private rock: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, private board: Board, heroes: HeroId[]) {
    const s = scene;
    s.add.rectangle(BOARD.x - 8, BOARD.y - 8, BOARD.size + 16, BOARD.size + 16, COLORS.panel)
      .setOrigin(0, 0).setStrokeStyle(3, COLORS.gold).setDepth(-1);
    addImg(s, BOARD.x + C, BOARD.y + C, 'centre_bg').setOrigin(0, 0).setDepth(0).setScale(S);
    for (const id of board.allNodeIds()) {
      const n = board.node(id);
      if (id === ALTAR) continue;
      const { x, y } = cellXY(n.pos[0], n.pos[1]);
      const tileFrame = n.type === 'land' ? `tile_land_${n.region}` : `tile_${n.type}`;
      addImg(s, x, y, tileFrame).setOrigin(0, 0).setDepth(1).setScale(S);
      if (n.type === 'land') {
        const decor = addImg(s, x + u(32), y + u(48), `decor_${n.region}`).setOrigin(0.5, 1).setDepth(y + u(48)).setScale(S);
        const bld = addImg(s, x + u(32), y + u(48), 'bld_1').setOrigin(0.5, 1).setDepth(y + u(48)).setVisible(false).setScale(S);
        const owner = addImg(s, x, y + u(54), 'owner_p1').setOrigin(0, 0).setDepth(2).setVisible(false).setScale(S);
        const flag = addImg(s, x + u(9), y + u(24), 'flag_p1').setOrigin(0.5, 1).setDepth(y + u(49)).setVisible(false).setScale(S);
        const trap = txt(s, x + C - u(4), y + u(4), '禁', { size: 13, bold: true, stroke: HEX.ink, origin: [1, 0] })
          .setDepth(2500).setVisible(false);
        this.lands.set(id, { decor, bld, owner, flag, trap });
      } else {
        addImg(s, x + u(32), y + u(48), `obj_${n.type}`).setOrigin(0.5, 1).setDepth(y + u(48)).setScale(S);
      }
      this.addZone(id, x, y, C, C);
    }
    addImg(s, ALTAR_RECT.x, BOARD.y + u(132), 'altar').setOrigin(0, 0).setDepth(ALTAR_RECT.y + u(150)).setScale(S);
    this.addZone(ALTAR, ALTAR_RECT.x, ALTAR_RECT.y, ALTAR_RECT.w, ALTAR_RECT.h);
    this.baize = addImg(s, ALTAR_RECT.x + u(96), ALTAR_RECT.y + u(40), 'baize').setOrigin(0.5, 1).setDepth(900).setVisible(false).setScale(S);
    this.demon = addImg(s, 0, 0, 'demon').setOrigin(0.5, 1).setVisible(false).setScale(S);
    this.rock = txt(s, 0, 0, '山', { size: 22, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] }).setDepth(2600).setVisible(false);
    this.currentMark = s.add.rectangle(0, 0, C, C, COLORS.gold, 0.16).setOrigin(0, 0).setStrokeStyle(4, COLORS.gold).setDepth(3).setVisible(false);
    s.tweens.add({ targets: this.currentMark, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    heroes.forEach((h, seat) => {
      const base = s.add.ellipse(0, -2, 22, 8, PLAYER_COLORS[seat]).setStrokeStyle(1, COLORS.outline);
      const tok = addImg(s, 0, 0, `tok_${h}`).setOrigin(0.5, 1);
      const c = s.add.container(0, 0, [base, tok]).setScale(S);
      this.tokens.push(c);
      this.tokenNode.push(board.startId);
    });
  }

  private addZone(id: NodeId, x: number, y: number, w: number, h: number): void {
    const z = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: false });
    z.on('pointerover', () => this.hoverFn?.(id));
    z.on('pointerout', () => this.hoverFn?.(null));
    z.on('pointerdown', () => { if (this.clickable.has(id)) this.clickFn?.(id); });
    this.zones.set(id, z);
  }

  onHover(fn: (n: NodeId | null) => void): void { this.hoverFn = fn; }
  onClick(fn: (n: NodeId) => void): void { this.clickFn = fn; }

  nodeRect(id: NodeId): { x: number; y: number; w: number; h: number } {
    if (id === ALTAR) return { ...ALTAR_RECT };
    const n = this.board.node(id);
    const { x, y } = cellXY(n.pos[0], n.pos[1]);
    return { x, y, w: C, h: C };
  }

  /** Token anchor (bottom-centre) for a seat on a node; seats fan out so they don't overlap fully. */
  tokenXY(id: NodeId, seat: number): { x: number; y: number } {
    if (id === ALTAR) {
      const offs = [[-40, 0], [40, 0], [-40, 56], [40, 56]];
      return { x: ALTAR_RECT.x + u(96 + offs[seat][0]), y: ALTAR_RECT.y + u(96 + offs[seat][1]) };
    }
    const r = this.nodeRect(id);
    return { x: r.x + u(32 + (seat - 1.5) * 10), y: r.y + u(48 + (seat % 2) * 4) };
  }

  placeToken(seat: number, id: NodeId): void {
    const { x, y } = this.tokenXY(id, seat);
    this.tokens[seat].setPosition(x, y).setDepth(y + 100 + seat);
    this.tokenNode[seat] = id;
  }

  moveToken(seat: number, id: NodeId, ms: number, hop = true): Promise<void> {
    const { x, y } = this.tokenXY(id, seat);
    this.tokenNode[seat] = id;
    const tok = this.tokens[seat];
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: tok, x, y, duration: ms, ease: hop ? 'Quad.easeOut' : 'Linear',
        onUpdate: () => tok.setDepth(tok.y + 100 + seat),
        onComplete: () => resolve(),
      });
      if (hop) {
        const inner = tok.list[1] as Phaser.GameObjects.Image;
        this.scene.tweens.add({ targets: inner, y: -10, duration: ms / 2, yoyo: true, ease: 'Sine.easeOut' });
      }
    });
  }

  syncTokens(state: GameState): void {
    state.players.forEach((p, seat) => {
      if (this.tokenNode[seat] !== p.pos || !this.scene.tweens.isTweening(this.tokens[seat])) this.placeToken(seat, p.pos);
    });
  }

  markCurrent(state: GameState): void {
    const r = this.nodeRect(state.players[state.current].pos);
    this.currentMark.setPosition(r.x, r.y).setSize(r.w, r.h).setVisible(!state.over);
    this.currentMark.setStrokeStyle(4, PLAYER_COLORS[state.current]).setFillStyle(PLAYER_COLORS[state.current], 0.16);
    this.tokens.forEach((t, seat) => t.setScale(seat === state.current && !state.over ? S * 1.25 : S));
  }

  /** A short gain / loss label that rises from a seat's token. */
  floatText(seat: number, text: string, color: string, delay = 0): void {
    const tok = this.tokens[seat];
    const t = txt(this.scene, tok.x, tok.y - u(52), text, { size: 15, bold: true, color, stroke: HEX.ink, origin: [0.5, 1] })
      .setDepth(8000).setAlpha(0);
    this.scene.tweens.add({ targets: t, alpha: 1, duration: 120, delay });
    this.scene.tweens.add({ targets: t, y: t.y - 30, duration: 1100, delay, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, duration: 300, delay: delay + 900, onComplete: () => t.destroy() });
  }

  /** Refresh ownership / buildings / demon from a (snapshot) state. */
  render(state: GameState): void {
    for (const [id, v] of this.lands) {
      const t = state.tiles[id];
      const owned = t.owner !== null;
      v.owner.setVisible(owned);
      v.flag.setVisible(owned);
      if (owned) {
        setFrame(v.owner, `owner_p${t.owner! + 1}`);
        setFrame(v.flag, `flag_p${t.owner! + 1}`);
      }
      v.decor.setVisible(t.level === 0);
      v.bld.setVisible(t.level > 0);
      if (t.level > 0) setFrame(v.bld, `bld_${t.level}`);
      v.trap.setVisible(t.trap && owned);
      if (t.trap && owned) v.trap.setColor(PLAYER_HEX[t.owner!]);
    }
    if (state.roadblock) {
      const r = this.nodeRect(state.roadblock.node);
      this.rock.setVisible(true).setPosition(r.x + r.w / 2, r.y + u(20)).setColor(PLAYER_HEX[state.roadblock.seat]);
    } else this.rock.setVisible(false);
    if (state.demon) {
      const r = this.nodeRect(state.demon.node);
      this.demon.setVisible(true).setPosition(r.x + u(32), r.y + u(46)).setDepth(r.y + u(46) + 50);
    } else this.demon.setVisible(false);
    this.markCurrent(state);
  }

  moveDemon(from: NodeId | undefined, to: NodeId, ms: number): Promise<void> {
    const r = this.nodeRect(to);
    if (!from || !this.demon.visible) {
      this.demon.setVisible(true).setPosition(r.x + u(32), r.y + u(46)).setAlpha(0);
      return new Promise((res) => this.scene.tweens.add({ targets: this.demon, alpha: 1, duration: ms, onComplete: () => res() }));
    }
    return new Promise((res) => this.scene.tweens.add({
      targets: this.demon, x: r.x + u(32), y: r.y + u(46), duration: ms, ease: 'Sine.easeInOut',
      onComplete: () => { this.demon.setDepth(r.y + u(46) + 50); res(); },
    }));
  }

  showBaize(on: boolean): void {
    if (on && !this.baize.visible) {
      this.baize.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: this.baize, alpha: 1, y: this.baize.y - 6, duration: 600, yoyo: false });
    } else if (!on) this.baize.setVisible(false);
  }

  setClickable(nodes: NodeId[]): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = [];
    this.clickable = new Set(nodes);
    for (const id of nodes) {
      const r = this.nodeRect(id);
      const h = this.scene.add.rectangle(r.x + 2, r.y + 2, r.w - 4, r.h - 4, COLORS.gold, 0.18)
        .setOrigin(0, 0).setStrokeStyle(2, COLORS.gold).setDepth(2000);
      this.scene.tweens.add({ targets: h, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      this.highlights.push(h);
    }
  }
}
