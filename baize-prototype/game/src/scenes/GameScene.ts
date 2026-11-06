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
import { isGlowing } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import { BoardCamera } from '../ui/BoardCamera';
import { BoardPick } from '../ui/BoardPick';
import { BoardView } from '../ui/BoardView';
import { Breakthrough } from '../ui/Breakthrough';
import { breakthroughView } from '../ui/breakthroughView';
import { ChoiceModal } from '../ui/ChoiceModal';
import { onlyAnswer, presentChoice } from '../ui/choices/registry';
import { Coach, coachHudRect } from '../ui/Coach';
import { COACH_STEPS, coachCopy, dismiss, emptyBook, nudge, observe, type CoachBook, type CoachCue, type CoachMoment } from '../ui/coachTriggers';
import { Cutscene, type BannerSpec } from '../ui/Cutscene';
import { dockPlan, IDLE_PLAN, type DockPlan } from '../ui/dockPlan';
import { LEFT, RACE, RIGHT, STAGE, W, type Rect } from '../ui/layout';
import { LogPanel } from '../ui/LogPanel';
import { playMiniGame } from '../ui/MiniGame';
import { AI_TURN, breakthroughBeats, HUMAN_INTRO, nextSpeed, PACE, PAUSE_EVENTS, speedNote, tempoOf, type Pace } from '../ui/pacing';
import { aiTurnNarration, heroNameForSeat, narrateEvent, resumeNarration, roundNarration, turnNarration } from '../ui/narration';
import { pickPlan, ROUTE_KINDS, type PickCell, type PickPlan } from '../ui/pickPlan';
import { PlayerCards } from '../ui/PlayerCards';
import { RealmRace } from '../ui/RealmRace';
import { resultView } from '../ui/resultReadout';
import { downloadRecord, loadCoach, saveAutosave, saveCoach } from '../ui/saves';
import type { SessionConfig } from '../ui/session';
import { ActionDock } from '../ui/ActionDock';
import { COLORS, FS, HEX, PLAYER_COLORS, txt } from '../ui/theme';
import { HOVER_IDLE_MS, hoverTipOpen } from '../ui/hoverTip';
import { tileTip } from '../ui/TileInfo';
import { Tooltip } from '../ui/Tooltip';
import { TopBar } from '../ui/TopBar';
import { Button } from '../ui/widgets';
import { unionRect } from '../ui/world';
import type { ResultData } from './ResultScene';

/** preRoll / action option ids reached through the 出符 menu (C) rather than their own button. */
const isCastId = (id: string): boolean =>
  id.startsWith('cast:') || id === 'skill' || id === 'brew';

/** Round ribbon lifetime. The turn banner starts only after this, so the two never share the board. */
const ROUND_RIBBON_MS = 1000;
const WIN_MS = 2000;

/** Big events get a full-width cutscene banner; a null spec means this instance is not big. */
const CUTSCENES: Partial<Record<GameEventType, (g: Game, e: GameEvent) => BannerSpec | null>> = {
  manifest: (g, e) => ({ title: '白泽现世', sub: narrateEvent(g, e) ?? '', icon: 'baize', color: 0xe6e4f0, dim: true }),
  duel: (g, e) => ({ title: '斗法', sub: narrateEvent(g, e) ?? '', icon: portrait(g, e), color: PLAYER_COLORS[e.player!] }),
  bankrupt: (g, e) => ({ title: '破产重整', sub: narrateEvent(g, e) ?? '', icon: portrait(g, e), color: COLORS.bad }),
  win: (g, e) => ({ title: g.state.endReason === 'ascend' ? '渡劫化神' : '秘境关闭', sub: narrateEvent(g, e) ?? '', icon: portrait(g, e), color: COLORS.gold, dim: true }),
};

/** Smaller beats get a non-blocking ribbon under the top bar. */
const RIBBONS: Partial<Record<GameEventType, (g: Game, e: GameEvent) => { title: string; color: number } | null>> = {
};

/** Sub-menu answer meaning "re-open narrowed to this tile". */
const NARROW = '@node:';

function portrait(g: Game, e: GameEvent): string {
  return `por_${g.state.players[e.player ?? 0].hero}`;
}

