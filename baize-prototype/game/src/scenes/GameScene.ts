// Main board scene. Owns one engine `Game`, plays back its event log as
// animations, and routes each PendingChoice to either an AIController (after a
// short delay) or the human UI (buttons / modal / board clicks).
import Phaser from 'phaser';
import { AIController, DIFFICULTY_LABEL, PERSONALITY_LABEL } from '../ai/ai';
import type { PendingChoice } from '../core/choices';
import { defaultData } from '../core/data';
import { Game } from '../core/engine';
import type { GameEvent, GameEventType } from '../core/events';
import { toRecord, type GameRecord } from '../core/record';
import { countOwned, cultivation, nominalRent, realmName, totalAssets } from '../core/rules';
import { ALTAR } from '../core/board';
import type { GameState, NodeId } from '../core/types';
import { BoardView } from '../ui/BoardView';
import { ChoiceModal, type ModalOption, type ModalSpec } from '../ui/ChoiceModal';
import { Cutscene, type BannerSpec } from '../ui/Cutscene';
import { BOARD, STAGE, type Rect } from '../ui/layout';
import { LogPanel } from '../ui/LogPanel';
import { PlayerCards } from '../ui/PlayerCards';
import { downloadRecord, saveAutosave } from '../ui/saves';
import type { SessionConfig } from '../ui/session';
import { ActionDock } from '../ui/ActionDock';
import { COLORS, FS, HEX, PLAYER_COLORS, txt } from '../ui/theme';
import { tileTip } from '../ui/TileInfo';
import { Tooltip } from '../ui/Tooltip';
import { TopBar } from '../ui/TopBar';
import type { ResultData } from './ResultScene';

const SLOW_EVENTS = new Set<GameEvent['type']>([
  'buy', 'rent', 'upgrade', 'downgrade', 'ownerChange', 'divine', 'heaven', 'cult',
  'eruption', 'demonHit', 'demonGone', 'taskDone', 'event', 'cast', 'block', 'jail', 'veinLord',
  'bounty', 'trapSet', 'trap', 'skill', 'roadblock', 'roadblockHit', 'roadblockGone',
]);

/** preRoll / action option ids reached through the 出符 menu (C) rather than their own button. */
const isCastId = (id: string): boolean =>
  id.startsWith('cast:') || id.startsWith('trap:') || id === 'ult' || id === 'shrink' || id === 'skill';

/**
 * Animation budget per beat, in ms at 1×. The AI profile lands an AI turn at about 4–5 s; a human
 * seat's own turn runs slower still so its results can be read. `step` is one hop between cells,
 * `rollHold` how long the rolled pair stays up, `think` the pause before an AI answers.
 */
interface Pace {
  step: number;
  slide: number;
  teleport: number;
  roll: number;
  rollHold: number;
  demon: number;
  slow: number;
  turnStart: number;
  think: number;
  thinkModal: number;
}

const PACE: Record<'ai' | 'human', Pace> = {
  ai: { step: 200, slide: 400, teleport: 450, roll: 450, rollHold: 280, demon: 550, slow: 300, turnStart: 300, think: 80, thinkModal: 220 },
  human: { step: 240, slide: 480, teleport: 540, roll: 700, rollHold: 600, demon: 650, slow: 650, turnStart: 1100, think: 0, thinkModal: 0 },
};
const ROUND_WAIT = 700;
const CUTSCENE_MS = 1500;
const WIN_MS = 2000;
const SPEEDS = [0.5, 1, 2, 4];

/** Big events get a full-width cutscene banner. */
const CUTSCENES: Partial<Record<GameEventType, (g: Game, e: GameEvent) => BannerSpec>> = {
  breakthrough: (g, e) => ({ title: '破境！', sub: e.text, icon: portrait(g, e), color: COLORS.gold }),
  demonSpawn: (_g, e) => ({ title: '天魔降世', sub: e.text, icon: 'demon', color: 0xc04ad0 }),
  manifest: (_g, e) => ({ title: '白泽现世', sub: e.text, icon: 'baize', color: 0xe6e4f0 }),
  ult: (g, e) => {
    const p = g.state.players[e.player!];
    const ult = g.data.heroes.find((h) => h.id === p.hero)!.ult;
    return { title: `大招·${ult.name}`, sub: `${p.name}：${ult.desc}`, icon: portrait(g, e), color: PLAYER_COLORS[e.player!] };
  },
  duel: (g, e) => ({ title: '斗法', sub: e.text, icon: portrait(g, e), color: PLAYER_COLORS[e.player!] }),
  bankrupt: (g, e) => ({ title: '破产重整', sub: e.text, icon: portrait(g, e), color: COLORS.bad }),
  win: (g, e) => ({ title: g.state.endReason === 'cultivation' ? '渡劫飞升' : '夺得魁首', sub: e.text, icon: portrait(g, e), color: COLORS.gold }),
};

