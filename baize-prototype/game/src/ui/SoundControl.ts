// The speaker pill (M mutes from any screen) and the small panel it opens: 音乐, 音效, 音量, 静音.
import Phaser from 'phaser';
import { sound } from '../audio/Sound';
import { stepVolume, type AudioPrefs } from '../audio/mix';
import { COLORS, FS, HEX, txt } from './theme';
import { Button } from './widgets';

const DEPTH = 9600;
const PANEL_W = 176;
const ROW_H = 28;
const PAD = 8;

export class SoundControl {
  readonly pill: Button;
  private icon: Phaser.GameObjects.Graphics;
  private panel: Phaser.GameObjects.Container | null = null;
  private unsubscribe: () => void;

  /** The panel opens under the pill, right edges aligned. */
  constructor(private scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
    this.pill = new Button(scene, x, y, { w, h, label: '' }).onClick(() => this.toggle());
    this.icon = scene.add.graphics();
    this.pill.add(this.icon);
    this.unsubscribe = sound.onChange((p) => this.refresh(p));
    this.refresh(sound.settings);
    const outside = (ptr: Phaser.Input.Pointer) => { if (this.panel && !this.hits(ptr)) this.close(); };
    scene.input.on('pointerdown', outside);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe();
      scene.input.off('pointerdown', outside);
    });
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  close(): void {
    this.panel?.destroy(true);
    this.panel = null;
  }

  private toggle(): void {
    if (this.panel) this.close();
    else this.open();
    sound.cue('click');
  }

  private hits(ptr: Phaser.Input.Pointer): boolean {
    const b = this.panel!.getBounds();
    const p = this.pill;
    const inPill = ptr.x >= p.x && ptr.x <= p.x + p.width && ptr.y >= p.y && ptr.y <= p.y + p.height;
    return inPill || b.contains(ptr.x, ptr.y);
  }

  private open(): void {
    const s = this.scene;
    const px = this.pill.x + this.pill.width - PANEL_W;
    const py = this.pill.y + this.pill.height + 4;
    const rows = 4;
    const ph = PAD * 2 + 22 + rows * (ROW_H + 4);
    this.panel = s.add.container(px, py).setDepth(DEPTH);
    this.panel.add(s.add.rectangle(0, 0, PANEL_W, ph, COLORS.panel, 0.97).setOrigin(0, 0).setStrokeStyle(2, COLORS.gold));
    this.panel.add(txt(s, PAD, PAD, '声音', { size: FS.sm, bold: true, color: HEX.gold }));
    this.panel.add(txt(s, PANEL_W - PAD, PAD + 1, 'M 静音', { size: FS.xs, color: HEX.dim, origin: [1, 0] }));
    this.paint(sound.settings);
  }

  private refresh(p: AudioPrefs): void {
    this.drawIcon(p.muted || (!p.music && !p.sfx));
    // A row's own click changed the settings: rebuild after its handler returns, not under it.
    if (this.panel) this.scene.time.delayedCall(0, () => { if (this.panel) this.paint(sound.settings); });
  }

  /** Rebuilds the rows under the panel header for the current settings. */
  private paint(p: AudioPrefs): void {
    const panel = this.panel!;
    panel.list.slice(3).forEach((o) => o.destroy());
    const s = this.scene;
    const rowW = PANEL_W - 2 * PAD;
    let y = PAD + 22;
    const row = (label: string, on: boolean, flip: () => void) => {
      panel.add(new Button(s, PAD, y, { w: rowW, h: ROW_H, label, size: FS.sm, fill: on ? COLORS.panelLight : COLORS.disabled }).onClick(() => { flip(); sound.cue('click'); }));
      y += ROW_H + 4;
    };
    row(`音乐 · ${p.music ? '开' : '关'}`, p.music, () => sound.update({ music: !p.music }));
    row(`音效 · ${p.sfx ? '开' : '关'}`, p.sfx, () => sound.update({ sfx: !p.sfx }));
    const stepW = ROW_H + 4;
    panel.add(new Button(s, PAD, y, { w: stepW, h: ROW_H, label: '−', size: FS.md }).onClick(() => this.nudge(-1)));
    panel.add(txt(s, PANEL_W / 2, y + ROW_H / 2, `音量 ${Math.round(p.volume * 100)}%`, { size: FS.sm, color: HEX.parchment, origin: [0.5, 0.5] }));
    panel.add(new Button(s, PANEL_W - PAD - stepW, y, { w: stepW, h: ROW_H, label: '+', size: FS.md }).onClick(() => this.nudge(1)));
    y += ROW_H + 4;
    row(p.muted ? '已静音 · 点此恢复' : '全部静音', !p.muted, () => sound.update({ muted: !p.muted }));
  }

  private nudge(dir: 1 | -1): void {
    sound.update({ volume: stepVolume(sound.settings.volume, dir), muted: false });
    sound.cue('click');
  }

  /** A pixel speaker; sound waves when on, a red cross when silent. */
  private drawIcon(silent: boolean): void {
    const g = this.icon.clear();
    const cx = Math.round(this.pill.width / 2) - 5;
    const cy = Math.round(this.pill.height / 2);
    g.fillStyle(COLORS.parchment, 1);
    g.fillRect(cx - 5, cy - 3, 4, 6);
    g.fillTriangle(cx - 2, cy - 3, cx + 3, cy - 7, cx + 3, cy + 7);
    g.fillTriangle(cx - 2, cy + 3, cx - 2, cy - 3, cx + 3, cy + 7);
    if (silent) {
      g.lineStyle(2, COLORS.bad, 1);
      g.lineBetween(cx + 6, cy - 4, cx + 12, cy + 4);
      g.lineBetween(cx + 6, cy + 4, cx + 12, cy - 4);
      return;
    }
    g.fillRect(cx + 6, cy - 2, 2, 4);
    g.fillRect(cx + 10, cy - 5, 2, 10);
  }
}
