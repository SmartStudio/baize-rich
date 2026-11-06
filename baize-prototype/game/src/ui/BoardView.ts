// Board rendering: ground and roads (Ground.ts), tiles, objects, buildings, ownership wash/rims/flags,
// tokens, and the 白泽现世 light on the altar. Everything here lives in world coordinates (WorldMap);
// GameScene's camera scrolls and zooms it. Sprite scales come from SPRITE.
import Phaser from 'phaser';
import { ALTAR, type Board } from '../core/board';
import type { GameState, HeroId, NodeId } from '../core/types';
import { addImg, setFrame } from './assets';
import { drawWorld, tileRect } from './Ground';
import { SPRITE, type Rect } from './layout';
import { COLORS, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import { rectCentre, WorldMap, type Point } from './world';

/** Tile-local offsets are authored on the 64 px art grid; `u` maps them to world pixels. */
const u = (v: number): number => v * SPRITE.ground;
/** Depth for overlays that sit above every y-sorted sprite on any board size. */
const TOP = 100000;
/** Altar sprite: its statue's centre sits this far above the sprite centre (native px). */
const STATUE_DY = -6;
/** Token feet around the altar statue, relative to the footprint centre. */
const ALTAR_SEATS = [[-62, -8], [62, -8], [-62, 58], [62, 58]];
/**
 * Ownership wash and rim sit above the tile sprite (depth 1) and under props
 * (depth = foot y) and the current-player mark (depth 3).
 */
const OWN_DEPTH = 2;
/** Rim draws after the wash. Both stay under the current-player mark at depth 3. */
const RIM_DEPTH = 2.5;
/** Faint owner wash. Strong enough to read zoomed out, light enough to leave the tile art. */
const OWN_WASH = 0.16;
/** Plain ownership rim, in world px. */
const OWN_BORDER = 3;

interface LandView {
  decor: Phaser.GameObjects.Image;
  bld: Phaser.GameObjects.Image;
  flag: Phaser.GameObjects.Image;
  /** Tile size in world px. The rim is drawn in this box. */
  w: number;
  h: number;
  /** Owner-colour fill under decor and buildings. Hidden while the land is unowned. */
  wash: Phaser.GameObjects.Rectangle;
  /** Owner rim. */
  rim: Phaser.GameObjects.Graphics;
}

/** A crisp rectangular frame. Four filled bars, so the thickness stays an integer pixel band. */
function fillFrame(g: Phaser.GameObjects.Graphics, w: number, h: number, inset: number, thick: number): void {
  g.fillRect(inset, inset, w - inset * 2, thick);
  g.fillRect(inset, h - inset - thick, w - inset * 2, thick);
  g.fillRect(inset, inset + thick, thick, h - 2 * inset - 2 * thick);
  g.fillRect(w - inset - thick, inset + thick, thick, h - 2 * inset - 2 * thick);
}

export class BoardView {
  private lands = new Map<NodeId, LandView>();
  private tokens: Phaser.GameObjects.Container[] = [];
  /** The hero figure inside each token container (the part that hops). */
  private figures: Phaser.GameObjects.Image[] = [];
  private tokenNode: NodeId[] = [];
  private manifest: Manifest;
  private highlights: Phaser.GameObjects.Rectangle[] = [];
  private hoverFn: ((n: NodeId | null) => void) | null = null;
  private clickFn: ((n: NodeId) => void) | null = null;
  private pressFn: ((n: NodeId) => void) | null = null;
  private clickable = new Set<NodeId>();
  private currentMark: Phaser.GameObjects.Rectangle;
  /** §12 镇山 mountain marker. */
  private rock: Phaser.GameObjects.Text;

  readonly world: WorldMap;

  constructor(private scene: Phaser.Scene, board: Board, heroes: HeroId[]) {
    const s = scene;
    this.world = new WorldMap(board.data);
    drawWorld(s, this.world, board.data);
    for (const id of board.allNodeIds()) {
      const n = board.node(id);
      if (id === ALTAR) continue;
      const { x, y, w, h } = tileRect(this.world, id);
      const tileFrame = n.type === 'land' ? `tile_land_${n.region}` : `tile_${n.type}`;
      addImg(s, x, y, tileFrame).setOrigin(0, 0).setDepth(1).setScale(SPRITE.ground);
      const foot = y + u(48);
      if (n.type === 'land') this.mountLand(id, n.region, x, y, w, h, foot);
      else {
        addImg(s, x + w / 2, foot, `obj_${n.type}`).setOrigin(0.5, 1).setDepth(foot).setScale(SPRITE.prop);
      }
      const cell = this.world.cellRect(id);
      this.addZone(id, cell.x, cell.y, cell.w, cell.h);
    }
    const altar = this.world.cellRect(ALTAR);
    const { x: ax, y: ay } = rectCentre(altar);
    addImg(s, ax, ay, 'altar').setOrigin(0.5, 0.5).setDepth(altar.y + altar.h).setScale(SPRITE.altar);
    this.addZone(ALTAR, altar.x, altar.y, altar.w, altar.h);
    this.manifest = new Manifest(s, ax, ay + STATUE_DY * SPRITE.altar, altar.y + altar.h + 1);
    this.rock = txt(s, 0, 0, '山', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] }).setDepth(TOP + 600).setVisible(false);
    this.currentMark = s.add.rectangle(0, 0, 10, 10, COLORS.gold, 0.16).setOrigin(0, 0).setStrokeStyle(4, COLORS.gold).setDepth(3).setVisible(false);
    s.tweens.add({ targets: this.currentMark, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    heroes.forEach((h, seat) => {
      const base = s.add.ellipse(0, -2, 22, 8, PLAYER_COLORS[seat]).setStrokeStyle(1, COLORS.outline);
      const tok = addImg(s, 0, 0, `tok_${h}`).setOrigin(0.5, 1);
      const c = s.add.container(0, 0, [base, tok]).setScale(SPRITE.token);
      this.tokens.push(c);
      this.figures.push(tok);
      this.tokenNode.push(board.startId);
    });
  }

  /** A tile's click lands on release, so a press that turns into a camera drag never counts as a click. */
  private addZone(id: NodeId, x: number, y: number, w: number, h: number): void {
    const z = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: false });
    z.on('pointerover', () => this.hoverFn?.(id));
    z.on('pointerout', () => this.hoverFn?.(null));
    z.on('pointerdown', () => this.pressFn?.(id));
    z.on('pointerup', () => this.clickFn?.(id));
  }

  onHover(fn: (n: NodeId | null) => void): void { this.hoverFn = fn; }
  onPress(fn: (n: NodeId) => void): void { this.pressFn = fn; }
  /** Fires for every node on release; `isClickable` says whether it is a current choice target. */
  onClick(fn: (n: NodeId) => void): void { this.clickFn = fn; }
  isClickable(id: NodeId): boolean { return this.clickable.has(id); }

  /** The drawn tile in world px: the whole footprint for the altar, the cell minus its road gap otherwise. */
  nodeRect(id: NodeId): Rect {
    return id === ALTAR ? this.world.cellRect(ALTAR) : tileRect(this.world, id);
  }

  /** The point the camera keeps on screen for a seat: its token's body, wherever it is mid-move. */
  tokenFocus(seat: number): Point {
    const t = this.tokens[seat];
    return { x: t.x, y: t.y - 24 };
  }

  /** World-space box around a seat's token, for keeping modals off it. */
  tokenRect(seat: number): Rect {
    const t = this.tokens[seat];
    const w = 32 * t.scaleX;
    const h = 48 * t.scaleY;
    return { x: t.x - w / 2, y: t.y - h, w, h };
  }

  /** Token anchor (bottom-centre) for a seat on a node; seats fan out so they don't overlap fully. */
  tokenXY(id: NodeId, seat: number): { x: number; y: number } {
    if (id === ALTAR) {
      const [dx, dy] = ALTAR_SEATS[seat];
      const c = this.world.centre(ALTAR);
      return { x: c.x + dx, y: c.y + dy };
    }
    const r = this.nodeRect(id);
    return { x: r.x + u(32 + (seat - 1.5) * 10), y: r.y + u(48 + (seat % 2) * 4) };
  }

  placeToken(seat: number, id: NodeId): void {
    const { x, y } = this.tokenXY(id, seat);
    this.tokens[seat].setPosition(x, y).setDepth(y + 100 + seat);
    this.tokenNode[seat] = id;
  }

  /** One cell of travel. `hop` lifts the figure in an arc; slides and teleports glide flat. */
  moveToken(seat: number, id: NodeId, ms: number, hop = true): Promise<void> {
    const { x, y } = this.tokenXY(id, seat);
    this.tokenNode[seat] = id;
    const tok = this.tokens[seat];
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: tok, x, y, duration: ms, ease: hop ? 'Sine.easeInOut' : 'Linear',
        onUpdate: () => tok.setDepth(tok.y + 100 + seat),
        onComplete: () => resolve(),
      });
      if (hop) this.scene.tweens.add({ targets: this.figures[seat], y: -SPRITE.hop, duration: ms / 2, yoyo: true, ease: 'Quad.easeOut' });
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
  }

  /** A short gain / loss label that rises from a seat's token. */
  floatText(seat: number, text: string, color: string, delay = 0): void {
    const tok = this.tokens[seat];
    const t = txt(this.scene, tok.x, tok.y - 48 * tok.scaleY, text, { size: FS.md, bold: true, color, stroke: HEX.ink, origin: [0.5, 1] })
      .setDepth(TOP + 8000).setAlpha(0);
    this.scene.tweens.add({ targets: t, alpha: 1, duration: 120, delay });
    this.scene.tweens.add({ targets: t, y: t.y - 30, duration: 1100, delay, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, duration: 300, delay: delay + 900, onComplete: () => t.destroy() });
  }

  private mountLand(id: NodeId, region: string | undefined, x: number, y: number, w: number, h: number, foot: number): void {
    const s = this.scene;
    const decor = addImg(s, x + w / 2, foot, `decor_${region}`).setOrigin(0.5, 1).setDepth(foot).setScale(SPRITE.prop);
    const bld = addImg(s, x + w / 2, foot, 'bld_1').setOrigin(0.5, 1).setDepth(foot).setVisible(false).setScale(SPRITE.prop);
    const flag = addImg(s, x + u(9), y + u(24), 'flag_p1').setOrigin(0.5, 1).setDepth(foot + 1).setVisible(false).setScale(SPRITE.prop);
    const wash = s.add.rectangle(x, y, w, h, PLAYER_COLORS[0], OWN_WASH).setOrigin(0, 0).setDepth(OWN_DEPTH).setVisible(false);
    const rim = s.add.graphics().setPosition(x, y).setDepth(RIM_DEPTH).setVisible(false);
    this.lands.set(id, { decor, bld, flag, w, h, wash, rim });
  }

  /** Owner wash, rim, and flag. */
  private showOwnership(v: LandView, owner: number | null): void {
    const owned = owner !== null;
    v.flag.setVisible(owned);
    v.wash.setVisible(owned);
    v.rim.setVisible(owned);
    if (owner === null) {
      v.rim.setAlpha(1);
      return;
    }
    const color = PLAYER_COLORS[owner];
    setFrame(v.flag, `flag_p${owner + 1}`);
    v.wash.setFillStyle(color, OWN_WASH);
    const g = v.rim;
    g.clear();
    g.fillStyle(color, 1);
    fillFrame(g, v.w, v.h, 0, OWN_BORDER);
  }

  /** Refresh ownership / buildings / markers from a (snapshot) state. */
  render(state: GameState): void {
    for (const [id, v] of this.lands) {
      const t = state.tiles[id];
      const owner = t.owner;
      this.showOwnership(v, owner);
      const bld = t.level > 0 ? `bld_${t.level}` : null;
      v.decor.setVisible(bld === null);
      v.bld.setVisible(bld !== null);
      if (bld) setFrame(v.bld, bld);
    }
    if (state.roadblock) {
      const r = this.nodeRect(state.roadblock.node);
      this.rock.setVisible(true).setPosition(r.x + r.w / 2, r.y + u(20)).setColor(PLAYER_HEX[state.roadblock.seat]);
    } else this.rock.setVisible(false);
    this.markCurrent(state);
  }

  /** 白泽现世: the altar's own statue lights up. Idempotent. */
  showBaize(on: boolean): void {
    this.manifest.set(on);
  }

  setClickable(nodes: NodeId[]): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = [];
    this.clickable = new Set(nodes);
    for (const id of nodes) {
      const r = this.nodeRect(id);
      const h = this.scene.add.rectangle(r.x + 2, r.y + 2, r.w - 4, r.h - 4, COLORS.gold, 0.18)
        .setOrigin(0, 0).setStrokeStyle(2, COLORS.gold).setDepth(TOP);
      this.scene.tweens.add({ targets: h, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      this.highlights.push(h);
    }
  }
}