function portrait(g: Game, e: GameEvent): string {
  return `por_${g.state.players[e.player ?? 0].hero}`;
}

/** Resource deltas between two snapshots that float up from the token as "+200 灵石". */
const DELTAS: { label: string; color: [string, string]; of: (g: Game, st: GameState, seat: number) => number }[] = [
  { label: '灵石', color: [HEX.good, HEX.bad], of: (_g, st, i) => st.players[i].stones },
  { label: '灵丹', color: ['#F0A060', HEX.bad], of: (_g, st, i) => st.players[i].pills },
  { label: '修为', color: [HEX.gold, HEX.bad], of: (g, st, i) => cultivation(st, g.data, i) },
];

export class GameScene extends Phaser.Scene {
  private session!: SessionConfig;
  private engine!: Game;
  private ais: (AIController | null)[] = [];
  private boardView!: BoardView;
  private cards!: PlayerCards;
  private top!: TopBar;
  private side!: ActionDock;
  private tip!: Tooltip;
  private modal!: ChoiceModal;
  private logPanel!: LogPanel;
  private fx!: Cutscene;
  /** Last snapshot played back; resource popups are diffs against it. */
  private lastSnap: GameState | null = null;
  private queue: GameEvent[] = [];
  private speed = 1;
  private alive = false;
  private hovered: NodeId | null = null;
  private shownState!: GameState;
  /** Waiting for a human preRoll / action decision via the main buttons. */
  private mainChoice: PendingChoice | null = null;
  private mainResolve: ((id: string) => void) | null = null;
  /** Options of the open modal that map to board nodes (click-to-choose). */
  private nodeOptions = new Map<NodeId, string>();
  private toastText!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  create(session: SessionConfig): void {
    this.session = session;
    this.speed = session.speed || 1;
    this.alive = true;
    this.queue = [];
    this.mainChoice = null;
    this.mainResolve = null;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; this.game.scene.stop('Hud'); });
    this.cameras.main.setBackgroundColor(COLORS.bg);

    // Resuming replays the saved answers before any listener is attached, so nothing animates.
    this.engine = session.history
      ? Game.replay(session.setup, session.history, defaultData, { snapshots: true })
      : new Game(session.setup, defaultData, { snapshots: true });
    (window as unknown as { __baize: Game }).__baize = this.engine; // debugging handle
    this.ais = session.seats.map((s, i) => (s.human ? null : new AIController(this.engine, i, { difficulty: s.difficulty, personality: s.personality, seed: session.setup.seed })));
    const labels = session.seats.map((s) => (s.human ? '玩家' : `AI·${DIFFICULTY_LABEL[s.difficulty]}·${PERSONALITY_LABEL[s.personality]}`));

    // The board lives in this scene's world; every widget lives on the Hud overlay scene, whose camera
    // never scrolls or zooms, so the HUD stays put whatever this camera does.
    this.game.scene.start('Hud');
    const hud = this.scene.get('Hud');
    this.boardView = new BoardView(this, this.engine.board, session.setup.players.map((p) => p.hero));
    this.tip = new Tooltip(hud);
    this.top = new TopBar(hud, this.engine, this.tip);
    this.cards = new PlayerCards(hud, this.engine, labels, this.tip);
    this.side = new ActionDock(hud, this.engine, this.tip, session.seats.some((s) => s.human));
    this.modal = new ChoiceModal(hud);
    this.logPanel = new LogPanel(hud);
    this.fx = new Cutscene(hud);
    this.lastSnap = null;
    this.toastText = txt(hud, STAGE.cx, BOARD.y + BOARD.size - BOARD.cell - 18, '', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] }).setDepth(9000);

    this.side.btnSpeed.onClick(() => this.cycleSpeed());
    this.side.btnLog.onClick(() => this.logPanel.toggle());
    this.side.btnSave.onClick(() => this.saveRecord());
    this.side.btnRoll.onClick(() => this.mainAnswer('roll'));
    this.side.btnEnd.onClick(() => this.mainAnswer('end'));
    this.side.btnUpgrade.onClick(() => void this.openSubMenu('upgrade'));
    this.side.btnCast.onClick(() => void this.openSubMenu('cast'));
    this.side.onCardClick((card) => this.mainAnswer(`cast:${card}`));
    this.boardView.onHover((n) => { this.hovered = n; this.showTile(); });
    this.boardView.onClick((n) => this.nodeClicked(n));
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.setMainButtons(null);

    this.engine.onEvent((e) => this.queue.push(e));
    this.shownState = this.engine.state;
    if (session.history) this.showResumed();
    else this.engine.start();
    this.autosave();
    this.engine.state.players.forEach((p, i) => this.boardView.placeToken(i, p.pos));
    void this.loop();
  }

  // ------------------------------------------------------------ main loop

  private ms(base: number): number {
    return base / this.speed;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.time.delayedCall(ms, () => res()));
  }

  private async loop(): Promise<void> {
    while (this.alive) {
      await this.drain();
      if (!this.alive) return;
      this.renderAll(this.engine.state);
      if (this.engine.over) {
        await this.wait(500);
        if (this.alive) this.scene.start('Result', this.resultData());
        return;
      }
      const c = this.engine.pending!;
      const ai = this.ais[c.player];
      let id: string;
      if (ai) {
        await this.wait(this.ms(c.kind === 'preRoll' || c.kind === 'action' ? PACE.ai.think : PACE.ai.thinkModal));
        if (!this.alive) return;
        id = ai.decide(c);
      } else {
        id = await this.askHuman(c);
        if (!this.alive) return;
      }
      this.engine.answer(id);
      this.autosave();
    }
  }

  private record(): GameRecord {
    return toRecord(this.engine, this.session.seats);
  }

  private autosave(): void {
    if (!this.session.auto) saveAutosave(this.record());
  }

  /** State that normally arrives through events (battle log, 白泽 on the board) for a replayed game. */
  private showResumed(): void {
    const st = this.engine.state;
    for (const e of this.engine.log.slice(-3)) if (e.text) this.logPanel.log(e.text);
    this.logPanel.log(`—— 已恢复上局：第 ${st.round} 轮 ——`);
    if (st.manifested && st.round === this.engine.data.config.baizeManifestRound) this.boardView.showBaize(true);
  }

  private async drain(): Promise<void> {
    while (this.queue.length && this.alive) await this.playEvent(this.queue.shift()!);
  }

  private isHuman(seat: number): boolean {
    return this.ais[seat] === null;
  }

  private async playEvent(e: GameEvent): Promise<void> {
    if (e.text) this.logPanel.log(e.text);
    const seat = e.player ?? 0;
    const pace = PACE[this.isHuman(e.snap?.current ?? this.engine.state.current) ? 'human' : 'ai'];
    if (e.snap && (e.type === 'step' || e.type === 'slide' || e.type === 'teleport')) this.boardView.markCurrent(e.snap);
    switch (e.type) {
      case 'step':
        await this.boardView.moveToken(seat, e.node!, this.ms(pace.step));
        break;
      case 'slide':
        await this.boardView.moveToken(seat, e.node!, this.ms(pace.slide), false);
        break;
      case 'teleport':
        await this.boardView.moveToken(seat, e.node!, this.ms(pace.teleport), false);
        break;
      case 'roll':
        if (e.dice) {
          await Promise.all([this.fx.rollDice(e.dice, this.ms(pace.roll), this.ms(pace.rollHold)), this.side.shakeDice(this.ms(pace.roll))]);
          this.side.setDice(e.dice);
        }
        break;
      case 'demonMove':
        await this.boardView.moveDemon(e.from, e.node!, this.ms(pace.demon));
        break;
      case 'demonSpawn':
        await Promise.all([this.cutscene(e), this.boardView.moveDemon(undefined, e.node!, this.ms(pace.demon))]);
        break;
      case 'manifest':
        this.boardView.showBaize(true);
        await this.cutscene(e);
        break;
      case 'roundStart':
        if (e.snap && e.snap.round !== this.engine.data.config.baizeManifestRound) this.boardView.showBaize(false);
        if (e.snap) this.roundRibbon(e.snap);
        await this.wait(this.ms(ROUND_WAIT));
        break;
      case 'turnStart':
        if (e.snap) await this.turnIntro(e.snap, seat);
        break;
      default:
        if (CUTSCENES[e.type]) await this.cutscene(e);
        else if (SLOW_EVENTS.has(e.type)) await this.wait(this.ms(pace.slow));
    }
    if (e.snap) {
      this.popDeltas(e.snap);
      this.renderAll(e.snap, false);
    }
  }

  private cutscene(e: GameEvent): Promise<void> {
    return this.fx.banner(CUTSCENES[e.type]!(this.engine, e), this.ms(e.type === 'win' ? WIN_MS : CUTSCENE_MS));
  }

  private roundRibbon(st: GameState): void {
    const cfg = this.engine.data.config;
    const left = cfg.baizeManifestRound - st.round;
    const sub = st.round === cfg.rounds ? '最终轮！修为最高者将夺得魁首'
      : left > 0 ? `白泽现世还有 ${left} 轮` : `修为先到 ${cfg.winCultivation} 即胜`;
    this.fx.ribbon(`第 ${st.round} / ${cfg.rounds} 轮`, sub, COLORS.gold, STAGE.cy, this.ms(1400));
  }

  /** AI turns get a quick ribbon; a human seat's turn gets a full "轮到你了" moment. */
  private async turnIntro(st: GameState, seat: number): Promise<void> {
    this.renderAll(st, false);
    const p = st.players[seat];
    if (!this.isHuman(seat)) {
      this.fx.ribbon(`${p.name} 的回合`, '', PLAYER_COLORS[seat], STAGE.turnRibbonY, this.ms(PACE.ai.turnStart + 400));
      await this.wait(this.ms(PACE.ai.turnStart));
      return;
    }
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    await this.fx.banner({
      title: multiHuman ? `轮到 ${p.name}` : '轮到你了！',
      sub: `${p.name} · 第 ${st.round} 轮 · 按空格掷骰，或先升级、出符`,
      icon: `por_${p.hero}`, color: PLAYER_COLORS[seat],
    }, this.ms(PACE.human.turnStart));
  }

  /** Float each seat's 灵石 / 灵丹 / 修为 change since the last snapshot over its token. */
  private popDeltas(snap: GameState): void {
    const prev = this.lastSnap;
    this.lastSnap = snap;
    if (!prev) return;
    snap.players.forEach((_, i) => {
      let k = 0;
      for (const d of DELTAS) {
        const diff = d.of(this.engine, snap, i) - d.of(this.engine, prev, i);
        if (diff === 0) continue;
        this.boardView.floatText(i, `${diff > 0 ? '+' : '−'}${Math.abs(diff)} ${d.label}`, d.color[diff > 0 ? 0 : 1], k++ * this.ms(200));
      }
    });
  }

  private renderAll(state: GameState, syncTokens = true): void {
    this.shownState = state;
    this.boardView.render(state);
    if (syncTokens) this.boardView.syncTokens(state);
    this.cards.render(state, this.handViewer(state));
    this.top.render(state);
    this.side.setTurn(state, this.isHuman(state.current));
    this.side.btnSpeed.setLabel(`倍速 ×${this.speed} · F`);
    this.showTile();
    this.side.renderHand(state, this.handViewer(state));
  }

  /** Hand is only visible to a human, on their own turn (or when they must react). */
  private handViewer(state: GameState): number | null {
    const pending = this.engine.pending;
    if (pending && !this.ais[pending.player]) return pending.player;
    if (!this.ais[state.current]) return state.current;
    return null;
  }

  private resultData(): ResultData {
    const g = this.engine;
    const st = g.state;
    return {
      record: this.record(),
      state: structuredClone(st),
      ranking: g.ranking(),
      rows: st.players.map((_, i) => {
        const c = cultivation(st, g.data, i);
        const s = this.session.seats[i];
        return {
          cult: c, realm: realmName(g.data, c), assets: totalAssets(st, g.board, g.data, i),
          label: s.human ? '玩家' : `AI·${PERSONALITY_LABEL[s.personality]}`,
        };
      }),
    };
  }

  // -------------------------------------------------------------- humans

  private askHuman(c: PendingChoice): Promise<string> {
    if (c.kind === 'preRoll' || c.kind === 'action') {
      this.mainChoice = c;
      this.setMainButtons(c);
      return new Promise((res) => { this.mainResolve = res; });
    }
    return this.modalChoice(c);
  }

  private setMainButtons(c: PendingChoice | null): void {
    const ids = c ? c.options.map((o) => o.id) : [];
    this.side.btnRoll.setEnabled(ids.includes('roll'));
    this.side.setRollWaiting(ids.includes('roll'));
    this.side.btnEnd.setEnabled(ids.includes('end'));
    this.side.btnUpgrade.setEnabled(ids.some((i) => i.startsWith('upgrade:')));
    this.side.btnCast.setEnabled(ids.some(isCastId));
    this.side.setCastable(ids.filter((i) => i.startsWith('cast:')).map((i) => i.slice(5)));
    this.side.renderHand(this.shownState ?? this.engine.state, this.handViewer(this.engine.state));
  }

  private mainAnswer(id: string): void {
    const c = this.mainChoice;
    if (!c || !this.mainResolve || !c.options.some((o) => o.id === id)) return;
    if (this.modal.isOpen) this.modal.close(null);
    const res = this.mainResolve;
    this.mainChoice = null;
    this.mainResolve = null;
    this.setMainButtons(null);
    this.boardView.setClickable([]);
    this.nodeOptions.clear();
    res(id);
  }

  /** 升级 / 出符 sub-menus built from the current preRoll / action options. */
  private async openSubMenu(which: 'upgrade' | 'cast'): Promise<void> {
    const c = this.mainChoice;
    if (!c) return;
    const opts = c.options.filter((o) => which === 'upgrade' ? o.id.startsWith('upgrade:') : isCastId(o.id));
    if (opts.length === 0) return;
    this.nodeOptions.clear();
    for (const o of opts) if (o.node) this.nodeOptions.set(o.node, o.id);
    this.boardView.setClickable([...this.nodeOptions.keys()]);
    const id = await this.modal.open({
      title: which === 'upgrade' ? '升级洞府（每回合 1 次）' : '符箓 / 大招 / 神通 / 技能 / 禁制',
      options: opts.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
      closable: true, cancelId: null, placement: which === 'upgrade' ? 'side' : 'center', avoid: this.tokenScreenRect(c.player),
    });
    this.boardView.setClickable([]);
    this.nodeOptions.clear();
    if (id) this.mainAnswer(id);
  }

  private async modalChoice(c: PendingChoice): Promise<string> {
    const g = this.engine;
    this.nodeOptions.clear();
    for (const o of c.options) if (o.node && !this.nodeOptions.has(o.node)) this.nodeOptions.set(o.node, o.id);
    if (c.kind === 'exitRoad' || c.kind === 'altarPass') {
      for (const o of c.options) if (o.id !== 'stop') this.nodeOptions.set(g.board.corridorEnd(ALTAR, o.id), o.id);
    }
    this.boardView.setClickable([...this.nodeOptions.keys()]);
    const p = g.state.players[c.player];
    let desc = c.desc ?? '';
    if (this.nodeOptions.size > 9) desc += '\n也可直接点击棋盘上高亮的格子';
    if (c.kind === 'heavenPick') this.cards.render({ ...this.shownState, current: c.player }, c.player);
    let preview: ModalSpec['preview'];
    if (c.kind === 'rentReact') desc += `（可用避劫符 ${p.hand.filter((x) => x === 'evade').length} 张）`;
    if (c.kind === 'guardReact') desc += `（可用金光符 ${p.hand.filter((x) => x === 'goldlight').length} 张）`;
    if (c.kind === 'buy' && c.ctx.node) {
      const n = g.board.node(c.ctx.node);
      const region = n.region!;
      const mine = countOwned(g.state, g.board, c.player, region);
      const others = Math.max(...g.state.players.filter((o) => o.seat !== c.player).map((o) => countOwned(g.state, g.board, o.seat, region)));
      const lines = [desc, `基础租金 ${nominalRent(g.data, n.price!, 0)} 灵石 · 本域已占 ${mine}/5`];
      if (mine + 1 >= g.data.config.veinLordMinLands && mine + 1 > others && g.state.veinLords[region] !== c.player) {
        lines.push(`买下即成为${g.data.board.regions[region].name}灵脉之主 · 修为 +${g.data.config.veinLordCultivation}`);
      }
      if (mine + 1 === g.board.landsInRegion(region).length) lines.push('买下即一域独占 · 租金 ×2');
      desc = lines.join('\n');
      preview = { tile: `tile_land_${region}`, obj: `decor_${region}` };
    }
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    const title = multiHuman || c.kind === 'heavenPick' ? `${p.name} · ${c.title}` : c.title;
    const cards = c.kind === 'divinePick' || c.kind === 'heavenPick';
    const options: ModalOption[] = c.options.map((o) => ({
      id: o.id, label: o.label, hint: o.hint,
      icon: c.kind === 'divinePick' ? `div_${o.value}` : c.kind === 'heavenPick' ? `hv_${o.value}` : undefined,
    }));
    const id = await this.modal.open({
      title, desc: desc || undefined, options, defaultId: c.defaultId, cancelId: c.cancelId, preview,
      placement: this.nodeOptions.size >= 2 ? 'side' : 'center',
      layout: cards ? 'cards' : 'list',
      cardFrame: c.kind === 'heavenPick' ? 'card_heaven' : 'card_divine',
      cardLabel: c.kind === 'heavenPick' ? '天赐' : '神通',
      numbered: c.kind !== 'rollValue',
      avoid: this.tokenScreenRect(c.player),
    });
    this.boardView.setClickable([]);
    this.nodeOptions.clear();
    return id ?? c.cancelId ?? c.defaultId ?? c.options[0].id;
  }

  private nodeClicked(n: NodeId): void {
    const id = this.nodeOptions.get(n);
    if (!id) {
      this.tip.toggle(`tile:${n}`, this.toScreen(this.boardView.nodeRect(n)), tileTip(this.engine, this.shownState, n));
      return;
    }
    if (this.mainChoice) this.mainAnswer(id);
    else if (this.modal.isOpen) this.modal.close(id);
  }

  /** Hovered tile's popover; a pinned tile popover follows the latest state. */
  private showTile(): void {
    const pinned = this.tip.pinned;
    if (pinned?.startsWith('tile:')) {
      const n = pinned.slice(5) as NodeId;
      this.tip.unpin();
      this.tip.toggle(pinned, this.toScreen(this.boardView.nodeRect(n)), tileTip(this.engine, this.shownState, n));
      return;
    }
    if (this.hovered === null) this.tip.hide();
    else this.tip.show(this.toScreen(this.boardView.nodeRect(this.hovered)), tileTip(this.engine, this.shownState, this.hovered));
  }

  /** Board (world) rect to HUD (screen) coordinates through this scene's camera. */
  private toScreen(r: Rect): Rect {
    const cam = this.cameras.main;
    return { x: (r.x - cam.worldView.x) * cam.zoom, y: (r.y - cam.worldView.y) * cam.zoom, w: r.w * cam.zoom, h: r.h * cam.zoom };
  }

  private tokenScreenRect(seat: number): Rect {
    return this.toScreen(this.boardView.tokenRect(seat));
  }

  private toast(s: string): void {
    this.toastText.setText(s).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1600, duration: 600 });
  }

  private cycleSpeed(): void {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
    this.side.btnSpeed.setLabel(`倍速 ×${this.speed} · F`);
    this.toast(`速度 ${this.speed}×`);
  }

  private saveRecord(): void {
    downloadRecord(this.record());
    this.toast('已下载对局记录');
  }

  private onKey(ev: KeyboardEvent): void {
    const k = ev.key;
    if (k === 'f' || k === 'F') { this.cycleSpeed(); return; }
    if (k === 'l' || k === 'L') { this.logPanel.toggle(); return; }
    if (k === 'Escape' && this.logPanel.isOpen) { this.logPanel.toggle(false); return; }
    if (k === 'Escape' && this.tip.pinned && !this.modal.isOpen) { this.tip.unpin(); return; }
    if (this.modal.isOpen) {
      const key = k === ' ' ? 'SPACE' : k === 'Escape' ? 'ESC' : k === 'Enter' ? 'SPACE' : k;
      if (this.modal.handleKey(key)) ev.preventDefault();
      return;
    }
    if (k === 's' || k === 'S') { this.saveRecord(); return; }
    if (!this.mainChoice) return;
    if (k === ' ') { ev.preventDefault(); this.mainAnswer('roll'); }
    else if (k === 'Enter') this.mainAnswer('end');
    else if (k === 'b' || k === 'B') void this.openSubMenu('upgrade');
    else if (k === 'c' || k === 'C') void this.openSubMenu('cast');
    else if (k === 'k' || k === 'K') this.mainAnswer('skill');
  }
}
