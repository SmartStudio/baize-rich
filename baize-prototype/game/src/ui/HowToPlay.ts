// 玩法说明: a paged overlay any scene can open. Numbers come from data/, never literals, so the copy follows balance changes.
import Phaser from 'phaser';
import { defaultData } from '../core/data';
import { addImg } from './assets';
import { tutorialCopy, type TutorialCopy } from './narration';
import { COLORS, HEX, panel, txt } from './theme';
import { Button } from './widgets';

type Obj = Phaser.GameObjects.GameObject;

interface Page {
  title: string;
  lines: string[];
  /** Illustration centred on (cx, cy) inside a 340×340 box. */
  art: (scene: Phaser.Scene, cx: number, cy: number) => Obj[];
}

const cfg = defaultData.config;

function chip(scene: Phaser.Scene, cx: number, y: number, label: string, w = 220): Obj[] {
  return [
    scene.add.rectangle(cx, y, w, 34, COLORS.panelLight).setStrokeStyle(2, COLORS.outline),
    txt(scene, cx, y, label, { size: 15, bold: true, origin: [0.5, 0.5] }),
  ];
}

function captioned(scene: Phaser.Scene, x: number, y: number, frame: string, scale: number, caption: string): Obj[] {
  return [
    addImg(scene, x, y, frame).setScale(scale),
    txt(scene, x, y + 52, caption, { size: 13, color: HEX.gold, origin: [0.5, 0.5] }),
  ];
}

const goalArt: Page['art'] = (scene, cx, cy) => {
  const out: Obj[] = [addImg(scene, cx, cy - 80, 'ic_cult').setScale(5)];
  const cell = Math.floor(320 / cfg.realms.length);
  const x0 = cx - (cell * cfg.realms.length) / 2;
  cfg.realms.forEach((realm, index) => {
    const color = index === cfg.realms.length - 1 ? COLORS.gold : COLORS.panelLight;
    out.push(scene.add.rectangle(x0 + index * cell + cell / 2, cy + 40, cell - 6, 30, color).setStrokeStyle(2, COLORS.outline));
    out.push(txt(scene, x0 + index * cell + cell / 2, cy + 40, realm.name, { size: 14, bold: true, origin: [0.5, 0.5] }));
  });
  return out;
};

const ART_BY_PAGE: Record<TutorialCopy['id'], Page['art']> = {
  goal: goalArt,
  turn: (s, cx, cy) => [
    addImg(s, cx - 34, cy - 120, 'die_3').setScale(2),
    addImg(s, cx + 34, cy - 120, 'die_4').setScale(2),
    ...chip(s, cx, cy - 50, '掷骰前 · 整备'),
    ...chip(s, cx, cy, '掷骰 · 移动'),
    ...chip(s, cx, cy + 50, '斗法 · 落点结算'),
    ...chip(s, cx, cy + 100, '行动 · 吐纳打坐'),
  ],
  land: (s, cx, cy) => [
    ...captioned(s, cx - 100, cy - 70, 'bld_1', 1.5, defaultData.board.buildings[1].name),
    ...captioned(s, cx, cy - 70, 'bld_2', 1.5, defaultData.board.buildings[2].name),
    ...captioned(s, cx + 100, cy - 70, 'bld_3', 1.5, defaultData.board.buildings[3].name),
  ],
  alchemy: (s, cx, cy) => [
    addImg(s, cx - 70, cy - 70, 'ic_cult').setScale(4),
    txt(s, cx, cy - 70, '灵草入炉', { size: 17, color: HEX.gold, origin: [0.5, 0.5] }),
    addImg(s, cx + 85, cy - 70, 'ic_pill').setScale(4),
    ...chip(s, cx, cy + 30, '看准金火 · 收炉成丹'),
  ],
  breakthrough: (s, cx, cy) => [
    addImg(s, cx, cy - 70, 'altar').setScale(0.75),
    ...chip(s, cx, cy + 90, '押丹 · 掷骰 · 听天命'),
  ],
  duel: (s, cx, cy) => [
    addImg(s, cx - 60, cy - 60, 'por_sword'),
    addImg(s, cx + 60, cy - 60, 'por_body'),
    txt(s, cx, cy - 60, '斗法', { size: 22, bold: true, color: HEX.gold, origin: [0.5, 0.5] }),
    ...chip(s, cx, cy + 50, '境界 · 天赋 · 宝光'),
  ],
  heroes: (s, cx, cy) => defaultData.heroes.flatMap((hero, index) => [
    addImg(s, cx - 120 + index * 80, cy - 80, `por_${hero.id}`),
    txt(s, cx - 120 + index * 80, cy - 30, hero.name, { size: 13, color: HEX.gold, origin: [0.5, 0.5] }),
  ]),
  baize: (s, cx, cy) => [
    addImg(s, cx, cy - 60, 'baize').setScale(1.5),
    ...chip(s, cx, cy + 80, '秘境过半 · 落后者先挑'),
  ],
};

