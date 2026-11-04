// Board rendering: tiles, objects, buildings, owner bars/flags, tokens, demon, Baize.
import Phaser from 'phaser';
import { ALTAR, type Board } from '../core/board';
import type { GameState, HeroId, NodeId } from '../core/types';
import { addImg, setFrame } from './assets';
import { ALTAR_RECT, BOARD, cellXY } from './layout';
import { COLORS, PLAYER_COLORS } from './theme';

interface LandView {
  decor: Phaser.GameObjects.Image;
  bld: Phaser.GameObjects.Image;
  owner: Phaser.GameObjects.Image;
  flag: Phaser.GameObjects.Image;
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

  constructor(private scene: Phaser.Scene, private board: Board, heroes: HeroId[]) {
    const s = scene;
    s.add.rectangle(BOARD.x - 8, BOARD.y - 8, 9 * BOARD.cell + 16, 9 * BOARD.cell + 16, COLORS.panel)
      .setOrigin(0, 0).setStrokeStyle(3, COLORS.gold).setDepth(-1);
    addImg(s, BOARD.x + 64, BOARD.y + 64, 'centre_bg').setOrigin(0, 0).setDepth(0);
    for (const id of board.allNodeIds()) {
      const n = board.node(id);
      if (id === ALTAR) continue;
      const { x, y } = cellXY(n.pos[0], n.pos[1]);
      const tileFrame = n.type === 'land' ? `tile_land_${n.region}` : `tile_${n.type}`;
      addImg(s, x, y, tileFrame).setOrigin(0, 0).setDepth(1);
      if (n.type === 'land') {
        const decor = addImg(s, x + 32, y + 48, `decor_${n.region}`).setOrigin(0.5, 1).setDepth(y + 48);
        const bld = addImg(s, x + 32, y + 48, 'bld_1').setOrigin(0.5, 1).setDepth(y + 48).setVisible(false);
        const owner = addImg(s, x, y + 54, 'owner_p1').setOrigin(0, 0).setDepth(2).setVisible(false);
        const flag = addImg(s, x + 9, y + 24, 'flag_p1').setOrigin(0.5, 1).setDepth(y + 49).setVisible(false);
        this.lands.set(id, { decor, bld, owner, flag });
      } else {
        addImg(s, x + 32, y + 48, `obj_${n.type}`).setOrigin(0.5, 1).setDepth(y + 48);
      }
      this.addZone(id, x, y, 64, 64);
    }
    addImg(s, BOARD.x + 192, BOARD.y + 132, 'altar').setOrigin(0, 0).setDepth(ALTAR_RECT.y + 150);
    this.addZone(ALTAR, ALTAR_RECT.x, ALTAR_RECT.y, ALTAR_RECT.w, ALTAR_RECT.h);
    this.baize = addImg(s, ALTAR_RECT.x + 96, ALTAR_RECT.y + 40, 'baize').setOrigin(0.5, 1).setDepth(900).setVisible(false);
    this.demon = addImg(s, 0, 0, 'demon').setOrigin(0.5, 1).setVisible(false);
    this.currentMark = s.add.rectangle(0, 0, 64, 64).setOrigin(0, 0).setStrokeStyle(3, COLORS.gold).setDepth(3).setVisible(false);

    heroes.forEach((h, seat) => {
      const base = s.add.ellipse(0, -2, 22, 8, PLAYER_COLORS[seat]).setStrokeStyle(1, COLORS.outline);
      const tok = addImg(s, 0, 0, `tok_${h}`).setOrigin(0.5, 1);
      const c = s.add.container(0, 0, [base, tok]);
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
    return { x, y, w: 64, h: 64 };
  }

  /** Token anchor (bottom-centre) for a seat on a node; seats fan out so they don't overlap fully. */
  tokenXY(id: NodeId, seat: number): { x: number; y: number } {
    if (id === ALTAR) {
      const offs = [[-40, 0], [40, 0], [-40, 56], [40, 56]];
      return { x: ALTAR_RECT.x + 96 + offs[seat][0], y: ALTAR_RECT.y + 96 + offs[seat][1] };
    }
    const r = this.nodeRect(id);
    return { x: r.x + 32 + (seat - 1.5) * 10, y: r.y + 48 + (seat % 2) * 4 };
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
        this.scene.tweens.add({ targets: inner, y: -8, duration: ms / 2, yoyo: true, ease: 'Sine.easeOut' });
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
    this.currentMark.setStrokeStyle(3, PLAYER_COLORS[state.current]);
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
    }
    if (state.demon) {
      const r = this.nodeRect(state.demon.node);
      this.demon.setVisible(true).setPosition(r.x + 32, r.y + 46).setDepth(r.y + 46 + 50);
    } else this.demon.setVisible(false);
    this.markCurrent(state);
  }

  moveDemon(from: NodeId | undefined, to: NodeId, ms: number): Promise<void> {
    const r = this.nodeRect(to);
    if (!from || !this.demon.visible) {
      this.demon.setVisible(true).setPosition(r.x + 32, r.y + 46).setAlpha(0);
      return new Promise((res) => this.scene.tweens.add({ targets: this.demon, alpha: 1, duration: ms, onComplete: () => res() }));
    }
    return new Promise((res) => this.scene.tweens.add({
      targets: this.demon, x: r.x + 32, y: r.y + 46, duration: ms, ease: 'Sine.easeInOut',
      onComplete: () => { this.demon.setDepth(r.y + 96); res(); },
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