/** Resource deltas between two snapshots that float up from the token as "+200 灵石". */
const DELTAS: { label: string; color: [string, string]; of: (g: Game, st: GameState, seat: number) => number }[] = [
  { label: '灵石', color: [HEX.good, HEX.bad], of: (_g, st, i) => st.players[i].stones },
  { label: '丹药', color: ['#F0A060', HEX.bad], of: (_g, st, i) => st.players[i].pills },
  { label: '灵草', color: [HEX.good, HEX.bad], of: (_g, st, i) => st.players[i].herbs },
  { label: '修为', color: [HEX.gold, HEX.bad], of: (_g, st, i) => st.players[i].cult },
];

export class GameScene extends Phaser.Scene {
  private session!: SessionConfig;
  private engine!: Game;
  private ais: (AIController | null)[] = [];
  private humans = new Set<number>();
  private boardView!: BoardView;
  private cards!: PlayerCards;
  private top!: TopBar;
  private side!: ActionDock;
  private tip!: Tooltip;
  private modal!: ChoiceModal;
  private logPanel!: LogPanel;
  private fx!: Cutscene;
  private breakthrough!: Breakthrough;
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
  /** Options of the open modal that map to board nodes (click-to-choose); a node may carry several. */
  private nodeOptions = new Map<NodeId, string[]>();
  private hud!: Phaser.Scene;
  /** A human just played this mini-game for real, so its result event needs no watch replay. */
  private playedMini = false;
  private toastText!: Phaser.GameObjects.Text;
  private cam!: BoardCamera;
  private race!: RealmRace;
  private btnRecentre!: Button;
  /** Tile the current press started on, unless that press only closed its own pinned popover. */
  private pressed: NodeId | null = null;
  /** The camera moved since tile popovers were last placed. */
  private camMoving = false;
  /** The camera has moved since the pointer last moved, so a resting hover must not come back. */
  private cameraSincePointer = false;
  private pointerAt = { x: Number.NaN, y: Number.NaN };
  private pointerIdleMs = 0;
  private modalWasOpen = false;
  private coach!: Coach;
  private coachBook: CoachBook = emptyBook();
  private coachArmed = true;
  /** Screen rect of a coach bubble that should not also click the board underneath. */
  private coachBlock: Rect | null = null;
  private shownPlan: DockPlan = IDLE_PLAN;
  private pick!: BoardPick;
  /** A spatial ask waiting on a board click or a number key. */
  private picking: { plan: PickPlan; resolve: (id: string) => void } | null = null;
  /** Fork / altar answers still owed by the landing the human picked; they answer themselves. */
  private route: string[] = [];

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
    this.picking = null;
    this.route = [];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; this.game.scene.stop('Hud'); });
    this.cameras.main.setBackgroundColor(COLORS.bg);

    // Resuming replays the saved answers before any listener is attached, so nothing animates.
    this.engine = session.history
      ? Game.replay(session.setup, session.history, defaultData, { snapshots: true })
      : new Game(session.setup, defaultData, { snapshots: true });
    (window as unknown as { __baize: Game }).__baize = this.engine; // debugging handle
    this.ais = session.seats.map((s, i) => (s.human ? null : new AIController(this.engine, i, { difficulty: s.difficulty, personality: s.personality, seed: session.setup.seed })));
    this.humans = new Set(session.seats.flatMap((s, i) => (s.human ? [i] : [])));
    const labels = session.seats.map((s) => (s.human ? '玩家' : `AI·${DIFFICULTY_LABEL[s.difficulty]}·${PERSONALITY_LABEL[s.personality]}`));

    // The board lives in this scene's world; every widget lives on the Hud overlay scene, whose camera
    // never scrolls or zooms, so the HUD stays put whatever this camera does.
    this.game.scene.start('Hud');
    const hud = this.scene.get('Hud');
    this.hud = hud;
    this.playedMini = false;
    this.boardView = new BoardView(this, this.engine.board, session.setup.players.map((p) => p.hero));
    this.pick = new BoardPick(this, this.boardView.world);
    this.cam = new BoardCamera(this, this.boardView.world, (seat) => this.boardView.tokenFocus(seat), () => this.speed);
    this.tip = new Tooltip(hud);
    this.top = new TopBar(hud, this.engine, this.tip);
    this.cards = new PlayerCards(hud, this.engine, labels, this.humans, this.tip);
    this.side = new ActionDock(hud, this.engine, this.tip, session.seats.some((s) => s.human));
    this.modal = new ChoiceModal(hud);
    this.logPanel = new LogPanel(hud);
    this.fx = new Cutscene(hud);
    this.breakthrough = new Breakthrough(hud);
    this.lastSnap = null;
    this.race = new RealmRace(hud, this.engine, this.tip);
    this.btnRecentre = new Button(hud, RIGHT.x, RACE.y + RACE.h + RACE.gap, { w: RIGHT.w, h: RACE.btnH, label: '回到棋子 · H', size: FS.sm });
    this.btnRecentre.onClick(() => this.recentre());
    this.cam.onManual(() => {
      if (this.tip.pinned?.startsWith('tile:')) this.tip.unpin();
      else this.tip.hide();
    });
    this.toastText = txt(hud, STAGE.cx, STAGE.toastY, '', { size: FS.lg, bold: true, color: HEX.gold, stroke: HEX.ink, origin: [0.5, 0.5] }).setDepth(9000);

    this.side.btnSpeed.onClick(() => this.cycleSpeed());
    this.side.btnLog.onClick(() => this.logPanel.toggle());
    this.side.btnSave.onClick(() => this.saveRecord());
    this.side.btnRoll.onClick(() => this.mainAnswer('roll'));
    this.side.btnEnd.onClick(() => this.mainAnswer('end'));
    this.side.btnCast.onClick(() => void this.openSubMenu('cast'));
    this.side.onOffer((id) => this.mainAnswer(id));
    this.side.onMore(() => void this.openSubMenu('upgrade'));
    this.side.onCardClick((card) => this.mainAnswer(`cast:${card}`));
    const coachSave = loadCoach();
    this.coachArmed = coachSave.armed;
    this.coachBook = emptyBook(coachSave.seen);
    this.coach = new Coach(hud);
    const dismissBubble = () => {
      if (!this.coach.isOpen) return;
      this.coachBlock = this.coach.rect();
      this.dismissCoach();
    };
    const clearBlock = () => { this.coachBlock = null; };
    this.input.on('pointerdown', dismissBubble);
    hud.input.on('pointerdown', dismissBubble);
    this.input.on('pointerup', clearBlock);
    hud.input.on('pointerup', clearBlock);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', dismissBubble);
      hud.input.off('pointerdown', dismissBubble);
      this.input.off('pointerup', clearBlock);
      hud.input.off('pointerup', clearBlock);
    });
    this.boardView.onHover((n) => { this.hovered = n; this.showTile(); });
    this.input.on('gameout', () => { this.hovered = null; this.showTile(); });
    this.boardView.onPress((n) => {
      if (this.overCoach()) { this.pressed = null; return; }
      this.pressed = this.tip.justClosed(`tile:${n}`) ? null : n;
    });
    this.boardView.onClick((n) => { if (n === this.pressed && !this.cam.dragged) this.nodeClicked(n); });
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.setMainButtons(null);

    this.engine.onEvent((e) => this.queue.push(e));
    this.shownState = this.engine.state;
    if (session.history) this.showResumed();
    else this.engine.start();
    this.autosave();
    this.engine.state.players.forEach((p, i) => this.boardView.placeToken(i, p.pos));
    this.cam.recentre(this.engine.state.current, true);
    void this.loop();
  }

  update(_time: number, delta: number): void {
    if (!this.alive) return;
    this.trackHover(delta);
    this.btnRecentre.setVisible(this.cam.visibleRect().w < W);
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
        await this.wait(this.ms(c.kind === 'preRoll' || c.kind === 'action' ? AI_TURN.think : AI_TURN.thinkModal));
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
    for (const e of this.engine.log.slice(-3)) {
      const line = narrateEvent(this.engine, e);
      if (line) this.logPanel.log(line);
    }
    this.logPanel.log(resumeNarration(st.round));
    if (st.manifested && st.round === this.engine.data.config.manifest.round) this.boardView.showBaize(true);
  }

  private async drain(): Promise<void> {
    while (this.queue.length && this.alive) await this.playEvent(this.queue.shift()!);
  }

  private isHuman(seat: number): boolean {
    return this.ais[seat] === null;
  }

  private async playEvent(e: GameEvent): Promise<void> {
    const line = narrateEvent(this.engine, e);
    if (line) this.logPanel.log(line);
    const seat = e.player ?? 0;
    const tempo = tempoOf(e, this.lastSnap, this.humans);
    const pace = PACE[tempo];
    if (e.snap && (e.type === 'step' || e.type === 'teleport')) this.boardView.markCurrent(e.snap);
    switch (e.type) {
      case 'step':
        this.cam.follow(seat);
        await this.boardView.moveToken(seat, e.node!, this.ms(pace.step));
        break;
      case 'teleport':
        if (e.from && e.from !== e.node) this.cam.frameTeleport(unionRect([this.boardView.nodeRect(e.from), this.boardView.nodeRect(e.node!)]), seat);
        else this.cam.follow(seat);
        await this.boardView.moveToken(seat, e.node!, this.ms(pace.teleport), false);
        this.cam.release();
        break;
      case 'roll':
        if (e.dice) {
          await Promise.all([this.fx.rollDice(e.dice, this.ms(pace.roll), this.ms(pace.rollHold)), this.side.shakeDice(this.ms(pace.roll))]);
          this.side.setDice(e.dice);
        }
        break;
      case 'manifest':
        this.boardView.showBaize(true);
        await this.present(e, pace);
        break;
      case 'breakthrough':
        this.cam.follow(seat);
        await this.breakthrough.play(breakthroughView(this.engine, e), breakthroughBeats(this.isHuman(seat), this.speed));
        break;
      case 'roundStart':
        if (e.snap && e.snap.round !== this.engine.data.config.manifest.round) this.boardView.showBaize(false);
        if (e.snap) this.roundRibbon(e.snap);
        await this.wait(this.ms(ROUND_RIBBON_MS) + 40);
        break;
      case 'turnStart':
        this.cam.recentre(seat);
        if (e.snap) await this.turnIntro(e.snap, seat);
        break;
      case 'miniGame':
        if (this.playedMini || tempo === 'skim') {
          this.playedMini = false;
          await this.wait(this.ms(pace.pause));
        } else {
          const p = (e.snap ?? this.engine.state).players[seat];
          await playMiniGame(this.hud, { auto: e.miniGame!.tier, speed: this.speed, who: p.name });
        }
        break;
      default:
        await this.present(e, pace);
    }
    if (e.snap) {
      this.popDeltas(e.snap);
      this.renderAll(e.snap, false);
    }
    this.noteCoach(this.momentFromEvent(e));
  }

  /** The generic beat for an event: its cutscene banner, else its ribbon, else a pause if it is a slow one. */
  private async present(e: GameEvent, pace: Pace): Promise<void> {
    const banner = CUTSCENES[e.type]?.(this.engine, e);
    if (banner) {
      await this.fx.banner(banner, this.ms(e.type === 'win' ? WIN_MS : pace.banner));
      return;
    }
    const rib = RIBBONS[e.type]?.(this.engine, e);
    if (rib) {
      this.fx.ribbon(rib.title, narrateEvent(this.engine, e) ?? '', rib.color, STAGE.turnRibbonY, this.ms(pace.pause * 2 + 400));
      await this.wait(this.ms(pace.pause));
    } else if (PAUSE_EVENTS.has(e.type)) {
      await this.wait(this.ms(pace.pause));
    }
  }

  private roundRibbon(st: GameState): void {
    const copy = roundNarration(this.engine, st);
    this.fx.ribbon(copy.title, copy.sub, COLORS.gold, STAGE.cy, this.ms(ROUND_RIBBON_MS));
  }

  /** AI turns get a quick ribbon; a human seat's turn gets a full "轮到你了" moment. */
  private async turnIntro(st: GameState, seat: number): Promise<void> {
    this.renderAll(st, false);
    const p = st.players[seat];
    const name = heroNameForSeat(this.engine, seat);
    if (!this.isHuman(seat)) {
      this.fx.ribbon(aiTurnNarration(name), '', PLAYER_COLORS[seat], STAGE.turnRibbonY, this.ms(AI_TURN.intro + 400));
      await this.wait(this.ms(AI_TURN.intro));
      return;
    }
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    const copy = turnNarration(name, st.round, multiHuman);
    // Not awaited: the banner tells the player to press Space, so the roll has to be live while it shows.
    void this.fx.banner({
      title: copy.title,
      sub: copy.sub,
      icon: `por_${p.hero}`, color: PLAYER_COLORS[seat],
    }, this.ms(HUMAN_INTRO));
  }

  /** Float each seat's 灵石 / 丹药 / 灵草 / 修为 change since the last snapshot over its token. */
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
    this.cards.render(state);
    this.top.render(state);
    this.side.setTurn(state, this.isHuman(state.current));
    this.side.btnSpeed.setLabel(`倍速 ×${this.speed} · F`);
    this.showTile();
    this.side.renderHand(state, this.handViewer(state));
    this.race.render(state);
  }

  /** Hand is only visible to a human, on their own turn (or when they must react). */
  private handViewer(state: GameState): number | null {
    const pending = this.engine.pending;
    if (pending && !this.ais[pending.player]) return pending.player;
    if (!this.ais[state.current]) return state.current;
    return null;
  }

  private resultData(): ResultData {
    return { record: this.record(), view: resultView(this.engine, this.session.seats) };
  }

  // -------------------------------------------------------------- humans

  private askHuman(c: PendingChoice): Promise<string> {
    const routed = this.followRoute(c);
    if (routed) return Promise.resolve(routed);
    if (c.kind === 'preRoll' || c.kind === 'action') {
      this.mainChoice = c;
      this.setMainButtons(c);
      this.noteCoach(this.momentFromChoice(c));
      return new Promise((res) => { this.mainResolve = res; });
    }
    if (c.kind === 'miniGame') return this.playHumanMini(c);
    const only = onlyAnswer(c);
    if (only) return Promise.resolve(only);
    this.noteCoach(this.momentFromChoice(c));
    const plan = pickPlan(this.engine, c);
    return plan ? this.boardChoice(c, plan) : this.modalChoice(c);
  }

  /** The next answer the picked landing already settled, if this ask is the one it was for. */
  private followRoute(c: PendingChoice): string | null {
    const next = this.route.shift();
    if (next && ROUTE_KINDS.includes(c.kind) && c.options.some((o) => o.id === next)) return next;
    this.route = [];
    return null;
  }

  /** A spatial ask answered on the board: the landing cells lit and numbered, the dock saying what they mean. */
  private boardChoice(c: PendingChoice, plan: PickPlan): Promise<string> {
    if (plan.cells.length === 1 && !plan.asksLater) return Promise.resolve(this.takeRoute(plan.cells[0]));
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    this.side.setPick(multiHuman ? `${this.engine.state.players[c.player].name} · ${plan.hint}` : plan.hint);
    this.setNodeOptions(plan.cells);
    this.boardView.setClickable(plan.cells.map((cell) => cell.node));
    this.pick.show(plan.cells);
    this.frameTargets(c.player);
    return new Promise((resolve) => { this.picking = { plan, resolve }; });
  }

  private answerPick(cell: PickCell): void {
    const p = this.picking;
    if (!p) return;
    this.picking = null;
    this.pick.clear();
    this.setMainButtons(null);
    this.cam.release();
    p.resolve(this.takeRoute(cell));
  }

  private takeRoute(cell: PickCell): string {
    this.route = [...cell.route];
    return cell.id;
  }

  private pickKey(k: string, ev: KeyboardEvent): void {
    const cells = this.picking!.plan.cells;
    const cell = k === ' ' || k === 'Enter' ? cells.find((x) => x.primary) : cells.find((x) => x.key === k);
    if (!cell) return;
    ev.preventDefault();
    this.answerPick(cell);
  }

  /** §18.5 The human plays the alchemy overlay; its tier is the answer. */
  private async playHumanMini(c: Extract<PendingChoice, { kind: 'miniGame' }>): Promise<string> {
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    const tier = await playMiniGame(this.hud, { who: multiHuman ? this.engine.state.players[c.player].name : undefined });
    this.playedMini = true;
    return c.options.some((o) => o.id === tier) ? tier : c.options[0].id;
  }

  private setMainButtons(c: PendingChoice | null): void {
    const choice = c && (c.kind === 'preRoll' || c.kind === 'action') ? c : null;
    const plan = dockPlan(this.engine, choice);
    this.shownPlan = plan;
    this.side.setPlan(plan);
    const ids = choice ? choice.options.map((o) => o.id) : [];
    this.side.setCastable(ids.filter((i) => i.startsWith('cast:')).map((i) => i.slice(5)));
    this.side.setRollWaiting(plan.roll);
    this.side.renderHand(this.shownState ?? this.engine.state, this.handViewer(this.engine.state));
    this.setNodeOptions(plan.clicks);
    this.boardView.setClickable(plan.nodes);
    if (choice && plan.nodes.length > 0) this.frameTargets(choice.player);
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
    this.cam.release();
    // Rolling means "show me my move", even if the player had panned away to look around.
    if (id === 'roll') this.cam.recentre(c.player);
    res(id);
  }

  /**
   * 升级 / 出符 sub-menus built from the current preRoll / action options. Clicking a tile that carries
   * several options (升级 or 改建 the same land) narrows the menu to that tile instead of picking one.
   */
  private async openSubMenu(which: 'upgrade' | 'cast', only?: NodeId): Promise<void> {
    const c = this.mainChoice;
    if (!c) return;
    const opts = c.options.filter((o) => (which === 'upgrade' ? o.id.startsWith('upgrade:') : isCastId(o.id)) && (!only || o.node === only));
    if (opts.length === 0) return;
    this.setNodeOptions(opts);
    this.boardView.setClickable([...this.nodeOptions.keys()]);
    this.frameTargets(c.player);
    const where = only ? `【${this.engine.board.node(only).name}】` : '';
    const id = await this.modal.open({
      title: which === 'upgrade' ? (where ? `升级 / 改建${where}` : '升级 / 改建洞府（每回合 1 次）') : '符箓 / 技能',
      options: opts.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
      closable: true, cancelId: null, placement: which === 'upgrade' ? 'side' : 'center', avoid: this.tokenScreenRect(c.player),
    });
    this.boardView.setClickable([]);
    this.nodeOptions.clear();
    this.cam.release();
    if (id?.startsWith(NARROW)) void this.openSubMenu(which, id.slice(NARROW.length) as NodeId);
    else if (id) this.mainAnswer(id);
    else this.restorePlanClicks();
  }

  private restorePlanClicks(): void {
    this.setNodeOptions(this.shownPlan.clicks);
    this.boardView.setClickable(this.shownPlan.nodes);
    if (this.mainChoice && this.shownPlan.nodes.length > 0) this.frameTargets(this.mainChoice.player);
  }

  private setNodeOptions(opts: readonly { id: string; node?: NodeId }[]): void {
    this.nodeOptions.clear();
    for (const o of opts) if (o.node) this.nodeOptions.set(o.node, [...(this.nodeOptions.get(o.node) ?? []), o.id]);
  }

  /** Bring the highlighted choice targets and the deciding seat's token into view together. */
  private frameTargets(seat: number): void {
    if (this.nodeOptions.size === 0) return;
    const rects = [...this.nodeOptions.keys()].map((n) => this.boardView.nodeRect(n));
    this.cam.frameChoice(unionRect([...rects, this.boardView.tokenRect(seat)]), seat);
  }

  /** 回到棋子: centre on whoever is deciding (or moving) and follow them again. */
  private recentre(): void {
    this.cam.recentre(this.engine.pending?.player ?? this.shownState.current);
  }

  private async modalChoice(c: PendingChoice): Promise<string> {
    const g = this.engine;
    // Generic asks keep the first option per tile: a click there must answer, there is no narrower menu.
    this.setNodeOptions(c.options);
    for (const [n, ids] of this.nodeOptions) this.nodeOptions.set(n, ids.slice(0, 1));
    this.boardView.setClickable([...this.nodeOptions.keys()]);
    this.frameTargets(c.player);
    const multiHuman = this.ais.filter((a) => a === null).length > 1;
    const spec = presentChoice(c, { game: g, who: multiHuman ? g.state.players[c.player].name : undefined });
    const boardHint = this.nodeOptions.size > 9 ? '也可直接点击棋盘上高亮的格子' : '';
    const id = await this.modal.open({
      ...spec,
      desc: [spec.desc, boardHint].filter(Boolean).join('\n') || undefined,
      placement: this.nodeOptions.size >= 2 ? 'side' : 'center',
      avoid: this.tokenScreenRect(c.player),
    });
    this.boardView.setClickable([]);
    this.nodeOptions.clear();
    this.cam.release();
    return id ?? c.cancelId ?? c.defaultId ?? c.options[0].id;
  }

  private nodeClicked(n: NodeId): void {
    const ids = this.nodeOptions.get(n);
    if (!ids) {
      this.tip.toggle(`tile:${n}`, this.toScreen(this.boardView.nodeRect(n)), tileTip(this.engine, this.shownState, n));
      return;
    }
    if (this.picking) this.answerPick(this.picking.plan.cells.find((cell) => cell.node === n)!);
    else if (ids.length > 1 && this.modal.isOpen) this.modal.close(`${NARROW}${n}`);
    else if (this.modal.isOpen) this.modal.close(ids[0]);
    else if (this.mainChoice) this.mainAnswer(ids[0]);
  }

  /** Hide a resting hover when the camera, a modal, or an idle AI turn says the tip is stale. */
  private trackHover(delta: number): void {
    const idleWas = this.pointerIdleMs >= HOVER_IDLE_MS;
    const sinceWas = this.cameraSincePointer;
    const movingWas = this.camMoving;
    this.notePointer(delta);
    const moved = this.cam.update(delta);
    if (moved) this.cameraSincePointer = true;
    this.camMoving = moved;
    const modal = this.modal.isOpen;
    const changed = moved !== movingWas || sinceWas !== this.cameraSincePointer
      || idleWas !== (this.pointerIdleMs >= HOVER_IDLE_MS) || modal !== this.modalWasOpen;
    this.modalWasOpen = modal;
    if (changed) this.showTile();
  }

  private notePointer(delta: number): void {
    const p = this.input.activePointer;
    if (p.x === this.pointerAt.x && p.y === this.pointerAt.y) {
      this.pointerIdleMs += delta;
      return;
    }
    this.pointerAt.x = p.x;
    this.pointerAt.y = p.y;
    this.pointerIdleMs = 0;
    this.cameraSincePointer = false;
  }

  /** Hovered tile's popover. A pinned tile popover follows the latest state once the camera rests. */
  private showTile(): void {
    if (!this.shownState) return;
    const pinned = this.tip.pinned;
    if (pinned?.startsWith('tile:')) {
      if (this.camMoving) return;
      const n = pinned.slice(5) as NodeId;
      this.tip.unpin();
      this.tip.toggle(pinned, this.toScreen(this.boardView.nodeRect(n)), tileTip(this.engine, this.shownState, n));
      return;
    }
    const open = this.hovered !== null && hoverTipOpen({
      overTile: true,
      pinned: false,
      cameraMoving: this.camMoving,
      cameraSincePointer: this.cameraSincePointer,
      modalOpen: this.modal.isOpen,
      aiTurn: !this.isHuman(this.shownState.current),
      pointerIdleMs: this.pointerIdleMs,
    });
    if (!open || this.hovered === null) this.tip.hide();
    else this.tip.show(this.toScreen(this.boardView.nodeRect(this.hovered)), tileTip(this.engine, this.shownState, this.hovered));
  }

  /** Board (world) rect to HUD (screen) coordinates through the board camera. */
  private toScreen(r: Rect): Rect {
    return this.cam.toScreen(r);
  }

  /** Where a token will be on screen once the camera settles, so a modal opened now does not cover it. */
  private tokenScreenRect(seat: number): Rect {
    return this.cam.toScreenAtGoal(this.boardView.tokenRect(seat));
  }

  private toast(s: string): void {
    this.toastText.setText(s).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1600, duration: 600 });
  }

  private cycleSpeed(): void {
    this.speed = nextSpeed(this.speed);
    this.side.btnSpeed.setLabel(`倍速 ×${this.speed} · F`);
    this.toast(`倍速 ×${this.speed} · ${speedNote(this.speed)}`);
  }

  private saveRecord(): void {
    downloadRecord(this.record());
    this.toast('已下载对局记录');
  }

  private onKey(ev: KeyboardEvent): void {
    const k = ev.key;
    if (this.coach.isOpen) this.dismissCoach();
    if (k === 'f' || k === 'F') { this.cycleSpeed(); return; }
    if (k === 'l' || k === 'L') { this.logPanel.toggle(); return; }
    if (k === 'Escape' && this.logPanel.isOpen) { this.logPanel.toggle(false); return; }
    if (k === 'Escape' && this.tip.pinned && !this.modal.isOpen) { this.tip.unpin(); return; }
    if (k === 'h' || k === 'H' || k === 'Home') { this.recentre(); return; }
    if (this.modal.isOpen) {
      const key = k === ' ' ? 'SPACE' : k === 'Escape' ? 'ESC' : k === 'Enter' ? 'SPACE' : k;
      if (this.modal.handleKey(key)) ev.preventDefault();
      return;
    }
    if (k === 's' || k === 'S') { this.saveRecord(); return; }
    if (this.picking) { this.pickKey(k, ev); return; }
    if (!this.mainChoice) return;
    if (k === ' ') { ev.preventDefault(); this.mainAnswer('roll'); }
    else if (k === 'Enter') this.mainAnswer('end');
    else if (k === 'b' || k === 'B') void this.openSubMenu('upgrade');
    else if (k === 'c' || k === 'C') void this.openSubMenu('cast');
    else if (k === 'p' || k === 'P') this.mainAnswer('eat');
    else if (k === 'g' || k === 'G') this.mainAnswer('closure');
    else if (k === 'k' || k === 'K') this.mainAnswer('skill');
    else if (/^[1-9]$/.test(k)) this.answerOffer(k);
  }

  private overCoach(): boolean {
    const rect = this.coach.isOpen ? this.coach.rect() : this.coachBlock;
    if (!rect) return false;
    const p = this.input.activePointer;
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  }

  private answerOffer(key: string): void {
    const row = this.shownPlan.offers.find((offer) => offer.key === key);
    if (row) this.mainAnswer(row.id);
  }

  private noteCoach(moment: CoachMoment): void {
    if (!this.alive || !this.coachArmed) return;
    const next = observe(this.coachBook, moment, coachCopy(this.engine.data));
    this.coachBook = next.book;
    if (next.cue && !this.coach.isOpen) this.coach.show(next.cue, this.coachRect(next.cue));
  }

  private dismissCoach(): void {
    const step = this.coach.dismiss();
    if (!step) return;
    this.coachBook = dismiss(this.coachBook, step);
    this.persistCoach();
    this.time.delayedCall(0, () => this.revealCoach());
  }

  private revealCoach(): void {
    if (!this.alive || !this.coachArmed || this.coach.isOpen) return;
    const next = nudge(this.coachBook);
    this.coachBook = next.book;
    if (next.cue) this.coach.show(next.cue, this.coachRect(next.cue));
  }

  private persistCoach(): void {
    if (this.coachBook.seen.length >= COACH_STEPS.length) this.coachArmed = false;
    saveCoach(this.coachArmed, this.coachBook.seen);
  }

  private momentFromChoice(c: PendingChoice): CoachMoment {
    const standing = this.engine.state.players[c.player].pos;
    const node = c.ctx.node ?? (c.kind === 'brew' ? standing : c.options.find((o) => o.node)?.node);
    return {
      t: 'choice',
      human: this.isHuman(c.player),
      seat: c.player,
      kind: c.kind,
      node,
      nodeType: node ? this.engine.board.node(node).type : undefined,
      closure: c.options.some((o) => o.id === 'closure'),
    };
  }

  private momentFromEvent(e: GameEvent): CoachMoment {
    const seat = e.player ?? 0;
    const snap = e.snap ?? this.engine.state;
    return {
      t: 'event',
      human: e.player !== undefined && this.isHuman(e.player),
      seat,
      type: e.type,
      node: e.node,
      nodeType: e.node ? this.engine.board.node(e.node).type : undefined,
      cultGained: e.cult?.gained ?? 0,
      glowing: e.player !== undefined && isGlowing(snap, this.engine.data, seat),
    };
  }

  private coachRect(cue: CoachCue): Rect {
    const hud = coachHudRect(cue.at, cue.seat);
    if (hud) return hud;
    if (cue.at.t === 'roll') return this.side.rollRect();
    if (cue.at.t === 'closure') return this.side.offerRect('closure') ?? this.side.rollRect();
    if (cue.at.t === 'tile') return this.toScreen(this.boardView.nodeRect(cue.at.node));
    return { x: LEFT.x, y: LEFT.lineY, w: LEFT.w, h: LEFT.lineH };
  }
}