const PAGES: Page[] = tutorialCopy(defaultData).map((copy) => ({
  title: copy.title,
  lines: copy.lines,
  art: ART_BY_PAGE[copy.id],
}));

const PX = 160;
const PY = 80;
const PW = 960;
const PH = 560;

/**
 * Modal overlay. While open it swallows pointer input below it and owns the keyboard:
 * ←/→ turn pages, Space/Enter advance (closing on the last page), Esc closes.
 */
export class HowToPlay {
  private root: Phaser.GameObjects.Container;
  private page: Phaser.GameObjects.Container;
  private dots: Phaser.GameObjects.Rectangle[] = [];
  private prev: Button;
  private next: Button;
  private index = 0;
  private closed = false;
  private readonly closeLabel: string;
  private readonly onKey = (ev: KeyboardEvent) => this.key(ev);

  constructor(private scene: Phaser.Scene, private onClose: () => void, opts: { closeLabel?: string } = {}) {
    this.closeLabel = opts.closeLabel ?? '知道了';
    this.root = scene.add.container(0, 0).setDepth(10000);
    const shade = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x0f0e1a, 0.8).setOrigin(0, 0).setInteractive();
    const box = panel(scene, PX, PY, PW, PH, COLORS.panel, COLORS.gold);
    const head = txt(scene, PX + 24, PY + 18, '玩法说明', { size: 14, color: HEX.dim });
    const skip = txt(scene, PX + PW - 24, PY + 18, 'Esc 跳过', { size: 14, color: HEX.dim, origin: [1, 0] })
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());
    this.page = scene.add.container(0, 0);
    this.prev = new Button(scene, PX + 24, PY + PH - 64, { w: 140, h: 44, label: '◀ 上一页', size: 16 }).onClick(() => this.go(this.index - 1));
    this.next = new Button(scene, PX + PW - 164, PY + PH - 64, { w: 140, h: 44, label: '', size: 16, fill: 0x8a5a1e }).onClick(() => this.advance());
    this.dots = PAGES.map((_, i) => scene.add.rectangle(640 - (PAGES.length - 1) * 12 + i * 24, PY + PH - 42, 12, 12, COLORS.disabled).setStrokeStyle(2, COLORS.outline));
    this.root.add([shade, box, head, skip, this.page, this.prev, this.next, ...this.dots]);
    scene.input.keyboard?.on('keydown', this.onKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.keyboard?.off('keydown', this.onKey));
    this.go(0);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  private go(i: number): void {
    if (i < 0 || i >= PAGES.length) return;
    this.index = i;
    const p = PAGES[i];
    this.page.removeAll(true);
    this.page.add(txt(this.scene, 640, PY + 64, p.title, { size: 28, bold: true, color: HEX.gold, origin: [0.5, 0.5] }));
    this.page.add(this.scene.add.rectangle(PX + 40, PY + 104, 340, 360, COLORS.bg).setOrigin(0, 0).setStrokeStyle(2, COLORS.outline));
    this.page.add(p.art(this.scene, PX + 210, PY + 284));
    let y = PY + 116;
    for (const line of p.lines) {
      const t = txt(this.scene, PX + 410, y, line, { size: 17, wrap: 500, lineSpacing: 6 });
      this.page.add(t);
      y += t.height + 16;
    }
    this.dots.forEach((d, k) => d.setFillStyle(k === i ? COLORS.gold : COLORS.disabled));
    this.prev.setEnabled(i > 0);
    this.next.setLabel(i === PAGES.length - 1 ? this.closeLabel : '下一页 ▶');
  }

  private advance(): void {
    if (this.index === PAGES.length - 1) this.close();
    else this.go(this.index + 1);
  }

  private key(ev: KeyboardEvent): void {
    if (this.closed) return;
    if (ev.key === 'ArrowLeft') this.go(this.index - 1);
    else if (ev.key === 'ArrowRight') this.go(this.index + 1);
    else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); this.advance(); }
    else if (ev.key === 'Escape') this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off('keydown', this.onKey);
    this.root.destroy();
    this.onClose();
  }
}
