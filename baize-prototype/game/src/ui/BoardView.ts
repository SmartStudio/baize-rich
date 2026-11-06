// Board rendering on the iso grid: the ground plane (Ground.ts), a raised block per node with its landmark,
// buildings by land level, ownership rims, one-way chevrons, diamond hit zones, tokens, and the 白泽现世
// light on the altar. Everything lives in world coordinates (WorldMap) and draws at 1×; GameScene's camera
// scrolls and zooms it at integer zoom. Draw order comes from world.DEPTH.
import Phaser from 'phaser';
import { ALTAR, type Board } from '../core/board';
import type { GameState, HeroId, NodeId } from '../core/types';
import { addImg, ensureCanvas, ISO_ALTAR, ISO_BLOCK, setFrame } from './assets';
import { drawGround } from './Ground';
import { CHEVRON, fillDiamond, paintChevron, ringDiamond, type ChevronDir } from './isoArt';
import type { Rect } from './layout';
import { COLORS, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import { DEPTH, project, TH, TW, WorldMap, type Footprint, type Point } from './world';

/** Landmarks and buildings stand this far below the diamond centre, on the face's front half. */
const STAND_DY = 6;
/** Height of a token's hop between cells, in px. */
const HOP = 14;
/** Feet offsets from the diamond centre, one per seat, spread along the diamond's long axis. */
const FAN: Point[] = [0, 1, 2, 3].map((seat) => ({ x: (seat - 1.5) * 16, y: seat % 2 ? 3 : -3 }));
/** Token feet on the altar: cells of its front rows (offsets from the footprint's back corner), clear of the statue. */
const ALTAR_SEATS: [number, number][] = [[1, 2], [2, 1], [0, 2], [2, 0]];
const TOKEN = { w: 36, h: 64 };
/** The 白泽 light rises from this far above the altar's diamond centre. */
const MANIFEST_FEET = 46;

/** Face overlay textures: what is drawn on a top face and how. All are white, tinted at use. */
type Overlay = 'rim' | 'rim2' | 'mark';

interface LandView {
  bld: Phaser.GameObjects.Image;
  rim: Phaser.GameObjects.Image;
}

/**
 * The altar's statue stands on its top face in the same sprite, so anything painted on the altar's face would
 * cross the statue. Its overlays trace only the two front edges.
 */
function overlayKey(scene: Phaser.Scene, kind: Overlay, f: Footprint, frontOnly: boolean): string {
  const w = (f.c1 - f.c0 + 1) * TW;
  const h = w / 2;
  const key = `face_${kind}_${w}${frontOnly ? '_front' : ''}`;
  ensureCanvas(scene, key, w, h, (ctx) => {
    ctx.fillStyle = '#ffffff';
    if (kind === 'rim2') {
      ringDiamond(ctx, w, 1, 2);
      ringDiamond(ctx, w, 5, 2);
    } else ringDiamond(ctx, w, kind === 'mark' ? 0 : 2, 2);
    if (kind === 'mark' && !frontOnly) {
      ctx.globalAlpha = 0.3;
      fillDiamond(ctx, 0, 0, w, 2);
      ctx.globalAlpha = 1;
    }
    if (frontOnly) ctx.clearRect(0, 0, w, h / 2);
  });
  return key;
}

export class BoardView {
  private lands = new Map<NodeId, LandView>();
  private tokens: Phaser.GameObjects.Container[] = [];
  /** The hero figure inside each token container (the part that hops). */
  private figures: Phaser.GameObjects.Image[] = [];
  private tokenNode: NodeId[] = [];
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
    for (const id of board.allNodeIds()) {
      if (id === ALTAR) this.mountAltar();
      else this.mountNode(id);
      this.addZone(id);
    }
    this.drawChevrons();
    const c = this.world.centre(ALTAR);
    this.manifest = new Manifest(s, c.x, c.y - MANIFEST_FEET, DEPTH.stand(c.y));
    this.rock = txt(s, 0, 0, '山', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 1] }).setDepth(DEPTH.top).setVisible(false);
    this.currentMark = s.add.image(0, 0, '__DEFAULT').setVisible(false);
    s.tweens.add({ targets: this.currentMark, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    ensureCanvas(s, 'tok_base', 24, 12, (ctx) => {
      ctx.fillStyle = '#0f0e1a';
      fillDiamond(ctx, 0, 0, 24, 0);
      ctx.fillStyle = '#ffffff';
      fillDiamond(ctx, 0, 0, 24, 1);
    });
    heroes.forEach((h, seat) => {
      const base = s.add.image(0, 0, 'tok_base').setTint(PLAYER_COLORS[seat]);
      const tok = addImg(s, 0, 0, `tok_${h}`).setOrigin(0.5, 1);
      this.tokens.push(s.add.container(0, 0, [base, tok]));
      this.figures.push(tok);
      this.tokenNode.push(board.startId);
    });
  }

  /** A node's raised block, plus its landmark (special nodes) or its hidden building and rim (land). */
  private mountNode(id: NodeId): void {
    const s = this.scene;
    const n = this.board.node(id);
    const f = this.world.footprint(id);
    const p = this.world.centre(id);
    addImg(s, p.x, p.y, n.region ? `iso_land_${n.region}` : 'iso_jade').setDisplayOrigin(ISO_BLOCK.cx, ISO_BLOCK.cy).setDepth(DEPTH.block(f.c0, f.r0));
    const stand = (frame: string): Phaser.GameObjects.Image => addImg(s, p.x, p.y + STAND_DY, frame).setOrigin(0.5, 1).setDepth(DEPTH.stand(p.y));
    if (n.type !== 'land') {
      stand(`lm_${n.type}`);
      return;
    }
    const rim = s.add.image(p.x, p.y, overlayKey(s, 'rim', f, false)).setDepth(DEPTH.face(p.y)).setVisible(false);
    this.lands.set(id, { bld: stand('iso_bld_1').setVisible(false), rim });
  }

  private mountAltar(): void {
    const f = this.world.footprint(ALTAR);
    const p = this.world.centre(ALTAR);
    addImg(this.scene, p.x, p.y, 'iso_altar').setDisplayOrigin(ISO_ALTAR.cx, ISO_ALTAR.cy).setDepth(DEPTH.block((f.c0 + f.c1) / 2, (f.r0 + f.r1) / 2));
  }

  /** One flat chevron on the seam between the two ends of every one-way road, pointing along it. */
  private drawChevrons(): void {
    const s = this.scene;
    for (const e of this.world.edges) {
      if (e.twoWay) continue;
      const a = this.world.footprint(e.from);
      const b = this.world.footprint(e.to);
      const dc = b.c0 + b.c1 - a.c0 - a.c1;
      const dr = b.r0 + b.r1 - a.r0 - a.r1;
      const dir: ChevronDir = Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? 'c+' : 'c-') : (dr > 0 ? 'r+' : 'r-');
      const key = `chev_${dir}`;
      ensureCanvas(s, key, CHEVRON.w, CHEVRON.h, (ctx) => paintChevron(ctx, dir, '#f4e9d0', '#0f0e1a'));
      const pa = this.world.centre(e.from);
      const pb = this.world.centre(e.to);
      s.add.image((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, key).setDepth(DEPTH.face(Math.max(pa.y, pb.y)) + 0.05);
    }
  }

  /** Hover and click land on the node's top-face diamond. A click lands on release, so a camera drag never counts. */
  private addZone(id: NodeId): void {
    const r = this.world.rect(id);
    const corners = this.world.diamond(id).map((p) => new Phaser.Geom.Point(p.x - r.x, p.y - r.y));
    const z = this.scene.add.zone(r.x, r.y, r.w, r.h).setOrigin(0, 0)
      .setInteractive({ hitArea: new Phaser.Geom.Polygon(corners), hitAreaCallback: Phaser.Geom.Polygon.Contains, useHandCursor: false });
    z.on('pointerover', () => this.hoverFn?.(id));
    z.on('pointerout', () => this.hoverFn?.(null));
    z.on('pointerdown', () => this.pressFn?.(id));
    z.on('pointerup', () => this.clickFn?.(id));
  }

  onHover(fn: (n: NodeId | null) => void): void { this.hoverFn = fn; }
  onPress(fn: (n: NodeId) => void): void { this.pressFn = fn; }
  /** Fires for every node on release. */
  onClick(fn: (n: NodeId) => void): void { this.clickFn = fn; }

  /** Screen-aligned box around the node's top face, in world px. */
  nodeRect(id: NodeId): Rect {
    return this.world.rect(id);
  }

  /** The point the camera keeps on screen for a seat: its token's body, wherever it is mid-move. */
  tokenFocus(seat: number): Point {
    const t = this.tokens[seat];
    return { x: t.x, y: t.y - TOKEN.h / 2 };
  }

  /** World-space box around a seat's token, for keeping modals off it. */
  tokenRect(seat: number): Rect {
    const t = this.tokens[seat];
    return { x: t.x - TOKEN.w / 2, y: t.y - TOKEN.h, w: TOKEN.w, h: TOKEN.h };
  }

  /** A seat's feet on a node: its fan spot on a cell, or its own front cell on the altar. */
  private tokenXY(id: NodeId, seat: number): Point {
    if (id === ALTAR) {
      const f = this.world.footprint(ALTAR);
      const [dc, dr] = ALTAR_SEATS[seat];
      return project(f.c0 + dc, f.r0 + dr);
    }
    const c = this.world.centre(id);
    return { x: c.x + FAN[seat].x, y: c.y + FAN[seat].y };
  }

  placeToken(seat: number, id: NodeId): void {
    const { x, y } = this.tokenXY(id, seat);
    this.tokens[seat].setPosition(x, y).setDepth(DEPTH.token(y, seat));
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
        onUpdate: () => tok.setDepth(DEPTH.token(tok.y, seat)),
        onComplete: () => resolve(),
      });
      if (hop) this.scene.tweens.add({ targets: this.figures[seat], y: -HOP, duration: ms / 2, yoyo: true, ease: 'Quad.easeOut' });
    });
  }

  syncTokens(state: GameState): void {
    state.players.forEach((p, seat) => {
      if (this.tokenNode[seat] !== p.pos || !this.scene.tweens.isTweening(this.tokens[seat])) this.placeToken(seat, p.pos);
    });
  }

  markCurrent(state: GameState): void {
    const id = state.players[state.current].pos;
    this.paintOverlay(this.currentMark, id, 'mark', 0.1).setTint(PLAYER_COLORS[state.current]).setVisible(!state.over);
  }

  /** Put a face overlay image on a node's top face. */
  private paintOverlay(img: Phaser.GameObjects.Image, id: NodeId, kind: Overlay, above: number): Phaser.GameObjects.Image {
    const p = this.world.centre(id);
    return img.setTexture(overlayKey(this.scene, kind, this.world.footprint(id), id === ALTAR)).setPosition(p.x, p.y).setDepth(DEPTH.face(p.y) + above);
  }

  /** A short gain / loss label that rises from a seat's token. */
  floatText(seat: number, text: string, color: string, delay = 0): void {
    const tok = this.tokens[seat];
    const t = txt(this.scene, tok.x, tok.y - TOKEN.h, text, { size: FS.md, bold: true, color, stroke: HEX.ink, origin: [0.5, 1] })
      .setDepth(DEPTH.top + 1).setAlpha(0);
    this.scene.tweens.add({ targets: t, alpha: 1, duration: 120, delay });
    this.scene.tweens.add({ targets: t, y: t.y - 30, duration: 1100, delay, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, duration: 300, delay: delay + 900, onComplete: () => t.destroy() });
  }

  /** Refresh ownership rims, buildings and markers from a (snapshot) state. */
  render(state: GameState): void {
    for (const [id, v] of this.lands) {
      const { owner, level } = state.tiles[id];
      v.bld.setVisible(owner !== null && level > 0);
      if (level > 0) setFrame(v.bld, `iso_bld_${level}`);
      v.rim.setVisible(owner !== null);
      if (owner === null) continue;
      const street = this.board.streetOf(id);
      const whole = street.length > 0 && street.every((s) => state.tiles[s].owner === owner);
      this.paintOverlay(v.rim, id, whole ? 'rim2' : 'rim', 0).setTint(PLAYER_COLORS[owner]);
    }
    if (state.roadblock) {
      const p = this.world.centre(state.roadblock.node);
      this.rock.setVisible(true).setPosition(p.x, p.y - TH / 2).setColor(PLAYER_HEX[state.roadblock.seat]);
    } else this.rock.setVisible(false);
    this.markCurrent(state);
  }

  /** 白泽现世: the altar's own statue lights up. Idempotent. */
  showBaize(on: boolean): void {
    this.manifest.set(on);
  }

  setClickable(nodes: NodeId[]): void {
    for (const h of this.highlights) h.destroy();
    this.highlights = nodes.map((id) => {
      const h = this.paintOverlay(this.scene.add.image(0, 0, '__DEFAULT'), id, 'mark', 0.2).setTint(COLORS.gold);
      this.scene.tweens.add({ targets: h, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      return h;
    });
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
    const feet = MANIFEST_FEET;
    const beam = s.add.image(0, feet, 'fx_beam').setOrigin(0.5, 1).setScale(1.6, 1.5).setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const glow = s.add.image(0, 0, 'fx_glow').setScale(1.4).setTint(GOLD_LIGHT).setBlendMode(Phaser.BlendModes.ADD);
    const halos = [0, 1].map(() => s.add.ellipse(0, feet, 144, 72).setStrokeStyle(3, COLORS.gold).setFillStyle());
    this.layer = s.add.container(x, y, [beam, ...halos, glow]).setDepth(depth).setVisible(false);
    this.sparks = s.add.particles(x, y + feet, 'fx_spark', {
      speedY: { min: -70, max: -30 }, speedX: { min: -12, max: 12 }, lifespan: 1800,
      scale: { start: 1, end: 0.2 }, alpha: { start: 1, end: 0 }, frequency: 90,
      tint: [GOLD_LIGHT, 0xffffff], blendMode: 'ADD',
      emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 120, 60), quantity: 1 },
      emitting: false,
    }).setDepth(depth + 0.1);
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
  ensureCanvas(s, 'fx_beam', 48, 256, (ctx) => {
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
  ensureCanvas(s, 'fx_glow', 96, 96, (ctx) => {
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  });
  ensureCanvas(s, 'fx_spark', 6, 6, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, 4, 6);
    ctx.fillRect(0, 1, 6, 4);
  });
}
