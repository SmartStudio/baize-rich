// Left-column seat chips. Realm and the segmented 修为 bar are the spine.
// 灵草, 丹药, 灵石, 心境 and the status tags sit under that bar.
import Phaser from 'phaser';
import type { Game } from '../core/engine';
import type { GameState } from '../core/types';
import { addImg } from './assets';
import { ensureHudIcons } from './hudIcons';
import {
  barSegments, chipFace, closeDetail, failLine, resourceTip, seatTags,
  type ChipFace, type ChipTag, type TagTone,
} from './hudReadout';
import { LEFT, type Rect } from './layout';
import { COLORS, FLOAT_ALPHA, FS, HEX, PLAYER_COLORS, PLAYER_HEX, txt } from './theme';
import type { Tooltip, TipContent } from './Tooltip';

interface ResourceSlot {
  icon: Phaser.GameObjects.Image;
  value: Phaser.GameObjects.Text;
}

interface ChipView {
  rect: Rect;
  frame: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Rectangle;
  marker: Phaser.GameObjects.Triangle;
  realm: Phaser.GameObjects.Text;
  note: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  resources: ResourceSlot[];
  tags: Phaser.GameObjects.Text[];
}

const TEXT_X = 52;
const BAR_W = LEFT.w - TEXT_X - 8;
const BAR_H = 8;
const BAR_GAP = 2;
const TAG_SLOTS = 8;
const RESOURCE_FRAMES = ['ic_herb', 'ic_pill', 'ic_stone', 'ic_mind'] as const;

export class PlayerCards {
  private views: ChipView[] = [];
  private state: GameState;

  constructor(scene: Phaser.Scene, private game: Game, private labels: string[], private tip: Tooltip) {
    ensureHudIcons(scene);
    this.state = game.state;
    game.state.players.forEach((p, i) => this.views.push(this.buildChip(scene, i, p.hero)));
    this.render(game.state);
  }

  render(state: GameState): void {
    this.state = state;
    state.players.forEach((_, i) => this.paint(state, i));
    this.refreshPin();
  }

  private buildChip(scene: Phaser.Scene, i: number, hero: string): ChipView {
    const x = LEFT.x;
    const y = LEFT.chipY + i * (LEFT.chipH + LEFT.chipGap);
    const rect = { x, y, w: LEFT.w, h: LEFT.chipH };
    const frame = this.addFrame(scene, x, y, i);
    const view: ChipView = {
      rect, frame, glow: this.addGlow(scene, x, y), marker: this.addMarker(scene, x, y, i),
      realm: txt(scene, x + TEXT_X, y + 24, '', { size: FS.sm }),
      note: txt(scene, x + TEXT_X, y + 24, '', { size: FS.sm, color: HEX.gold }),
      bar: scene.add.graphics(),
      resources: RESOURCE_FRAMES.map((name) => ({
        icon: addImg(scene, x, y, name).setOrigin(0, 0),
        value: txt(scene, x, y, '', { size: FS.sm }),
      })),
      tags: Array.from({ length: TAG_SLOTS }, () => txt(scene, x, y, '', { size: FS.xs }).setVisible(false)),
    };
    txt(scene, x + TEXT_X, y + 6, this.game.state.players[i].name, { size: FS.sm, color: PLAYER_HEX[i], bold: true });
    txt(scene, x + LEFT.w - 8, y + 8, this.labels[i], { size: FS.xs, color: HEX.dim, origin: [1, 0] });
    addImg(scene, x + 6, y + 6, `por_${hero}_s`).setOrigin(0, 0);
    this.bindChip(scene, i, rect);
    return view;
  }

