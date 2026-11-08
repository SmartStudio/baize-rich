// Board rendering in the front-tilt view: the ground plane (Ground.ts), a block per node with its landmark,
// buildings by land level, ownership marks (OwnerMarks.ts), one-way chevrons, rect hit zones, walking tokens
// (Token.ts) that outline themselves behind tall art (Occluders.ts), ambient effects and the 白泽现世 light
// (Ambient.ts). Everything lives in world coordinates (WorldMap) and draws at 1×;
// GameScene's camera scrolls and zooms it at integer zoom. Draw order comes from world.DEPTH.
import Phaser from 'phaser';
import { ALTAR, type Board } from '../core/board';
import type { GameState, HeroId, NodeId } from '../core/types';
import { addAmbient, Manifest, STAND_DY } from './Ambient';
import { addImg, ensureCanvas, frameRef, setFrame } from './assets';
import { drawGround } from './Ground';
import type { Rect } from './layout';
import { Occluders } from './Occluders';
import { OwnerMarks } from './OwnerMarks';
import { COLORS, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import { Token, TOKEN_BOX } from './Token';
import { DEPTH, FACE, facingFor, seam, TD, tokenSpots, TW, WorldMap, type Facing, type Point } from './world';

/** Token feet on the altar: cells of its footprint (offsets from its back-left cell) beside the statue, by arrival. */
const ALTAR_SEATS: [number, number][] = [[0, 2], [2, 2], [0, 1], [2, 1]];
/** The altar statue's feet stand this far in front of the altar's top-face centre (ft_altar draws them at (96, 168)). */
const STATUE_DY = 16;
/** The statue ft_altar draws above its feet: the part of the altar that can hide a token on the row behind. */
const STATUE_SIZE = { w: 70, h: 112 };
/** Neighbours on a shared cell step aside or back this fast, at most. */
const MAKE_ROOM_MS = 140;
/**
 * A rising building's depth over its resting one: above its own cell's tokens (feet ≤ 9.5 px in front of it)
 * and below the next row's blocks (14 px in front).
 */
const GROW_LIFT = 10;

/** Face overlay textures: what is drawn on a top face and how. Light parts are white, tinted at use. */
type Overlay = 'mark' | 'focus';
/** Corner brackets on a cell the player can pick: arm length and stroke, in px. */
const BRACKET = { arm: 12, thick: 2 };

/** A rect ring `thick` px wide, `inset` px inside a w×h face; `open` leaves out the back edge. */
function ring(ctx: CanvasRenderingContext2D, w: number, h: number, inset: number, thick: number, open: boolean): void {
  if (!open) ctx.fillRect(inset, inset, w - 2 * inset, thick);
  ctx.fillRect(inset, h - inset - thick, w - 2 * inset, thick);
  ctx.fillRect(inset, inset, thick, h - 2 * inset);
  ctx.fillRect(w - inset - thick, inset, thick, h - 2 * inset);
}

/** Four ink-edged L brackets in a w×h face's corners, over a faint fill. */
function brackets(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const { arm, thick } = BRACKET;
  const paint = (colour: string, grow: number): void => {
    ctx.fillStyle = colour;
    const at = 1 - grow;
    for (const [bw, bh] of [[arm + 2 * grow, thick + 2 * grow], [thick + 2 * grow, arm + 2 * grow]]) {
      for (const [x, y] of [[at, at], [w - at - bw, at], [at, h - at - bh], [w - at - bw, h - at - bh]]) ctx.fillRect(x, y, bw, bh);
    }
  };
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.16;
  ctx.fillRect(1, 1, w - 2, h - 2);
  ctx.globalAlpha = 1;
  paint('#0f0e1a', 1);
  paint('#ffffff', 0);
}

/** The altar's statue stands on the back of its top face, so the altar's overlays leave that edge open. */
function overlayKey(scene: Phaser.Scene, kind: Overlay, r: Rect, open: boolean): string {
  const key = `face_${kind}_${r.w}x${r.h}${open ? '_open' : ''}`;
  ensureCanvas(scene, key, r.w, r.h, (ctx) => {
    if (kind === 'focus') return brackets(ctx, r.w, r.h);
    ctx.fillStyle = '#ffffff';
    ring(ctx, r.w, r.h, 0, 2, open);
    if (!open) {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(2, 2, r.w - 4, r.h - 4);
    }
  });
  return key;
}

/** A flat arrowhead on a top face, pointing along a grid axis, outlined in ink. */
function chevronKey(scene: Phaser.Scene, dir: Facing): string {
  const key = `chev_${dir}`;
  const across = dir === 'left' || dir === 'right';
  const [w, h] = across ? [6, 11] : [11, 6];
  ensureCanvas(scene, key, w, h, (ctx) => {
    const wedge = (i: number, from: number, to: number): void => {
      const tip = dir === 'right' || dir === 'down' ? i : 5 - i;
      if (across) ctx.fillRect(tip, from, 1, to - from + 1);
      else ctx.fillRect(from, tip, to - from + 1, 1);
    };
    ctx.fillStyle = '#0f0e1a';
    for (let i = 0; i < 6; i++) wedge(i, i, 10 - i);
    ctx.fillStyle = '#f4e9d0';
    for (let i = 1; i < 5; i++) wedge(i, i + 1, 9 - i);
  });
  return key;
}

export class BoardView {
  private buildings = new Map<NodeId, Phaser.GameObjects.Image>();
  /** Building level each land tile shows (0 = none). */
  private levels = new Map<NodeId, number>();
  private heldTiles = new Set<NodeId>();
  private state: GameState | null = null;
  private tokens: Token[] = [];
  /** Where labels are still rising, so a new one near them stacks above instead of on top. */
  private rising: { x: number; y: number }[] = [];
  private tokenNode: NodeId[] = [];
  private occluders: Occluders;
  private owners: OwnerMarks;
  private manifest: Manifest;
  private highlights: Phaser.GameObjects.Image[] = [];
  private hoverFn: ((n: NodeId | null) => void) | null = null;
  private clickFn: ((n: NodeId) => void) | null = null;
  private pressFn: ((n: NodeId) => void) | null = null;
  private currentMark: Phaser.GameObjects.Image;
  /** §12 镇山 mountain marker. */
  private rock: Phaser.GameObjects.Text;

  readonly world: WorldMap;

  constructor(private scene: Phaser.Scene, private board: Board, heroes: HeroId[]) {
    const s = scene;
    this.world = new WorldMap(board.data);
    drawGround(s, this.world, board.data);
    this.occluders = new Occluders(s, this.tokens);
    for (const id of board.allNodeIds()) {
      if (id === ALTAR) this.mountAltar();
      else this.mountNode(id);
      this.addZone(id);
    }
    this.drawChevrons();
    this.owners = new OwnerMarks(s, this.world, board);
    const c = this.world.centre(ALTAR);
    const statue = { x: c.x, y: c.y + STATUE_DY };
    this.manifest = new Manifest(s, statue);
    addAmbient(s, this.world, board, statue);
    this.rock = txt(s, 0, 0, '山', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 1] }).setDepth(DEPTH.top).setVisible(false);
    this.currentMark = s.add.image(0, 0, '__DEFAULT').setVisible(false);
    s.tweens.add({ targets: this.currentMark, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    heroes.forEach((h, seat) => {
      this.tokens.push(new Token(s, h, seat, PLAYER_COLORS[seat]));
      this.tokenNode.push(board.startId);
    });
  }

  /** A node's block, plus its landmark (special nodes) or its hidden building (land). */
  private mountNode(id: NodeId): void {
    const s = this.scene;
    const n = this.board.node(id);
    const r = this.world.rect(id);
    const f = this.world.footprint(id);
    addImg(s, r.x, r.y, n.region ? `ft_land_${n.region}` : 'ft_jade').setOrigin(0, 0).setDepth(DEPTH.block(f.r0));
    const feet = { x: r.x + r.w / 2, y: r.y + r.h / 2 + STAND_DY };
    const stand = (frame: string): Phaser.GameObjects.Image =>
      this.occluders.add(addImg(s, feet.x, feet.y, frame).setOrigin(0.5, 1).setDepth(DEPTH.stand(feet.y)));
    if (n.type !== 'land') {
      stand(`lm_${n.type}`);
      return;
    }
    this.buildings.set(id, stand('bld_1').setVisible(false));
  }

  /** The 3×3 altar frame: its bottom-left corner on the front face's bottom-left. Only its statue can cover a token. */
  private mountAltar(): void {
    const r = this.world.rect(ALTAR);
    const depth = DEPTH.block(this.world.footprint(ALTAR).r0);
    addImg(this.scene, r.x, r.y + r.h + FACE, 'ft_altar').setOrigin(0, 1).setDepth(depth);
    const c = this.world.centre(ALTAR);
    const { w, h } = STATUE_SIZE;
    this.occluders.add({ x: c.x, y: c.y + STATUE_DY, displayWidth: w, displayHeight: h, originX: 0.5, originY: 1, depth, visible: true });
  }

  /** One flat chevron on the seam between the two ends of every one-way road, pointing along it. */
  private drawChevrons(): void {
    for (const e of this.world.edges) {
      if (e.twoWay) continue;
      const dir = facingFor(this.world.centre(e.from), this.world.centre(e.to), 'down');
      const p = seam(this.world.rect(e.from), this.world.rect(e.to));
      const img = this.scene.add.image(0, 0, chevronKey(this.scene, dir));
      img.setPosition(Math.round(p.x - img.width / 2), Math.round(p.y - img.height / 2)).setOrigin(0, 0)
        .setDepth(DEPTH.face(Math.floor(p.y / TD)) + 0.05);
    }
  }

  /** Hover and click land on the node's hit rect. A click lands on release, so a camera drag never counts. */
  private addZone(id: NodeId): void {
    const r = this.world.hitRect(id);
    const z = this.scene.add.zone(r.x, r.y, r.w, r.h).setOrigin(0, 0).setInteractive({ useHandCursor: false });
    z.on('pointerover', () => this.hoverFn?.(id));
    z.on('pointerout', () => this.hoverFn?.(null));
    z.on('pointerdown', () => this.pressFn?.(id));
    z.on('pointerup', () => this.clickFn?.(id));
  }

  onHover(fn: (n: NodeId | null) => void): void { this.hoverFn = fn; }
  onPress(fn: (n: NodeId) => void): void { this.pressFn = fn; }
  /** Fires for every node on release. */
  onClick(fn: (n: NodeId) => void): void { this.clickFn = fn; }

  /** The node's top face, in world px. */
  nodeRect(id: NodeId): Rect {
    return this.world.rect(id);
  }

  /** The point the camera keeps on screen for a seat: its token's body, wherever it is mid-move. */
  tokenFocus(seat: number): Point {
    const t = this.tokens[seat];
    return { x: t.x, y: t.y - TOKEN_BOX.h / 2 };
  }

  /** World-space box around a seat's token, for keeping modals off it. */
  tokenRect(seat: number): Rect {
    return this.tokens[seat].box;
  }

  /** Seats standing on a node, in seat order. */
  private seatsOn(id: NodeId): number[] {
    return this.tokenNode.flatMap((n, seat) => (n === id ? [seat] : []));
  }

  /** A seat's feet on a node: its spot among the tokens sharing that cell, or a cell beside the statue on the altar. */
  private spot(seat: number, id: NodeId): Point {
    const here = this.seatsOn(id);
    const i = here.indexOf(seat);
    if (id === ALTAR) {
      const f = this.world.footprint(ALTAR);
      const [dc, dr] = ALTAR_SEATS[i];
      return { x: (f.c0 + dc) * TW + TW / 2, y: (f.r0 + dr) * TD + TD / 2 + tokenSpots(1)[0].y };
    }
    const c = this.world.centre(id);
    const o = tokenSpots(here.length)[i];
    return { x: c.x + o.x, y: c.y + o.y };
  }

  /** Re-seat the standing tokens on these nodes after someone arrived or left. */
  private makeRoom(ids: NodeId[], except: number, ms: number): void {
    for (const id of new Set(ids)) {
      for (const seat of this.seatsOn(id)) {
        if (seat === except || this.tokens[seat].moving) continue;
        if (ms > 0) void this.tokens[seat].glideTo(this.spot(seat, id), ms);
        else this.tokens[seat].place(this.spot(seat, id));
      }
    }
  }

  placeToken(seat: number, id: NodeId): void {
    const from = this.tokenNode[seat];
    this.tokenNode[seat] = id;
    this.tokens[seat].place(this.spot(seat, id));
    this.makeRoom([from, id], seat, 0);
  }

  /** One cell of travel. `walk` plays the walk cycle facing the step; slides and teleports glide and keep facing. */
  moveToken(seat: number, id: NodeId, ms: number, walk = true): Promise<void> {
    const from = this.tokenNode[seat];
    this.tokenNode[seat] = id;
    this.makeRoom([from, id], seat, Math.min(ms, MAKE_ROOM_MS));
    const to = this.spot(seat, id);
    return walk ? this.tokens[seat].walkTo(to, ms) : this.tokens[seat].glideTo(to, ms);
  }

  syncTokens(state: GameState): void {
    state.players.forEach((p, seat) => {
      if (this.tokenNode[seat] !== p.pos || !this.tokens[seat].moving) this.placeToken(seat, p.pos);
    });
  }

  markCurrent(state: GameState): void {
    const id = state.players[state.current].pos;
    this.paintOverlay(this.currentMark, id, 'mark', 0.1).setTint(PLAYER_COLORS[state.current]).setVisible(!state.over);
    this.tokens.forEach((t, seat) => t.setCurrent(seat === state.current && !state.over));
  }

  /** Put a face overlay image on a node's top face. */
  private paintOverlay(img: Phaser.GameObjects.Image, id: NodeId, kind: Overlay, above: number): Phaser.GameObjects.Image {
    const r = this.world.rect(id);
    return img.setTexture(overlayKey(this.scene, kind, r, id === ALTAR)).setOrigin(0, 0).setPosition(r.x, r.y)
      .setDepth(DEPTH.face(this.world.footprint(id).r0) + above);
  }

  /** A short gain / loss label that rises from a seat's token. */
  floatText(seat: number, text: string, color: string, delay = 0): void {
    const tok = this.tokens[seat];
    const spot = { x: tok.x, y: tok.y };
    const above = this.rising.filter((r) => Math.abs(r.x - spot.x) < TOKEN_BOX.w && Math.abs(r.y - spot.y) < TOKEN_BOX.h).length;
    this.rising.push(spot);
    const t = txt(this.scene, tok.x, tok.y - TOKEN_BOX.h - above * (FS.md + 4), text, { size: FS.md, bold: true, color, stroke: HEX.ink, origin: [0.5, 1] })
      .setDepth(DEPTH.top + 1).setAlpha(0);
    const done = (): void => {
      t.destroy();
      this.rising.splice(this.rising.indexOf(spot), 1);
    };
    this.scene.tweens.add({ targets: t, alpha: 1, duration: 120, delay });
    this.scene.tweens.add({ targets: t, y: t.y - 30, duration: 1100, delay, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, duration: 300, delay: delay + 900, onComplete: done });
  }

  /** Refresh ownership marks, buildings and markers from a (snapshot) state. Held tiles keep their building. */
  render(state: GameState): void {
    this.state = state;
    for (const id of this.buildings.keys()) if (!this.heldTiles.has(id)) this.paintBuilding(id, 0);
    this.owners.render(state, this.heldTiles);
    if (state.roadblock) {
      const p = this.world.centre(state.roadblock.node);
      this.rock.setVisible(true).setPosition(p.x, p.y - TD / 2).setColor(PLAYER_HEX[state.roadblock.seat]);
    } else this.rock.setVisible(false);
    this.markCurrent(state);
  }

  /** Keep a tile's building as it is through later renders (the stones paying for it are still in the air). */
  holdTile(id: NodeId): void {
    this.heldTiles.add(id);
  }

  /** Show a held tile's building as of the latest render; a higher level rises out of the ground over `ms`. */
  releaseTile(id: NodeId, ms: number): void {
    if (!this.heldTiles.delete(id) || !this.state) return;
    this.paintBuilding(id, ms);
    this.owners.plant(id, this.state, ms);
  }

  /** Where the stones paying for a tile land, as of the latest render: its building, or its pennant on bare land. */
  paidAt(id: NodeId): Point {
    const level = this.state?.tiles[id]?.level ?? 0;
    if (level === 0) return this.owners.flagAt(id);
    const r = this.world.rect(id);
    const h = this.scene.textures.getFrame(...frameRef(this.scene, `bld_${level}`)).height;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 + STAND_DY - Math.round(h / 2) };
  }

  private paintBuilding(id: NodeId, growMs: number): void {
    const bld = this.buildings.get(id);
    if (!bld || !this.state) return;
    const { owner, level } = this.state.tiles[id];
    const shown = owner === null ? 0 : level;
    const was = this.levels.get(id) ?? 0;
    this.levels.set(id, shown);
    bld.setVisible(shown > 0);
    if (shown === 0) return;
    const before = bld.height;
    setFrame(bld, `bld_${shown}`);
    if (shown > was && growMs > 0) this.grow(bld, was > 0 ? Math.min(before, bld.height) : 0, growMs);
  }

  /**
   * Reveal a building from the ground up, one whole pixel row at a time, from `rows` already standing. While it
   * rises it draws over the tokens on its own cell (below the next row), so the player sees it go up.
   */
  private grow(bld: Phaser.GameObjects.Image, rows: number, ms: number): void {
    const { width: w, height: h } = bld;
    const depth = DEPTH.stand(bld.y);
    const n = { rows };
    bld.setDepth(depth + GROW_LIFT).setCrop(0, h - rows, w, rows);
    this.scene.tweens.add({
      targets: n, rows: h, duration: ms, ease: 'Quad.easeOut',
      onUpdate: () => {
        const r = Math.round(n.rows);
        bld.setCrop(0, h - r, w, r);
      },
      onComplete: () => {
        bld.setCrop().setDepth(depth);
      },
    });
  }

  /** 白泽现世: the altar's own statue lights up. Idempotent. */
  showBaize(on: boolean): void {
    this.manifest.set(on);
  }

  setClickable(nodes: NodeId[]): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = nodes.map((id) => {
      const h = this.paintOverlay(this.scene.add.image(0, 0, '__DEFAULT'), id, 'focus', 0.2).setTint(COLORS.focus);
      this.scene.tweens.add({ targets: h, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      return h;
    });
  }
}
