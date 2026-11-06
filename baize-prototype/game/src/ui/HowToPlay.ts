// 玩法说明: a paged overlay any scene can open. Numbers come from data/, never literals, so the copy follows balance changes.
import Phaser from 'phaser';
import { defaultData } from '../core/data';
import { HERO_IDS } from '../core/heroes';
import { addImg } from './assets';
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
const realmAt = (n: number) => defaultData.blessings.realms.filter((r) => r.min <= n).pop()!.name;
const building = (lv: number) => defaultData.board.buildings[lv].name;

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

const PAGES: Page[] = [
  {
    title: `目标：率先修至 ${cfg.winCultivation} 点修为`,
    lines: [
      '你是踏入白泽秘境的散修，与另外三名修士同场争先。',
      `修为最先达到 ${cfg.winCultivation} 点，立即渡劫飞升，赢下这局。`,
      `第 ${cfg.rounds} 轮结束仍无人飞升，修为最高者胜；同分比总资产。`,
      '灵石用来买地、建洞府、交租；灵丹用来施符、突破。',
      `破产不出局：灵田全部收回，修为 −${cfg.bankrupt.cultivationLoss}。`,
    ],
    art: (s, cx, cy) => {
      const out: Obj[] = [addImg(s, cx, cy - 80, 'ic_cult').setScale(5)];
      const n = cfg.winCultivation;
      const cell = Math.floor(300 / n);
      const x0 = cx - (cell * n) / 2;
      for (let i = 0; i < n; i++) {
        out.push(s.add.rectangle(x0 + i * cell + cell / 2, cy + 40, cell - 4, 26, i < 3 ? COLORS.gold : COLORS.panelLight).setStrokeStyle(2, COLORS.outline));
      }
      for (const th of cfg.breakthroughThresholds) {
        out.push(txt(s, x0 + th * cell, cy + 72, realmAt(th), { size: 13, color: HEX.dim, origin: [0.5, 0.5] }));
      }
      out.push(txt(s, x0 + n * cell, cy + 6, `${n} 飞升`, { size: 15, bold: true, color: HEX.gold, origin: [1, 0.5] }));
      return out;
    },
  },
  {
    title: '一个回合怎么走',
    lines: [
      '① 掷骰前：可以先施放身法符、财运符。',
      `② 掷骰：两颗骰子的点数之和就是步数。`,
      `③ 移动：经过宗门山门 +${cfg.salaryPass} 灵石。走到山门时可以拐进神道，直通中央的白泽灵台。`,
      '④ 斗法与结算：可向途中遇到的一名修士斗法；无主灵田可以买下，别人的灵田要交租。',
      '⑤ 行动：升级一块自己的洞府（每回合 1 次）、施放符箓，然后结束回合。',
    ],
    art: (s, cx, cy) => [
      addImg(s, cx - 34, cy - 120, 'die_3').setScale(2),
      addImg(s, cx + 34, cy - 120, 'die_4').setScale(2),
      txt(s, cx, cy - 76, '3 + 4 = 走 7 步', { size: 14, color: HEX.gold, origin: [0.5, 0.5] }),
      ...chip(s, cx, cy - 30, '掷骰'),
      ...chip(s, cx, cy + 20, '移动'),
      ...chip(s, cx, cy + 70, '落点结算 · 买地 / 交租'),
      ...chip(s, cx, cy + 120, '行动 · 升级 / 出符'),
    ],
  },
  {
    title: '修为从哪里来',
    lines: [
      `筑府：洞府首次升到${Object.keys(cfg.cultivationOnBuild).map((lv) => building(Number(lv))).join('、')}，各 +1。`,
    ],
    art: (s, cx, cy) => [
      ...captioned(s, cx - 80, cy - 80, 'bld_4', 1.6, `建成${building(4)}`),
    ],
  },
  {
    title: '斗法',
    lines: [
      `移动后，可向落点或途中经过的一名修士发起斗法（每回合 1 次，本轮已被挑战者除外）。`,
      `双方各掷 1 颗骰，可各押至多 ${cfg.rules.duelMaxPills} 灵丹、每颗 +1 点；平局守方胜。败者交出 ${Math.round(cfg.rules.duelStealPct * 100)}% 灵石（至多 ${cfg.rules.duelStealMax}）。`,
    ],
    art: (s, cx, cy) => [
      addImg(s, cx - 60, cy - 60, 'por_sword').setScale(1.6),
      addImg(s, cx + 60, cy - 60, 'por_body').setScale(1.6),
      txt(s, cx, cy - 60, 'VS', { size: 22, bold: true, color: HEX.gold, origin: [0.5, 0.5] }),
      ...chip(s, cx, cy + 50, '1d6 + 灵丹 + 英雄加成'),
    ],
  },
  {
    title: '白泽灵台与突破',
    lines: [
      `修为每跨过 ${cfg.breakthroughThresholds.join(' / ')} 点，获得 1 次突破机会，可以累积。`,
      '在山门拐进神道（历练碑 → 灵泉），就能走到中央的白泽灵台。',
      '停在灵台三选一：突破（花灵丹）、静心（+1 灵丹并抽机缘）、离开。',
      `步数没走完时，也可以付 ${cfg.altarToll} 灵丹借道穿过灵台，但借道不能突破。`,
    ],
    art: (s, cx, cy) => [addImg(s, cx, cy - 20, 'altar').setScale(1.25)],
  },
  {
    title: '修士与操作',
    lines: [
      '每位修士有一个被动和一个技能，开局在选人页挑选。',
      `每人还有一个免费技能，用后冷却 ${cfg.rules.skillCooldownTurns} 个自己的回合，按 K 发动。`,
      `符箓施放要花灵丹，手牌上限 ${cfg.handLimit} 张；坊市可以买符。`,
      '鼠标悬停棋盘上的格子，可以查看它的详情。',
    ],
    art: (s, cx, cy) => {
      const out: Obj[] = HERO_IDS.map((h, i) => addImg(s, cx - 120 + i * 80, cy - 110, `por_${h}`).setScale(1.1));
      const keys: [string, string][] = [
        ['空格', '掷骰 / 确认'], ['B', '升级洞府'], ['C', '出符'], ['K', '发动技能'], ['Enter', '结束回合'],
        ['Esc', '取消'], ['F', '切换倍速'], ['S', '下载对局记录'],
      ];
      keys.forEach(([k, what], i) => {
        const y = cy - 40 + i * 30;
        out.push(s.add.rectangle(cx - 90, y, 66, 24, COLORS.parchment).setStrokeStyle(2, COLORS.outline));
        out.push(txt(s, cx - 90, y, k, { size: 13, bold: true, color: HEX.ink, origin: [0.5, 0.5] }));
        out.push(txt(s, cx - 46, y, what, { size: 14, origin: [0, 0.5] }));
      });
      return out;
    },
  },
];

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