  private addFrame(scene: Phaser.Scene, x: number, y: number, i: number): Phaser.GameObjects.Rectangle {
    const frame = scene.add.rectangle(x, y, LEFT.w, LEFT.chipH, COLORS.panel, FLOAT_ALPHA).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline);
    scene.add.rectangle(x, y, 4, LEFT.chipH, PLAYER_COLORS[i]).setOrigin(0, 0);
    return frame;
  }

  private addGlow(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Rectangle {
    return scene.add.rectangle(x + 4, y + 4, LEFT.w - 8, LEFT.chipH - 8, COLORS.gold, 0)
      .setOrigin(0, 0).setStrokeStyle(2, COLORS.gold).setVisible(false);
  }

  private addMarker(scene: Phaser.Scene, x: number, y: number, i: number): Phaser.GameObjects.Triangle {
    return scene.add.triangle(x + LEFT.w + 8, y + LEFT.chipH / 2, 0, 0, 0, 14, 9, 7, PLAYER_COLORS[i])
      .setStrokeStyle(1, COLORS.outline).setVisible(false);
  }

  private bindChip(scene: Phaser.Scene, i: number, rect: Rect): void {
    const open = (): void => this.tip.toggle(`chip:${i}`, rect, this.detailTip(i));
    const { x, y, w, h } = rect;
    scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true }).on('pointerdown', open);
    this.hover(x + TEXT_X, y + 22, BAR_W, 28, () => this.cultTip(i), open);
    this.hover(x + 6, y + 54, w - 12, 16, () => ({ title: '资源', body: resourceTip(this.state, this.game.data, i) }), open);
    this.hover(x + 6, y + 72, w - 12, 14, () => this.statusTip(i), open);
  }

  private hover(x: number, y: number, w: number, h: number, content: () => TipContent, open: () => void): void {
    this.tip.attach(x, y, w, h, content).setInteractive({ useHandCursor: true }).on('pointerdown', open);
  }

  private paint(state: GameState, i: number): void {
    const face = chipFace(state, this.game.data, i);
    const v = this.views[i];
    const active = state.current === i && !state.over;
    this.paintFrame(v, i, active, face.glow);
    this.paintRealm(v, face);
    this.paintBar(v, face.filled, face.total);
    this.paintResources(v, face);
    this.paintTags(v, face.tags);
  }

  private paintFrame(v: ChipView, i: number, active: boolean, glow: boolean): void {
    const stroke = active ? PLAYER_COLORS[i] : glow ? COLORS.gold : COLORS.outline;
    v.frame.setStrokeStyle(active || glow ? 3 : 2, stroke).setFillStyle(active ? COLORS.panelLight : COLORS.panel, FLOAT_ALPHA);
    v.glow.setVisible(glow && active);
    v.marker.setVisible(active);
  }

  private paintRealm(v: ChipView, face: ChipFace): void {
    v.realm.setText(face.realm).setColor(face.noteGold ? HEX.gold : HEX.parchment);
    v.note.setText(face.note).setVisible(face.note !== '');
    v.note.setPosition(v.rect.x + TEXT_X + Math.ceil(v.realm.width) + 8, v.realm.y);
  }

  private paintBar(v: ChipView, filled: number, total: number): void {
    const x = v.rect.x + TEXT_X;
    const y = v.rect.y + 42;
    v.bar.clear();
    let cx = x;
    barSegments(BAR_W, total, BAR_GAP).forEach((w, i, widths) => {
      v.bar.fillStyle(total === 0 || i < filled ? COLORS.gold : COLORS.disabled, 1);
      v.bar.fillRect(cx, y, w, BAR_H);
      cx += w + (i < widths.length - 1 ? BAR_GAP : 0);
    });
  }

  private paintResources(v: ChipView, face: ChipFace): void {
    const values = [face.herbs, face.pills, face.stones, face.mind].map(String);
    const colors = [HEX.parchment, face.pillGold ? HEX.gold : HEX.parchment, HEX.parchment, face.mind > 0 ? HEX.gold : HEX.parchment];
    let x = v.rect.x + 6;
    const y = v.rect.y + 54;
    v.resources.forEach((slot, k) => {
      slot.value.setText(values[k]).setColor(colors[k]);
      slot.icon.setPosition(x, y);
      slot.value.setPosition(x + 18, y + 2);
      x += 18 + Math.ceil(slot.value.width) + 8;
    });
  }

  private paintTags(v: ChipView, tags: ChipTag[]): void {
    let x = v.rect.x + 6;
    const y = v.rect.y + 72;
    const max = v.rect.x + v.rect.w - 6;
    let shown = 0;
    for (const tag of tags) {
      const slot = v.tags[shown];
      if (!slot) break;
      slot.setText(tag.label).setColor(toneHex(tag.tone));
      if (x + Math.ceil(slot.width) > max) break;
      slot.setPosition(x, y).setVisible(true);
      x += Math.ceil(slot.width) + 8;
      shown += 1;
    }
    for (let i = shown; i < v.tags.length; i++) v.tags[i].setVisible(false);
  }

  private refreshPin(): void {
    const pinned = this.tip.pinned;
    if (!pinned?.startsWith('chip:')) return;
    const i = Number(pinned.slice(5));
    this.tip.unpin();
    this.tip.toggle(pinned, this.views[i].rect, this.detailTip(i));
  }

  private detailTip(i: number): TipContent {
    const data = this.game.data;
    const face = chipFace(this.state, data, i);
    const lines = [
      `${this.labels[i]} · 修为 ${this.state.players[i].cult}/${face.total}`,
      resourceTip(this.state, data, i),
      closeDetail(this.state, data, i),
      '',
      face.tags.map((t) => `${t.label}：${t.desc}`).join('\n'),
    ];
    return { title: `${this.state.players[i].name} · ${face.realm}`, body: lines.join('\n') };
  }

  private statusTip(i: number): TipContent {
    const tags = seatTags(this.state, this.game.data, i);
    return { title: `${this.state.players[i].name} 的状态`, body: tags.map((t) => `${t.label}：${t.desc}`).join('\n') };
  }

  private cultTip(i: number): TipContent {
    const data = this.game.data;
    const face = chipFace(this.state, data, i);
    const c = data.config.cultivation;
    const lines = [
      '先突破到化神者获胜。否则秘境关闭时比境界，再比修为，再比资产。',
      closeDetail(this.state, data, i),
      `修为来源：吐纳 +${c.breath}、打坐、灵泉 +${c.spring}、灵眼 +${c.eye}、服丹 +${c.pill}。`,
      failLine(data),
    ];
    return { title: `${face.realm} · 修为 ${this.state.players[i].cult}/${face.total}`, body: lines.join('\n') };
  }
}

function toneHex(tone: TagTone): string {
  if (tone === 'gold') return HEX.gold;
  if (tone === 'bad') return HEX.bad;
  if (tone === 'dim') return HEX.dim;
  return HEX.parchment;
}