const GOLD_LIGHT = 0xffe7a0;

/**
 * The manifest effect on the altar statue: a pillar of light rising from it, a glow on the statue,
 * halo rings pulsing out from its feet, and sparks drifting up. The beast itself is the altar art.
 */
class Manifest {
  private layer: Phaser.GameObjects.Container;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private loops: Phaser.Tweens.Tween[] = [];
  private on = false;

  constructor(private scene: Phaser.Scene, x: number, y: number, depth: number) {
    const s = scene;
    ensureFxTextures(s);
    const feet = 46;
    const beam = s.add.image(0, feet, 'fx_beam').setOrigin(0.5, 1).setScale(1.6, 1.5).setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const glow = s.add.image(0, 0, 'fx_glow').setScale(1.4).setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const halos = [0, 1].map(() => s.add.ellipse(0, feet, 128, 44).setStrokeStyle(3, COLORS.gold).setFillStyle());
    this.layer = s.add.container(x, y, [beam, ...halos, glow]).setDepth(depth).setVisible(false);
    this.sparks = s.add.particles(x, y + feet, 'fx_spark', {
      speedY: { min: -70, max: -30 }, speedX: { min: -12, max: 12 }, lifespan: 1800,
      scale: { start: 1, end: 0.2 }, alpha: { start: 1, end: 0 }, frequency: 90,
      tint: [GOLD_LIGHT, 0xffffff], blendMode: 'ADD',
      emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 120, 40), quantity: 1 },
      emitting: false,
    }).setDepth(depth + 1);
    this.layer.setData('parts', { beam, glow, halos });
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const s = this.scene;
    for (const t of this.loops) t.remove();
    this.loops = [];
    if (!on) {
      this.layer.setVisible(false);
      this.sparks.stop();
      return;
    }
    const { beam, glow, halos } = this.layer.getData('parts') as { beam: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; halos: Phaser.GameObjects.Ellipse[] };
    this.layer.setVisible(true).setAlpha(0);
    this.sparks.start();
    this.loops.push(
      s.tweens.add({ targets: this.layer, alpha: 1, duration: 700 }),
      s.tweens.add({ targets: beam, alpha: { from: 0.55, to: 0.9 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      s.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.8 }, scale: { from: 1.3, to: 1.55 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      ...halos.map((h, i) => s.tweens.add({
        targets: h, scale: { from: 0.5, to: 1.5 }, alpha: { from: 1, to: 0 }, duration: 1600, delay: i * 800, repeat: -1, ease: 'Sine.easeOut',
      })),
    );
  }
}

/** Soft additive light textures for the manifest effect, drawn once per game. */
function ensureFxTextures(s: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void => {
    if (s.textures.exists(key)) return;
    const tex = s.textures.createCanvas(key, w, h)!;
    draw(tex.getContext());
    tex.refresh();
  };
  make('fx_beam', 48, 256, (ctx) => {
    const across = ctx.createLinearGradient(0, 0, 48, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 48, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const up = ctx.createLinearGradient(0, 0, 0, 256);
    up.addColorStop(0, 'rgba(0,0,0,0)');
    up.addColorStop(0.6, 'rgba(0,0,0,1)');
    up.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = up;
    ctx.fillRect(0, 0, 48, 256);
  });
  make('fx_glow', 96, 96, (ctx) => {
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  });
  make('fx_spark', 6, 6, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, 4, 6);
    ctx.fillRect(0, 1, 6, 4);
  });
}
