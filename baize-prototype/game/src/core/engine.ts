// ---------------------------------------------------------------------------
// Rules engine for 白泽秘境大富翁 v0.8「凡人问道」 (pure TypeScript, no Phaser).
//
// Control flow is written as generators: every place that needs a player
// decision does `yield* this.ask({...})`, which suspends the engine and exposes
// a PendingChoice on `game.pending`. Whoever drives the game (UI, AI, tests,
// sim) calls `game.answer(optionId)` to resume it.
//
//   const g = new Game(setup);  g.start();
//   while (!g.over) g.answer(controllers[g.pending!.player].decide(g.pending!));
//
// All game data lives in `game.state` (plain JSON). The generator itself is not
// serialisable, but a game is fully reproducible from (setup, answer history):
// see Game.replay().
// ---------------------------------------------------------------------------
import { ALTAR, Board } from './board';
import type {
  ActionAct, AdjustValue, ChoiceKind, ChoiceOption, ChoicePurpose, ChoiceSpec, ChoiceValueMap, ManifestGift,
  MarketBuy, PendingChoice, PendingChoiceOf, PreRollAct, Target, ThreatKind,
} from './choices';
import { closureOdds, percent } from './closureOdds';
import { defaultData } from './data';
import type { BreakthroughBonuses, BreakthroughResult, CultChange, CultSource, DuelResult, GameEvent, GameEventType } from './events';
import { skillTerms } from './heroes';
import { hashSeed, nextFloat } from './rng';
import {
  barFull, barSize, canClose, chance2d6, closureSite, compareStanding, duelBonus, fixedBonuses, hasAbility, hasTrait, herbYield,
  insightRoom, isGlowing, maxLevel,
  realmName, realmOf, rentFor, sitGain, upgradeCost, winRealm,
} from './rules';
import type {
  EndReason, EventCardData, GameData, GameSetup, GameState, HeroData, MiniGameTier, NodeId, PlayerState, SpellData,
  TurnState,
} from './types';

export type Flow<T = void> = Generator<PendingChoice, T, string>;

/** Thrown inside the generator to unwind everything when someone wins. */
class GameOverSignal {
  constructor(readonly winner: number) {}
}

export interface GameOptions {
  /** Attach a deep state snapshot to every event (UI playback). Off for sim speed. */
  snapshots?: boolean;
}

/** Nested settles (秘境裂隙 → 秘境 → …) stop at this depth. */
const MAX_SETTLE_DEPTH = 4;

const TIER_LABEL: Record<MiniGameTier, string> = { perfect: '火候正中', ok: '火候尚可', fail: '火候失手' };

const GIFT_LABEL: Record<ManifestGift, string> = { chart: '白泽图', stones: '灵脉馈赠', pills: '丹霞', guide: '指路' };

export class Game {
  readonly board: Board;
  state: GameState;
  pending: PendingChoice | null = null;
  readonly log: GameEvent[] = [];
  /** Every answer given, in order — (setup, history) reproduces the game exactly. */
  readonly history: string[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];
  private gen: Flow | null = null;
  private choiceSeq = 0;

  readonly spellById = new Map<string, SpellData>();
  readonly eventById = new Map<string, EventCardData>();

  constructor(readonly setup: GameSetup, readonly data: GameData = defaultData, readonly opts: GameOptions = {}) {
    this.board = new Board(data.board);
    for (const s of data.spells.cards) this.spellById.set(s.id, s);
    for (const e of data.events.events) this.eventById.set(e.id, e);
    this.state = this.createInitialState();
  }

  static replay(setup: GameSetup, answers: string[], data: GameData = defaultData, opts: GameOptions = {}): Game {
    const g = new Game(setup, data, opts);
    g.start();
    for (const a of answers) g.answer(a);
    return g;
  }

  // ------------------------------------------------------------------ API --

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  get over(): boolean {
    return this.state.over;
  }

  start(): void {
    if (this.gen) throw new Error('game already started');
    this.gen = this.run();
    this.advance(undefined);
  }

  answer(optionId: string): void {
    const c = this.pending;
    if (!c) throw new Error('no pending choice');
    if (!(c.options as ChoiceOption<unknown>[]).some((o) => o.id === optionId)) {
      throw new Error(`invalid answer "${optionId}" for ${c.kind}; options: ${c.options.map((o) => o.id).join(',')}`);
    }
    this.history.push(optionId);
    this.advance(optionId);
  }

  player(seat: number): PlayerState {
    return this.state.players[seat];
  }

  // ------------------------------------------------------------- plumbing --

  private advance(input: string | undefined): void {
    this.pending = null;
    const r = this.gen!.next(input as string);
    this.pending = r.done ? null : r.value;
  }

  private *ask<K extends ChoiceKind>(spec: ChoiceSpec<K>): Flow<ChoiceValueMap[K]> {
    if (spec.options.length === 0) throw new Error(`choice ${spec.kind} has no options`);
    if (spec.options.length === 1 && !spec.forceAsk) return spec.options[0].value;
    const choice: PendingChoiceOf<K> = {
      seq: ++this.choiceSeq,
      player: spec.player,
      kind: spec.kind,
      title: spec.title,
      desc: spec.desc,
      options: spec.options,
      cancelId: spec.cancelId,
      defaultId: spec.defaultId,
      ctx: spec.ctx ?? {},
    };
    const id = yield choice as unknown as PendingChoice;
    return choice.options.find((o) => o.id === id)!.value;
  }

  private emit(type: GameEventType, text: string, extra: Partial<GameEvent> = {}): void {
    const e: GameEvent = { seq: this.log.length, round: this.state.round, type, text, ...extra };
    if (this.opts.snapshots) e.snap = structuredClone(this.state);
    this.log.push(e);
    for (const l of this.listeners) l(e);
  }

  private rand(): number {
    return nextFloat(this.state);
  }

  private randInt(n: number): number {
    return Math.floor(this.rand() * n);
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private d6(): number {
    return 1 + this.randInt(6);
  }

  private roll2d6(): [number, number] {
    return [this.d6(), this.d6()];
  }

  pn(seat: number): string {
    return this.state.players[seat].name;
  }

  nodeName(id: NodeId): string {
    return this.board.node(id).name;
  }

  spellName(id: string): string {
    return this.spellById.get(id)?.name ?? id;
  }

  realmLabel(seat: number): string {
    return realmName(this.data, this.state.players[seat].realm);
  }

  private get cfg() {
    return this.data.config;
  }

  // -------------------------------------------------------------- setup ----

  private createInitialState(): GameState {
    const tiles: GameState['tiles'] = {};
    for (const id of this.board.lands) tiles[id] = { owner: null, level: 0 };
    const st: GameState = {
      seed: this.setup.seed,
      rng: hashSeed(this.setup.seed),
      round: 0, current: 0, over: false, winner: null, endReason: null,
      players: this.setup.players.map((sp, i) => this.newPlayer(i, sp.name, sp.hero)),
      tiles,
      spellDeck: this.data.spells.cards.flatMap((c) => Array<string>(this.data.spells.copiesEach).fill(c.id)),
      spellDiscard: [],
      eventDeck: this.data.events.events.flatMap((e) => Array<string>(e.count).fill(e.id)),
      eventDiscard: [],
      manifested: false,
      roadblock: null,
      turn: this.freshTurn(0),
    };
    this.state = st;
    this.shuffle(st.spellDeck);
    this.shuffle(st.eventDeck);
    return st;
  }

  private newPlayer(seat: number, name: string, hero: PlayerState['hero']): PlayerState {
    const cfg = this.data.config;
    return {
      seat, name, hero, pos: this.board.startId, cameFrom: null,
      stones: cfg.startStones + cfg.seatBonusStones[seat], herbs: cfg.startHerbs, pills: cfg.startPills,
      realm: 0, cult: 0, mind: 0, guidance: 0, insight: 0, momentum: false, glowRound: 0, escapeRound: 0,
      hand: [], bound: false, turnsTaken: 0, skillReadyTurn: 0, dazed: false,
      stats: {
        rentCollected: 0, rentPaid: 0, breakthroughs: 0, breakthroughFails: 0, roadEntries: 0, altarVisits: 0,
        bankruptcies: 0, duels: 0, duelWins: 0, pillsLost: 0, pillsMade: 0, pillsEaten: 0, cultWasted: 0,
        skillUses: 0, miniGames: 0,
      },
    };
  }

  private freshTurn(seat: number): TurnState {
    return {
      seat, upgraded: false, ate: false, brewed: false, closed: false, landedAltar: false, reverse: false,
      lastPath: [], lastDir: 1, duelDone: false, passed: [], diceCard: false,
    };
  }

  // ------------------------------------------------------------ main loop --

  private *run(): Flow {
    try {
      for (const p of this.state.players) for (let k = 0; k < this.cfg.startHand; k++) this.drawSpell(p.seat, true);
      this.emit('gameStart', '白泽秘境开启，众散修踏入秘境。');
      for (let r = 1; r <= this.cfg.rounds; r++) {
        this.state.round = r;
        yield* this.roundStart();
        for (let s = 0; s < this.state.players.length; s++) {
          this.state.current = s;
          yield* this.playTurn(s);
        }
        this.emit('roundEnd', `第 ${r} 轮结束`);
      }
      this.finishByRoundCap();
    } catch (e) {
      if (!(e instanceof GameOverSignal)) throw e;
    }
  }

  /** 每轮开始：洞府产灵草，第 manifest.round 轮白泽现世。 */
  private *roundStart(): Flow {
    const st = this.state;
    this.emit('roundStart', `—— 第 ${st.round} / ${this.cfg.rounds} 轮 ——`);
    for (const p of st.players) {
      const n = herbYield(st, this.board, this.data, p.seat);
      if (n > 0) this.gainHerbs(p.seat, n, '洞府产出');
    }
    if (st.round === this.cfg.manifest.round && !st.manifested) yield* this.manifest();
  }

  private *playTurn(seat: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    p.turnsTaken++;
    st.turn = this.freshTurn(seat);
    this.emit('turnStart', `${this.pn(seat)} 的回合`, { player: seat });
    this.fadeRoadblock(seat);
    if (p.bound) {
      p.bound = false;
      this.emit('bind', `${this.pn(seat)} 被定身，本回合无法移动。`, { player: seat });
    } else if ((yield* this.preRollPhase(seat)) === 'roll') {
      yield* this.rollAndMove(seat);
    }
    yield* this.actionPhase(seat);
    this.turnEnd(seat);
  }

  private fadeRoadblock(seat: number): void {
    const rb = this.state.roadblock;
    if (!rb || rb.seat !== seat) return;
    this.state.roadblock = null;
    this.emit('roadblockGone', `${this.pn(seat)} 的山岳消散`, { player: seat, node: rb.node });
  }

  /** 回合结束：吐纳、打坐、白泽问心。 */
  private turnEnd(seat: number): void {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const c = this.cfg.cultivation;
    this.addCult(seat, c.breath, 'breath', '吐纳');
    const sit = sitGain(this.state, this.data, seat, p.pos);
    if (sit > 0) this.addCult(seat, sit, 'sit', `在${this.nodeName(p.pos)}打坐`);
    if (t.landedAltar && !t.closed && p.pos === ALTAR) this.addCult(seat, c.altarCalm, 'altar', '白泽问心');
    this.emit('turnEnd', `${this.pn(seat)} 结束回合`, { player: seat });
  }

  // ------------------------------------------------------------ pre-roll ---

  private hasCard(p: PlayerState, card: string): boolean {
    return p.hand.includes(card);
  }

  /** Remove a card from hand and discard it. */
  private payCard(seat: number, card: string): void {
    const p = this.state.players[seat];
    const i = p.hand.indexOf(card);
    if (i < 0) throw new Error(`${card} not in hand`);
    p.hand.splice(i, 1);
    this.state.spellDiscard.push(card);
    this.emit('cast', `${this.pn(seat)} 施放【${this.spellName(card)}】`, { player: seat });
  }

  private cardOption<V>(card: string, value: V): ChoiceOption<V> {
    const s = this.spellById.get(card)!;
    return { id: `cast:${card}`, label: s.name, value, hint: s.desc };
  }

  private closureOption<V>(seat: number, value: V): ChoiceOption<V> {
    const p = this.state.players[seat];
    const next = realmName(this.data, p.realm + 1);
    return { id: 'closure', label: `闭关突破 → ${next}`, value, hint: `目标 ${realmOf(this.data, p.realm).target}，可押丹` };
  }

  private canCloseNow(seat: number): boolean {
    return !this.state.turn.closed && canClose(this.state, this.data, seat);
  }

  private preRollOptions(seat: number): ChoiceOption<PreRollAct>[] {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const opts: ChoiceOption<PreRollAct>[] = [{ id: 'roll', label: '掷骰子', value: { t: 'roll' } }];
    if (this.hasCard(p, 'dice') && !t.diceCard) opts.push(this.cardOption('dice', { t: 'cast', card: 'dice' }));
    if (this.hasCard(p, 'reverse') && !t.reverse && this.board.node(p.pos).outer) {
      opts.push(this.cardOption('reverse', { t: 'cast', card: 'reverse' }));
    }
    if (this.skillAvailable(seat, 'preroll')) opts.push(this.skillOption(seat));
    if (this.canCloseNow(seat)) opts.push(this.closureOption(seat, { t: 'closure' }));
    return opts;
  }

  private *preRollPhase(seat: number): Flow<'roll' | 'moved'> {
    const t = this.state.turn;
    for (;;) {
      const act = yield* this.ask({
        player: seat, kind: 'preRoll', title: '掷骰前', desc: '可用身法符、技能，或直接掷骰。',
        options: this.preRollOptions(seat), defaultId: 'roll', forceAsk: true,
      });
      if (act.t === 'roll') return 'roll';
      if (act.t === 'closure') yield* this.closure(seat);
      else if (act.t === 'skill') {
        if ((yield* this.useSkill(seat)) === 'moved') return 'moved';
      } else {
        this.payCard(seat, act.card);
        if (act.card === 'reverse') t.reverse = true;
        else t.diceCard = true;
      }
    }
  }

  // --------------------------------------------------------------- moving --

  private *rollAndMove(seat: number): Flow {
    const t = this.state.turn;
    if (t.diceCard) {
      t.diceCard = false;
      const v = yield* this.askRollValue(seat);
      this.emit('roll', `${this.pn(seat)} 御骰符，选择 ${v} 点`, { player: seat, amount: v });
      yield* this.doMove(seat, v);
      return;
    }
    const dice = this.roll2d6();
    this.emit('roll', `${this.pn(seat)} 掷出 ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`, { player: seat, dice, amount: dice[0] + dice[1] });
    const steps = yield* this.adjustRoll(seat, dice);
    yield* this.doMove(seat, steps);
  }

  private *askRollValue(seat: number): Flow<number> {
    const r = this.cfg.rules;
    const opts: ChoiceOption<number>[] = [];
    for (let v = r.diceCardMin; v <= r.diceCardMax; v++) opts.push({ id: `v${v}`, label: `${v} 点`, value: v });
    return yield* this.ask({ player: seat, kind: 'rollValue', title: '御骰符', desc: '选择本次移动点数', options: opts, forceAsk: true });
  }

  /** Every distinct final total reachable with 御器 ±1 and / or 神行符 +1..+max, cheapest way first. */
  adjustOptions(seat: number, base: number): ChoiceOption<AdjustValue>[] {
    const p = this.state.players[seat];
    const steers: (-1 | 0 | 1)[] = hasAbility(this.data, p, 'steer') ? [0, -1, 1] : [0];
    const cards = this.hasCard(p, 'swiftstep') ? this.cfg.rules.swiftstepMax : 0;
    const seen = new Map<number, ChoiceOption<AdjustValue>>();
    for (let k = 0; k <= cards; k++) {
      for (const steer of steers) {
        const steps = base + steer + k;
        if (steps < 1 || seen.has(steps)) continue;
        const how = [steer ? `御器 ${steer > 0 ? '+1' : '−1'}` : '', k ? `神行符 +${k}` : ''].filter(Boolean).join(' · ');
        seen.set(steps, { id: `n${steps}`, label: `走 ${steps} 步`, value: { steps, card: k > 0, steer }, hint: how || '原点数' });
      }
    }
    return [...seen.values()].sort((a, b) => a.value.steps - b.value.steps);
  }

  private *adjustRoll(seat: number, dice: [number, number]): Flow<number> {
    const base = dice[0] + dice[1];
    const opts = this.adjustOptions(seat, base);
    const v = yield* this.ask({
      player: seat, kind: 'adjust', title: '调整点数', desc: `掷出 ${base}，选择最终步数`,
      options: opts, defaultId: `n${base}`, ctx: { base, dice },
    });
    if (v.card) this.payCard(seat, 'swiftstep');
    if (v.steps !== base) this.emit('info', `${this.pn(seat)} 调整点数 ${base} → ${v.steps}`, { player: seat, amount: v.steps });
    return v.steps;
  }

  private *doMove(seat: number, steps: number): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    let total = steps;
    if (p.dazed) {
      p.dazed = false;
      total = Math.max(1, Math.floor(steps / 2));
      this.emit('status', `${this.pn(seat)} 受迷魂丹所困，步数 ${steps} → ${total}`, { player: seat, amount: total });
    }
    yield* this.walk(seat, total, t.reverse ? -1 : 1);
    t.reverse = false;
    yield* this.offerDuel(seat);
    yield* this.settle(seat, p.pos);
  }

  /** Step-by-step movement along the board graph: forks, altar stop/toll, start salary, roadblock. */
  *walk(seat: number, steps: number, dir: 1 | -1): Flow {
    const p = this.state.players[seat];
    const b = this.board;
    let remaining = steps;
    let node = p.pos;
    let cameFrom = b.isTwoWay(node) ? p.cameFrom : null;
    const path: NodeId[] = [node];
    let forced: NodeId | null = node === ALTAR ? yield* this.askExit(seat, remaining) : null;
    while (remaining > 0) {
      const next = forced ?? (yield* this.nextStep(seat, node, cameFrom, dir, remaining));
      forced = null;
      remaining--;
      this.enterNode(seat, node, next, remaining);
      cameFrom = node;
      node = next;
      path.push(next);
      if (this.hitRoadblock(seat, next)) break;
      if (next === ALTAR) [remaining, forced] = yield* this.atAltar(seat, remaining);
    }
    p.pos = node;
    p.cameFrom = cameFrom;
    this.state.turn.lastPath = path;
    this.state.turn.lastDir = dir;
  }

  private *nextStep(seat: number, node: NodeId, cameFrom: NodeId | null, dir: 1 | -1, remaining: number): Flow<NodeId> {
    const exits = this.board.exits(node, cameFrom, dir);
    return exits.length > 1 ? yield* this.askFork(seat, node, exits, remaining) : exits[0];
  }

  private *askExit(seat: number, remaining: number): Flow<NodeId> {
    return yield* this.ask({
      player: seat, kind: 'exitRoad', title: '离开白泽灵台', desc: `选择一条神道向外走（${remaining} 步）`,
      options: this.board.node(ALTAR).next.map((x) => ({ id: x, label: this.exitLabel(x), value: x, node: x })),
      ctx: { remaining },
    });
  }

  /** 镇山: the mountain stops the next other player who enters its tile. */
  private hitRoadblock(seat: number, node: NodeId): boolean {
    const rb = this.state.roadblock;
    if (!rb || rb.node !== node || rb.seat === seat) return false;
    this.state.roadblock = null;
    this.emit('roadblockHit', `${this.pn(seat)} 被 ${this.pn(rb.seat)} 的山岳拦下，停在【${this.nodeName(node)}】`, { player: seat, node });
    return true;
  }

  /** Reaching the altar with steps left: stop, or pay the toll and leave by a road. Returns [remaining, forced]. */
  private *atAltar(seat: number, remaining: number): Flow<[number, NodeId | null]> {
    const p = this.state.players[seat];
    const toll = this.cfg.altarToll;
    if (remaining <= 0 || p.pills < toll) return [0, null];
    const ch = yield* this.ask({
      player: seat, kind: 'altarPass', title: '白泽灵台', desc: `剩余 ${remaining} 步：停下结算，或付 ${toll} 颗丹药借道离开？`,
      options: [
        { id: 'stop', label: '停留灵台', value: 'stop' as const },
        ...this.board.node(ALTAR).next.map((x) => ({ id: x, label: `借道 · ${this.exitLabel(x)}`, value: x, node: x })),
      ],
      defaultId: 'stop', ctx: { remaining },
    });
    if (ch === 'stop') return [0, null];
    p.pills -= toll;
    this.emit('toll', `${this.pn(seat)} 付 ${toll} 颗丹药借道，经${this.board.roadName(this.board.node(ch).road!)}离开`, { player: seat, node: ALTAR });
    return [remaining, ch];
  }

  private *askFork(seat: number, node: NodeId, exits: NodeId[], remaining: number): Flow<NodeId> {
    const b = this.board;
    const here = b.node(node);
    const label = (x: NodeId): string => {
      const n = b.node(x);
      return n.road && n.road !== here.road ? `拐入${b.roadName(n.road)}` : `前往【${n.name}】`;
    };
    const options = exits.map((x) => ({ id: x, label: label(x), value: x, node: x }));
    const ch = yield* this.ask({
      player: seat, kind: 'fork', title: `岔路 · ${here.name}`, desc: `剩余 ${remaining} 步：${options.map((o) => o.label).join('，或')}？`,
      options, defaultId: exits[0], ctx: { remaining, node },
    });
    const road = b.node(ch).road;
    if (road && road !== here.road) {
      this.state.players[seat].stats.roadEntries++;
      this.emit('fork', `${this.pn(seat)} 拐入${b.roadName(road)}`, { player: seat, node });
    }
    return ch;
  }

  /** Entering a node during a walk: emits a step, pays the start salary, notes who was passed. */
  private enterNode(seat: number, from: NodeId, to: NodeId, remaining: number): void {
    this.state.players[seat].pos = to;
    this.emit('step', '', { player: seat, node: to, from });
    if (this.board.node(to).type === 'start' && remaining > 0) this.gainStones(seat, this.cfg.salaryPass, '经过宗门');
    const t = this.state.turn;
    if (remaining <= 0 || t.seat !== seat) return;
    for (const o of this.state.players) if (o.seat !== seat && o.pos === to && !t.passed.includes(o.seat)) t.passed.push(o.seat);
  }

  /** An exit from the altar, named by its 神道 and the node where that road ends. */
  private exitLabel(exit: NodeId): string {
    const end = this.board.corridorEnd(ALTAR, exit);
    return `${this.board.roadName(this.board.node(exit).road!)} → ${end} ${this.nodeName(end)}`;
  }

  nodeLabel(id: NodeId): string {
    const n = this.board.node(id);
    if (n.type !== 'land') return `${n.name}·${id}`;
    const t = this.state.tiles[id];
    return `${n.name}（${t.owner === null ? '无主' : `${this.pn(t.owner)} Lv${t.level}`}）`;
  }

  private teleport(seat: number, node: NodeId, why: string): void {
    const p = this.state.players[seat];
    const from = p.pos;
    p.pos = node;
    p.cameFrom = null;
    this.emit('teleport', `${this.pn(seat)} ${why}，来到【${this.nodeName(node)}】`, { player: seat, node, from });
  }

  // ------------------------------------------------------------- settling --

  private *settle(seat: number, node: NodeId, depth = 0): Flow {
    if (depth > MAX_SETTLE_DEPTH) return;
    const c = this.cfg.cultivation;
    switch (this.board.node(node).type) {
      case 'start': this.gainStones(seat, this.cfg.salaryLand, '停在宗门'); break;
      case 'land': yield* this.settleLand(seat, node); break;
      case 'alchemy': yield* this.alchemy(seat, node); break;
      case 'market': yield* this.market(seat); break;
      case 'secret': yield* this.drawFortune(seat, depth); break;
      case 'spring':
        this.addCult(seat, c.spring, 'spring', '灵泉');
        this.gainHerbs(seat, this.cfg.spring.herbs, '灵泉');
        break;
      case 'beast': this.beast(seat); break;
      case 'ruins': yield* this.ruins(seat, depth); break;
      case 'eye': this.addCult(seat, c.eye, 'eye', '灵眼'); break;
      case 'altar': this.landAltar(seat); break;
      case 'gate': break;
    }
  }

  private landAltar(seat: number): void {
    this.state.turn.landedAltar = true;
    this.state.players[seat].stats.altarVisits++;
    this.emit('info', `${this.pn(seat)} 停在白泽灵台`, { player: seat, node: ALTAR });
  }

  private *settleLand(seat: number, node: NodeId): Flow {
    const t = this.state.tiles[node];
    if (t.owner === null) yield* this.offerBuy(seat, node);
    else if (t.owner !== seat) yield* this.payRent(seat, node);
  }

  private *offerBuy(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const n = this.board.node(node);
    const price = n.price!;
    if (p.stones < price) {
      this.emit('info', `${this.pn(seat)} 灵石不足，无法购买【${n.name}】`, { player: seat, node });
      return;
    }
    const buy = yield* this.ask({
      player: seat, kind: 'buy', title: `购买 ${n.name}`, desc: `${this.data.board.regions[n.region!].name} · 售价 ${price} 灵石（持有 ${p.stones}）`,
      options: [
        { id: 'yes', label: `购买（${price}）`, value: true },
        { id: 'no', label: '放弃', value: false },
      ],
      defaultId: 'yes', cancelId: 'no', ctx: { node, price },
    });
    if (!buy) return;
    p.stones -= price;
    this.state.tiles[node].owner = seat;
    this.emit('buy', `${this.pn(seat)} 以 ${price} 灵石购得【${n.name}】`, { player: seat, node, amount: price });
  }

  private *payRent(seat: number, node: NodeId): Flow {
    const st = this.state;
    const ownerSeat = st.tiles[node].owner!;
    const rent = rentFor(st, this.board, this.data, node, seat).amount;
    if (rent <= 0) return;
    if (yield* this.askEvade(seat, ownerSeat, rent, node)) return;
    const paid = this.pay(seat, ownerSeat, rent, `【${this.nodeName(node)}】租金`);
    st.players[ownerSeat].stats.rentCollected += paid;
    st.players[seat].stats.rentPaid += paid;
    this.emit('rent', `${this.pn(seat)} 向 ${this.pn(ownerSeat)} 支付租金 ${paid}`, { player: seat, payee: ownerSeat, node, amount: paid });
  }

  /** 避劫符. Returns true when the rent is waived. */
  private *askEvade(seat: number, ownerSeat: number, rent: number, node: NodeId): Flow<boolean> {
    if (!this.hasCard(this.state.players[seat], 'evade')) return false;
    const use = yield* this.ask({
      player: seat, kind: 'rentReact', title: '是否反制？', desc: `需向 ${this.pn(ownerSeat)} 支付 ${rent} 灵石租金`,
      options: [
        { id: 'evade', label: '避劫符 · 免付', value: true },
        { id: 'pay', label: '支付', value: false },
      ],
      defaultId: 'pay', cancelId: 'pay', ctx: { rent, node },
    });
    if (!use) return false;
    this.payCard(seat, 'evade');
    this.emit('rentFree', `${this.pn(seat)} 避劫符免付 ${rent} 灵石租金`, { player: seat, node });
    return true;
  }

  /**
   * Mandatory payment between players (or to the bank if `to` is null).
   * Triggers 破产重整 when the payer cannot cover it. Returns the amount actually paid.
   */
  private pay(from: number, to: number | null, amount: number, why: string): number {
    const p = this.state.players[from];
    const paid = Math.min(p.stones, amount);
    p.stones -= paid;
    if (to !== null) this.state.players[to].stones += paid;
    if (paid < amount) {
      this.emit('stones', `${this.pn(from)} 无力支付${why}（${amount}），倾尽 ${paid} 灵石`, { player: from, amount: paid });
      this.bankrupt(from);
    }
    return paid;
  }

  /** 破产重整: lands go back to the bank, stones reset, the current bar is cleared (realm kept). */
  private bankrupt(seat: number): void {
    const p = this.state.players[seat];
    for (const id of this.board.lands) {
      const t = this.state.tiles[id];
      if (t.owner === seat) { t.owner = null; t.level = 0; }
    }
    p.stones = this.cfg.bankrupt.resetStones;
    p.cult = 0;
    p.stats.bankruptcies++;
    this.emit('bankrupt', `${this.pn(seat)} 破产重整：灵田尽数归还，领取 ${p.stones} 灵石，修为条清零`, { player: seat });
  }

  private gainStones(seat: number, n: number, why: string): void {
    this.state.players[seat].stones += n;
    this.emit('salary', `${this.pn(seat)} ${why} +${n} 灵石`, { player: seat, amount: n });
  }

  private loseStones(seat: number, n: number, why: string): void {
    const p = this.state.players[seat];
    const loss = Math.min(p.stones, n);
    p.stones -= loss;
    this.emit('stones', `${this.pn(seat)} ${why}，失去 ${loss} 灵石`, { player: seat, amount: -loss });
  }

  private gainPills(seat: number, n: number, why: string): void {
    this.state.players[seat].pills += n;
    this.emit('pills', `${this.pn(seat)} ${why} +${n} 丹药`, { player: seat, amount: n });
  }

  private gainHerbs(seat: number, n: number, why: string): void {
    this.state.players[seat].herbs += n;
    this.emit('herbs', `${this.pn(seat)} ${why} +${n} 灵草`, { player: seat, amount: n });
  }

  // ------------------------------------------------------- tiles: 丹房 ... --

  /** 丹房 (GDD §6): 2 灵草 → 1 丹药, as many as the herbs allow; the first 炉 plays 火候. */
  private *alchemy(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const a = this.cfg.alchemy;
    const max = Math.floor(p.herbs / a.herbsPerPill);
    if (max === 0) {
      this.emit('info', `${this.pn(seat)} 灵草不足，无法炼丹`, { player: seat, node });
      return;
    }
    const n = yield* this.askBrew(seat, max, '丹房', '第一炉看火候');
    if (n === 0) return;
    p.herbs -= n * a.herbsPerPill;
    const tier = (yield* this.askHeat(seat)).tier;
    const extra = tier === 'perfect' ? a.perfectBonus : tier === 'fail' ? -1 : 0;
    const pills = n + extra + (hasTrait(this.data, p, 'pillway') ? a.alchBonus : 0);
    p.pills += pills;
    p.stats.pillsMade += pills;
    p.stats.miniGames++;
    this.emit('miniGame', `${this.pn(seat)} 炼丹 ${n} 炉，${TIER_LABEL[tier]}，得 ${pills} 颗丹药`, {
      player: seat, node, amount: pills, miniGame: { tier, brewed: n, pills },
    });
  }

  /** 随身药炉: brew where the 丹师 stands, as at a 丹房 but without 火候 or 丹道. */
  private *furnace(seat: number): Flow {
    const p = this.state.players[seat];
    const per = this.cfg.alchemy.herbsPerPill;
    const n = yield* this.askBrew(seat, Math.floor(p.herbs / per), '随身药炉', '不看火候');
    if (n === 0) return;
    this.state.turn.brewed = true;
    p.herbs -= n * per;
    p.pills += n;
    p.stats.pillsMade += n;
    this.emit('pills', `${this.pn(seat)} 随身药炉炼丹 ${n} 炉，得 ${n} 颗丹药`, { player: seat, node: p.pos, amount: n });
  }

  private canFurnace(seat: number): boolean {
    const st = this.state;
    const p = st.players[seat];
    const t = st.tiles[p.pos];
    return hasTrait(this.data, p, 'furnace') && !st.turn.brewed && p.herbs >= this.cfg.alchemy.herbsPerPill
      && t?.owner === seat && t.level >= this.cfg.alchemy.furnaceLevel;
  }

  private *askBrew(seat: number, max: number, title: string, heat: string): Flow<number> {
    const per = this.cfg.alchemy.herbsPerPill;
    const opts: ChoiceOption<number>[] = [];
    for (let k = max; k >= 0; k--) {
      opts.push({ id: `b${k}`, label: k === 0 ? '不炼' : `炼 ${k} 炉（${k * per} 灵草）`, value: k });
    }
    return yield* this.ask({
      player: seat, kind: 'brew', title, desc: `每 ${per} 灵草炼 1 颗丹药；${heat}`,
      options: opts, defaultId: `b${max}`, cancelId: 'b0',
    });
  }

  private *askHeat(seat: number): Flow<{ tier: MiniGameTier }> {
    return yield* this.ask({
      player: seat, kind: 'miniGame', title: '火候', desc: '看准火候收火：正中多出 1 颗，失手这一炉白费',
      options: (['perfect', 'ok', 'fail'] as const).map((tier) => ({ id: tier, label: TIER_LABEL[tier], value: { tier } })),
      defaultId: 'ok', forceAsk: true,
    });
  }

  private marketOptions(seat: number): ChoiceOption<MarketBuy>[] {
    const p = this.state.players[seat];
    const m = this.cfg.market;
    const opts: ChoiceOption<MarketBuy>[] = [];
    for (let k = 1; k <= Math.min(m.pillMax, Math.floor(p.stones / m.pillPrice)); k++) {
      opts.push({ id: `pill${k}`, label: `丹药 ×${k}（${k * m.pillPrice}）`, value: { item: 'pill', n: k } });
    }
    const room = this.cfg.handLimit - p.hand.length;
    for (let k = 1; k <= Math.min(m.cardMax, room, Math.floor(p.stones / m.cardPrice)); k++) {
      opts.push({ id: `card${k}`, label: `符箓 ×${k}（${k * m.cardPrice}）`, value: { item: 'card', n: k } });
    }
    opts.push({ id: 'none', label: '不买', value: { item: 'none' } });
    return opts;
  }

  private *market(seat: number): Flow {
    const m = this.cfg.market;
    const opts = this.marketOptions(seat);
    if (opts.length === 1) {
      this.emit('info', `${this.pn(seat)} 逛了逛坊市`, { player: seat });
      return;
    }
    const buy = yield* this.ask({
      player: seat, kind: 'market', title: '坊市', desc: `丹药 ${m.pillPrice} 灵石一颗，符箓 ${m.cardPrice} 灵石一张`,
      options: opts, cancelId: 'none', defaultId: 'none', forceAsk: true,
    });
    if (buy.item === 'none') return;
    const p = this.state.players[seat];
    p.stones -= buy.n * (buy.item === 'pill' ? m.pillPrice : m.cardPrice);
    if (buy.item === 'pill') this.gainPills(seat, buy.n, '坊市购得');
    else for (let k = 0; k < buy.n; k++) this.drawSpell(seat);
  }

  /** 妖兽谷: 2D6 + realm ≥ target wins herbs, else lose stones. */
  private beast(seat: number): void {
    const p = this.state.players[seat];
    const b = this.cfg.beast;
    const dice = this.roll2d6();
    const total = dice[0] + dice[1] + p.realm;
    const win = total >= b.target;
    this.emit('beast', `${this.pn(seat)} 斗妖兽（${dice[0]} + ${dice[1]} + 境界 ${p.realm} = ${total}），${win ? '得胜' : '败退'}`, { player: seat, dice, amount: total });
    if (win) this.gainHerbs(seat, b.herbs, '斩获妖兽');
    else this.loseStones(seat, b.loss, '被妖兽所伤');
  }

  // ---------------------------------------------------------- 机缘 cards --

  private drawEventCard(): string {
    const st = this.state;
    if (st.eventDeck.length === 0) {
      st.eventDeck = this.shuffle(st.eventDiscard);
      st.eventDiscard = [];
    }
    return st.eventDeck.shift()!;
  }

  private *drawFortune(seat: number, depth: number): Flow {
    const id = this.drawEventCard();
    this.state.eventDiscard.push(id);
    yield* this.resolveFortune(seat, id, depth);
  }

  /** 古修洞府: draw two, keep one. */
  private *ruins(seat: number, depth: number): Flow {
    const ids = [this.drawEventCard(), this.drawEventCard()];
    this.state.eventDiscard.push(...ids);
    const keep = yield* this.ask({
      player: seat, kind: 'fortunePick', title: '古修洞府', desc: '两张机缘留一张',
      options: ids.map((id, i) => {
        const ev = this.eventById.get(id)!;
        return { id: `f${i}`, label: ev.name, value: id, hint: ev.desc };
      }),
      forceAsk: true,
    });
    yield* this.resolveFortune(seat, keep, depth);
  }

  private *resolveFortune(seat: number, id: string, depth: number): Flow {
    const p = this.state.players[seat];
    const ev = this.eventById.get(id)!;
    const e = ev.effect;
    this.emit('event', `${this.pn(seat)} 机缘【${ev.name}】${ev.desc}`, { player: seat });
    if (e.immuneRealm !== undefined && p.realm >= e.immuneRealm) {
      this.emit('info', `${this.pn(seat)} 元婴护体，安然无恙`, { player: seat });
      return;
    }
    this.applyFortune(seat, ev);
    if (e.rift) yield* this.rift(seat, depth);
  }

  private applyFortune(seat: number, ev: EventCardData): void {
    const p = this.state.players[seat];
    const e = ev.effect;
    if (e.cult) this.addCult(seat, e.cult, 'event', ev.name);
    if (e.herbs) this.gainHerbs(seat, e.herbs, ev.name);
    if (e.pills) this.gainPills(seat, e.pills, ev.name);
    if (e.stones && e.stones > 0) this.gainStones(seat, e.stones, ev.name);
    if (e.stones && e.stones < 0) this.loseStones(seat, -e.stones, ev.name);
    if (e.draw) for (let k = 0; k < e.draw; k++) this.drawSpell(seat);
    if (e.guidance) p.guidance += e.guidance;
    if (e.glow) p.glowRound = this.state.round;
  }

  /** 秘境裂隙: move to any 秘境 and draw again. */
  private *rift(seat: number, depth: number): Flow {
    const here = this.state.players[seat].pos;
    const targets = this.board.allNodeIds().filter((id) => this.board.node(id).type === 'secret' && id !== here);
    const node = yield* this.ask({
      player: seat, kind: 'node', title: '秘境裂隙', desc: '选择要去的秘境，到达后再抽 1 张机缘',
      options: targets.map((id) => ({ id, label: this.nodeLabel(id), value: id, node: id })), ctx: { purpose: 'rift' },
    });
    this.teleport(seat, node, '穿过秘境裂隙');
    yield* this.settle(seat, node, depth + 1);
  }

  // -------------------------------------------------------------- spells ---

  drawSpell(seat: number, silent = false): void {
    const st = this.state;
    const p = st.players[seat];
    if (st.spellDeck.length === 0) {
      st.spellDeck = this.shuffle(st.spellDiscard);
      st.spellDiscard = [];
    }
    const card = st.spellDeck.shift();
    if (!card) return;
    if (p.hand.length >= this.cfg.handLimit) {
      st.spellDiscard.push(card);
      if (!silent) this.emit('card', `${this.pn(seat)} 手牌已满，【${this.spellName(card)}】作废`, { player: seat });
      return;
    }
    p.hand.push(card);
    if (!silent) this.emit('card', `${this.pn(seat)} 获得符箓【${this.spellName(card)}】`, { player: seat });
  }

  // -------------------------------------------------------------- action ---

  private upgradeOptions(seat: number): ChoiceOption<ActionAct>[] {
    const p = this.state.players[seat];
    const opts: ChoiceOption<ActionAct>[] = [];
    for (const id of this.board.lands) {
      const t = this.state.tiles[id];
      if (t.owner !== seat || t.level >= maxLevel(this.data)) continue;
      const cost = upgradeCost(this.data, this.board.node(id).price!, t.level + 1);
      if (p.stones < cost) continue;
      const to = this.data.board.buildings[t.level + 1].name;
      opts.push({ id: `upgrade:${id}`, label: `升级 ${this.nodeName(id)} → ${to}（${cost}）`, value: { t: 'upgrade', node: id }, node: id });
    }
    return opts;
  }

  private actionOptions(seat: number): ChoiceOption<ActionAct>[] {
    const st = this.state;
    const p = st.players[seat];
    const opts = st.turn.upgraded ? [] : this.upgradeOptions(seat);
    if (!st.turn.ate && p.pills > 0) {
      opts.push({ id: 'eat', label: `服丹（+${this.cfg.cultivation.pill} 修为）`, value: { t: 'eat' } });
    }
    if (this.canFurnace(seat)) opts.push({ id: 'brew', label: '随身药炉 · 炼丹', value: { t: 'brew' }, hint: '不看火候' });
    if (this.hasCard(p, 'drain') && this.drainTargets(seat).length > 0) opts.push(this.cardOption('drain', { t: 'cast', card: 'drain' }));
    if (this.hasCard(p, 'bind') && this.bindTargets(seat).length > 0) opts.push(this.cardOption('bind', { t: 'cast', card: 'bind' }));
    if (this.skillAvailable(seat, 'action')) opts.push(this.skillOption(seat));
    if (this.canCloseNow(seat)) opts.push(this.closureOption(seat, { t: 'closure' }));
    opts.push({ id: 'end', label: '结束回合', value: { t: 'end' } });
    return opts;
  }

  private *actionPhase(seat: number): Flow {
    for (;;) {
      const act = yield* this.ask({
        player: seat, kind: 'action', title: '行动阶段', desc: '升级 1 块地、服丹、用符、技能、闭关突破',
        options: this.actionOptions(seat), defaultId: 'end', forceAsk: true,
      });
      switch (act.t) {
        case 'end': return;
        case 'upgrade': this.upgrade(seat, act.node); break;
        case 'eat': this.eatPill(seat); break;
        case 'brew': yield* this.furnace(seat); break;
        case 'cast': yield* this.castAction(seat, act.card); break;
        case 'skill': yield* this.useSkill(seat); break;
        case 'closure': yield* this.closure(seat); break;
      }
    }
  }

  upgrade(seat: number, node: NodeId): void {
    const p = this.state.players[seat];
    const t = this.state.tiles[node];
    const lv = t.level + 1;
    const cost = upgradeCost(this.data, this.board.node(node).price!, lv);
    p.stones -= cost;
    t.level = lv;
    this.state.turn.upgraded = true;
    this.emit('upgrade', `${this.pn(seat)} 将【${this.nodeName(node)}】升为${this.data.board.buildings[lv].name}（${cost} 灵石）`, { player: seat, node, amount: cost });
  }

  private eatPill(seat: number): void {
    const p = this.state.players[seat];
    p.pills--;
    p.stats.pillsEaten++;
    this.state.turn.ate = true;
    this.addCult(seat, this.cfg.cultivation.pill, 'pill', '服丹');
  }

  drainTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && o.pills > 0).map((o) => o.seat);
  }

  bindTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && !o.bound).map((o) => o.seat);
  }

  private targetOption(tg: Target): ChoiceOption<Target> {
    if (tg.t === 'player') return { id: `p${tg.seat}`, label: `${this.pn(tg.seat)}（丹药 ${this.state.players[tg.seat].pills}）`, value: tg };
    if (tg.t === 'node') return { id: `node:${tg.node}`, label: this.nodeLabel(tg.node), value: tg, node: tg.node };
    return { id: 'cancel', label: '取消', value: tg };
  }

  private *askTarget(seat: number, title: string, desc: string, targets: Target[], purpose: ChoicePurpose): Flow<Target> {
    const opts = targets.map((t) => this.targetOption(t));
    opts.push(this.targetOption({ t: 'cancel' }));
    return yield* this.ask({ player: seat, kind: 'target', title, desc, options: opts, cancelId: 'cancel', ctx: { purpose } });
  }

  private *askPlayer(seat: number, card: string, seats: number[]): Flow<number | null> {
    const s = this.spellById.get(card)!;
    const tg = yield* this.askTarget(seat, s.name, s.desc, seats.map((x) => ({ t: 'player' as const, seat: x })), card as ChoicePurpose);
    return tg.t === 'player' ? tg.seat : null;
  }

  private *castAction(seat: number, card: string): Flow {
    const target = yield* this.askPlayer(seat, card, card === 'drain' ? this.drainTargets(seat) : this.bindTargets(seat));
    if (target === null) return;
    this.payCard(seat, card);
    if (card === 'bind') {
      this.state.players[target].bound = true;
      this.emit('bind', `${this.pn(target)} 被定身，下回合无法移动`, { player: target });
      return;
    }
    if (yield* this.guard(target, 'drain', seat)) return;
    this.stealPills(seat, target, 1);
  }

  private stealPills(to: number, from: number, n: number): number {
    const o = this.state.players[from];
    const k = Math.min(n, o.pills);
    o.pills -= k;
    o.stats.pillsLost += k;
    this.state.players[to].pills += k;
    this.emit('pills', `${this.pn(to)} 从 ${this.pn(from)} 处夺得 ${k} 颗丹药`, { player: to, amount: k });
    return k;
  }

  /** Defender may answer with 金光符. Returns true if the threat is blocked. */
  private *guard(defender: number, threat: ThreatKind, attacker: number): Flow<boolean> {
    if (!this.hasCard(this.state.players[defender], 'goldlight')) return false;
    const what = threat === 'duel' ? '斗法' : '夺灵符';
    const use = yield* this.ask({
      player: defender, kind: 'guardReact', title: '是否反制？', desc: `${this.pn(attacker)} 对你发起${what}`,
      options: [
        { id: 'goldlight', label: '金光符 · 抵挡', value: true },
        { id: 'no', label: '不反制', value: false },
      ],
      defaultId: 'no', cancelId: 'no', ctx: { threat, attacker },
    });
    if (!use) return false;
    this.payCard(defender, 'goldlight');
    this.emit('block', `${this.pn(defender)} 金光符护体，挡下了${what}`, { player: defender });
    return true;
  }

  // --------------------------------------------------------- 闭关突破 ---

  /**
   * 闭关突破 (GDD §5.3): stake 0–3 pills, roll 2D6 + bonuses against the realm's target.
   * Nothing is spent until a stake is picked, so the stake ask offers 返回; `viaSkill` (引雷破境) pays the skill only then.
   * Returns false when the player backed out.
   */
  private *closure(seat: number, site = closureSite(this.state, this.data, seat, this.state.players[seat].pos)!, viaSkill = false): Flow<boolean> {
    const st = this.state;
    const p = st.players[seat];
    const skillPills = viaSkill ? this.heroOf(seat).skill.pillCost : 0;
    const stake = yield* this.askStake(seat, site, p.pills - skillPills);
    if (stake === null) return false;
    if (viaSkill) this.spendSkill(seat);
    st.turn.closed = true;
    const calm = yield* this.askCalm(seat, site, stake);
    const r = this.rollBreakthrough(seat, site, stake, calm, realmOf(this.data, p.realm).target);
    p.pills -= stake;
    p.insight = 0;
    p.momentum = false;
    if (p.guidance > 0) p.guidance--;
    p.stats.breakthroughs++;
    if (r.success) this.ascendRealm(seat, r);
    else this.failBreakthrough(seat, r);
    return true;
  }

  private *askStake(seat: number, site: number, pills: number): Flow<number | null> {
    const p = this.state.players[seat];
    const b = this.cfg.breakthrough;
    const odds = closureOdds(this.state, this.data, seat, site, { pills });
    const opts: ChoiceOption<number | null>[] = odds.stakes.map((s) => ({
      id: `s${s.pills}`, label: s.pills === 0 ? '不押丹' : `押 ${s.pills} 颗（+${s.pills * b.pillBonus}）`, value: s.pills,
      hint: `需掷出 ${s.need} 以上，成功 ${percent(s.chance)}`,
    }));
    opts.push({ id: 'back', label: '返回', value: null });
    const calm = odds.calm ? `（含清心符 +${odds.calm}）` : '';
    return yield* this.ask({
      player: seat, kind: 'stake', title: `闭关 · ${this.realmLabel(seat)}冲${realmName(this.data, p.realm + 1)}`,
      desc: `2D6 + 加成 ≥ ${odds.target}。地点与心境等加成 ${odds.bonus >= 0 ? '+' : ''}${odds.bonus}${calm}，每颗丹药 +${b.pillBonus}，押上的丹药无论成败都会消耗。`,
      options: opts, defaultId: 's0', cancelId: 'back', ctx: { bonus: odds.bonus, target: odds.target, site },
    });
  }

  private *askCalm(seat: number, site: number, stake: number): Flow<boolean> {
    if (!this.hasCard(this.state.players[seat], 'calm')) return false;
    const odds = closureOdds(this.state, this.data, seat, site).stakes[stake];
    const without = chance2d6(odds.need + this.cfg.breakthrough.calmBonus);
    const use = yield* this.ask({
      player: seat, kind: 'calm', title: '清心符',
      desc: `本次突破 +${this.cfg.breakthrough.calmBonus}？用：成功 ${percent(odds.chance)}；不用：${percent(without)}`,
      options: [
        { id: 'calm', label: '使用清心符', value: true },
        { id: 'no', label: '不用', value: false },
      ],
      defaultId: 'calm', cancelId: 'no',
    });
    if (use) this.payCard(seat, 'calm');
    return use;
  }

  private rollBreakthrough(seat: number, site: number, stake: number, calm: boolean, target: number): BreakthroughResult {
    const p = this.state.players[seat];
    const b = this.cfg.breakthrough;
    const bonuses: BreakthroughBonuses = {
      pills: stake * b.pillBonus,
      ...fixedBonuses(this.state, this.data, seat, site),
      calm: calm ? b.calmBonus : 0,
    };
    const dice = this.roll2d6();
    const total = dice[0] + dice[1] + Object.values(bonuses).reduce((a, v) => a + v, 0);
    return { from: p.realm, dice, stake, bonuses, total, target, success: total >= target, cultLost: 0 };
  }

  private breakdown(r: BreakthroughResult): string {
    const names: [keyof BreakthroughResult['bonuses'], string][] = [
      ['pills', '押丹'], ['site', '地点'], ['mind', '心境'], ['guidance', '指点'], ['insight', '感悟'], ['momentum', '战意'], ['calm', '清心'],
    ];
    const parts = names.filter(([k]) => r.bonuses[k] !== 0).map(([k, n]) => `${r.bonuses[k] > 0 ? '+' : '−'} ${n} ${Math.abs(r.bonuses[k])}`);
    return `${r.dice[0]} + ${r.dice[1]}${parts.map((s) => ` ${s}`).join('')} = ${r.total}（目标 ${r.target}）`;
  }

  private ascendRealm(seat: number, r: BreakthroughResult): void {
    const p = this.state.players[seat];
    p.realm++;
    p.cult = 0;
    p.mind = 0;
    const to = realmOf(this.data, p.realm);
    const gain = to.ability ? `，领悟${this.abilityName(to.ability)}` : '';
    this.emit('breakthrough', `${this.pn(seat)} 闭关：${this.breakdown(r)}，突破成功！晋入${to.name}${gain}`, {
      player: seat, dice: r.dice, amount: p.realm, breakthrough: r,
    });
    if (p.realm >= winRealm(this.data)) this.endGame(seat, 'ascend');
  }

  private failBreakthrough(seat: number, r: BreakthroughResult): void {
    const p = this.state.players[seat];
    const keep = hasTrait(this.data, p, 'steadyBar') ? p.cult : Math.floor(p.cult / 2);
    r.cultLost = p.cult - keep;
    p.cult = keep;
    p.mind++;
    p.stats.breakthroughFails++;
    const loss = r.cultLost > 0 ? `修为 −${r.cultLost}` : '修为未损';
    this.emit('breakthrough', `${this.pn(seat)} 闭关：${this.breakdown(r)}，走火入魔！${loss}，心境 +1`, {
      player: seat, dice: r.dice, amount: p.realm, breakthrough: r,
    });
  }

  abilityName(a: NonNullable<ReturnType<typeof realmOf>['ability']>): string {
    return { steer: '御器', sense: '神识', escape: '元婴遁' }[a];
  }

  // ---------------------------------------------------------------- 斗法 --

  heroOf(seat: number): HeroData {
    return this.data.heroes.find((h) => h.id === this.state.players[seat].hero)!;
  }

  /** What the loser of a duel would hand over now: pills (2 when glowing), else stones. */
  duelLoot(loser: number): { pills: number; stones: number } {
    const p = this.state.players[loser];
    const d = this.cfg.duel;
    if (p.pills > 0) return { pills: Math.min(p.pills, isGlowing(this.state, this.data, loser) ? d.glowSteal : d.steal), stones: 0 };
    return { pills: 0, stones: Math.min(p.stones, d.lossStones) };
  }

  /** Players the mover may challenge now: on the landing tile or passed on the way. */
  duelCandidates(seat: number): number[] {
    const st = this.state;
    if (st.turn.duelDone || st.turn.seat !== seat) return [];
    const here = st.players.filter((o) => o.seat !== seat && o.pos === st.players[seat].pos).map((o) => o.seat);
    return [...new Set([...here, ...st.turn.passed])].sort((a, b) => a - b);
  }

  private *offerDuel(seat: number): Flow {
    const cands = this.duelCandidates(seat);
    this.state.turn.passed = [];
    if (cands.length === 0) return;
    const opts: ChoiceOption<number | null>[] = cands.map((s) => {
      const [a, d] = duelBonus(this.state, this.data, seat, s);
      const loot = this.duelLoot(s);
      return {
        id: `p${s}`, label: `挑战 ${this.pn(s)}`, value: s, node: this.state.players[s].pos,
        hint: `加成 ${a} 对 ${d}；胜可夺${loot.pills ? ` ${loot.pills} 颗丹药` : ` ${loot.stones} 灵石`}`,
      };
    });
    opts.push({ id: 'none', label: '不斗法', value: null });
    const target = yield* this.ask({
      player: seat, kind: 'duel', title: '斗法',
      desc: '双方各掷 1D6 加境界差与加成，点高者胜（平局守方胜）。赢家夺 1 颗丹药（对方冒宝光则 2 颗），没有丹药则夺灵石。',
      options: opts, defaultId: 'none', cancelId: 'none',
    });
    if (target !== null) yield* this.duel(seat, target);
  }

  private *duel(attacker: number, defender: number): Flow {
    const st = this.state;
    st.turn.duelDone = true;
    st.players[attacker].stats.duels++;
    this.emit('info', `${this.pn(attacker)} 向 ${this.pn(defender)} 发起斗法！`, { player: attacker, node: st.players[defender].pos });
    if (yield* this.guard(defender, 'duel', attacker)) return;
    const rolls: [number, number] = [this.d6(), this.d6()];
    const bonus = duelBonus(st, this.data, attacker, defender);
    const totals: [number, number] = [rolls[0] + bonus[0], rolls[1] + bonus[1]];
    const winner = totals[0] > totals[1] ? attacker : defender;
    const loser = winner === attacker ? defender : attacker;
    st.players[winner].stats.duelWins++;
    const duel: DuelResult = { attacker, defender, rolls, bonus, totals, winner, loser, ...this.plunder(winner, loser) };
    const part = (i: 0 | 1) => `${rolls[i]}${bonus[i] ? ` + ${bonus[i]}` : ''} = ${totals[i]}`;
    const prize = duel.escaped ? '，元婴遁走，未被夺宝' : duel.pills ? `，夺得 ${duel.pills} 颗丹药` : `，夺得 ${duel.stones} 灵石`;
    this.emit('duel', `斗法：${this.pn(attacker)} ${part(0)} 对 ${this.pn(defender)} ${part(1)}，${this.pn(winner)} 胜${totals[0] === totals[1] ? '（平局守方胜）' : ''}${prize}`, {
      player: winner, node: st.players[defender].pos, amount: duel.pills || duel.stones, duel,
    });
    if (winner === attacker) this.gainMomentum(attacker);
  }

  private gainMomentum(seat: number): void {
    const p = this.state.players[seat];
    if (!hasTrait(this.data, p, 'momentum') || p.momentum) return;
    p.momentum = true;
    this.emit('status', `${this.pn(seat)} 斗法得胜，战意未消：下次闭关突破 +${this.cfg.breakthrough.momentumBonus}`, { player: seat });
  }

  /** 夺宝 with 元婴遁 (once per round). */
  private plunder(winner: number, loser: number): { pills: number; stones: number; escaped: boolean } {
    const st = this.state;
    const pl = st.players[loser];
    if (hasAbility(this.data, pl, 'escape') && pl.escapeRound !== st.round) {
      pl.escapeRound = st.round;
      return { pills: 0, stones: 0, escaped: true };
    }
    const loot = this.duelLoot(loser);
    pl.pills -= loot.pills;
    pl.stats.pillsLost += loot.pills;
    pl.stones -= loot.stones;
    st.players[winner].pills += loot.pills;
    st.players[winner].stones += loot.stones;
    return { ...loot, escaped: false };
  }

  // ---------------------------------------------------------------- 技能 --

  skillReady(seat: number): boolean {
    const p = this.state.players[seat];
    return p.turnsTaken >= p.skillReadyTurn;
  }

  /** Targets of the hero's active skill (players for 剑遁 / 迷魂丹, ring nodes for 镇山, none for 引雷破境). */
  skillTargets(seat: number): number[] | NodeId[] {
    const st = this.state;
    const p = st.players[seat];
    const others = st.players.filter((o) => o.seat !== seat && o.pos !== p.pos);
    const r = this.cfg.rules;
    switch (this.heroOf(seat).skill.id) {
      case 'sworddash':
        if (st.turn.duelDone) return [];
        return others.filter((o) => this.board.distance(p.pos, o.pos) <= r.swordDashRange).map((o) => o.seat);
      case 'thunder':
        return [];
      case 'daze':
        return st.players.filter((o) => o.seat !== seat && !o.dazed).map((o) => o.seat);
      case 'roadblock':
        return this.roadblockSpots(seat);
    }
  }

  private roadblockSpots(seat: number): NodeId[] {
    const st = this.state;
    const p = st.players[seat];
    if (!this.board.node(p.pos).outer || st.roadblock) return [];
    const out: NodeId[] = [];
    let n = p.pos;
    for (let k = 0; k < this.cfg.rules.roadblockRange; k++) {
      n = this.board.mainStep(n, 1);
      if (!st.players.some((o) => o.pos === n)) out.push(n);
    }
    return out;
  }

  private skillAvailable(seat: number, phase: 'preroll' | 'action'): boolean {
    const sk = this.heroOf(seat).skill;
    if (sk.timing !== phase || !this.skillReady(seat) || this.state.players[seat].pills < sk.pillCost) return false;
    return sk.id === 'thunder' ? this.canThunder(seat) : this.skillTargets(seat).length > 0;
  }

  /** 引雷破境 has a use: a full bar on a tile where no ordinary 闭关 is possible. */
  private canThunder(seat: number): boolean {
    const st = this.state;
    const p = st.players[seat];
    return !st.turn.closed && barFull(this.data, p) && closureSite(st, this.data, seat, p.pos) === null;
  }

  private skillOption(seat: number): ChoiceOption<{ t: 'skill' }> {
    const sk = this.heroOf(seat).skill;
    return { id: 'skill', label: `技能【${sk.name}】（${skillTerms(sk)}）`, value: { t: 'skill' }, hint: sk.desc };
  }

  private spendSkill(seat: number): void {
    const p = this.state.players[seat];
    const sk = this.heroOf(seat).skill;
    p.skillReadyTurn = p.turnsTaken + sk.cooldown;
    p.pills -= sk.pillCost;
    p.stats.skillUses++;
    const cost = sk.pillCost > 0 ? `，耗 ${sk.pillCost} 颗丹药` : '';
    this.emit('skill', `${this.pn(seat)} 施展技能【${sk.name}】${cost}`, { player: seat });
  }

  /** Returns 'moved' when the skill replaced this turn's roll (剑遁), 'cancel' when backed out. */
  private *useSkill(seat: number): Flow<'moved' | 'ok' | 'cancel'> {
    const sk = this.heroOf(seat).skill;
    if (sk.id === 'roadblock') return yield* this.placeRoadblock(seat);
    if (sk.id === 'thunder') return (yield* this.closure(seat, this.cfg.breakthrough.thunderSite, true)) ? 'ok' : 'cancel';
    const seats = this.skillTargets(seat) as number[];
    const tg = yield* this.askTarget(seat, sk.name, sk.desc, seats.map((x) => ({ t: 'player' as const, seat: x })), sk.id);
    if (tg.t !== 'player') return 'cancel';
    this.spendSkill(seat);
    if (sk.id === 'sworddash') {
      yield* this.swordDash(seat, tg.seat);
      return 'moved';
    }
    this.daze(tg.seat);
    return 'ok';
  }

  private *placeRoadblock(seat: number): Flow<'ok' | 'cancel'> {
    const sk = this.heroOf(seat).skill;
    const nodes = this.skillTargets(seat) as NodeId[];
    const tg = yield* this.askTarget(seat, sk.name, sk.desc, nodes.map((node) => ({ t: 'node' as const, node })), 'roadblock');
    if (tg.t !== 'node') return 'cancel';
    this.spendSkill(seat);
    this.state.roadblock = { node: tg.node, seat };
    this.emit('roadblock', `${this.pn(seat)} 在【${this.nodeName(tg.node)}】落下山岳`, { player: seat, node: tg.node });
    return 'ok';
  }

  private *swordDash(seat: number, target: number): Flow {
    const p = this.state.players[seat];
    const o = this.state.players[target];
    this.teleport(seat, o.pos, `剑遁追至 ${this.pn(target)} 身前`);
    p.cameFrom = o.cameFrom;
    this.state.turn.lastPath = [];
    yield* this.duel(seat, target);
    yield* this.settle(seat, p.pos);
  }

  private daze(target: number): void {
    this.state.players[target].dazed = true;
    this.emit('status', `${this.pn(target)} 中了迷魂丹，下次移动步数减半`, { player: target });
  }

  // ------------------------------------------------------------- 修为 ---

  /** Adds to the current bar, capped at its size; the overflow becomes 感悟 (过目不忘) or is wasted (GDD §5.1). */
  addCult(seat: number, n: number, source: CultSource, why: string): void {
    const p = this.state.players[seat];
    if (p.realm >= winRealm(this.data) || n === 0) return;
    const room = barSize(this.data, p) - p.cult;
    const gained = n > 0 ? Math.min(n, room) : -Math.min(p.cult, -n);
    const over = n > 0 ? n - gained : 0;
    const insight = Math.min(over, insightRoom(this.data, p));
    const change: CultChange = { source, gained, insight, wasted: over - insight };
    p.cult += gained;
    p.insight += insight;
    p.stats.cultWasted += change.wasted;
    this.emit('cult', `${this.pn(seat)} ${why}，修为 ${n > 0 ? '+' : ''}${n}${this.cultTail(p, change)}`, {
      player: seat, amount: gained, cult: change,
    });
  }

  private cultTail(p: PlayerState, c: CultChange): string {
    const parts = [c.insight > 0 ? `存为感悟 ${c.insight}` : '', c.wasted > 0 ? `作废 ${c.wasted}` : ''].filter(Boolean);
    if (parts.length) return `（修为条已满，${parts.join('，')}）`;
    return barFull(this.data, p) && c.gained > 0 ? '（修为条已满，可闭关突破）' : '';
  }

  // ------------------------------------------------------------ 白泽现世 --

  /** Players from last to first: realm, bar, assets ascending. */
  manifestOrder(): number[] {
    return this.ranking().reverse();
  }

  private *manifest(): Flow {
    const st = this.state;
    st.manifested = true;
    this.emit('manifest', '白泽现世！秘境过半，落后的人先挑一份机缘。');
    const gifts: ManifestGift[] = ['chart', 'stones', 'pills', 'guide'];
    for (const seat of this.manifestOrder()) {
      const g = yield* this.ask({
        player: seat, kind: 'manifestPick', title: '白泽现世', desc: '挑一份机缘',
        options: gifts.map((id) => ({ id, label: GIFT_LABEL[id], value: id, hint: this.giftDesc(id) })),
        forceAsk: true,
      });
      gifts.splice(gifts.indexOf(g), 1);
      this.applyGift(seat, g);
    }
  }

  private giftDesc(g: ManifestGift): string {
    const m = this.cfg.manifest;
    return { chart: `+${m.chartCult} 修为`, stones: `+${m.giftStones} 灵石`, pills: `+${m.giftPills} 丹药`, guide: '立即移动到白泽灵台' }[g];
  }

  private applyGift(seat: number, g: ManifestGift): void {
    const m = this.cfg.manifest;
    if (g === 'chart') this.addCult(seat, m.chartCult, 'manifest', '白泽图');
    else if (g === 'stones') this.gainStones(seat, m.giftStones, '灵脉馈赠');
    else if (g === 'pills') this.gainPills(seat, m.giftPills, '丹霞');
    else this.teleport(seat, ALTAR, '白泽指路');
  }

  // ---------------------------------------------------------------- end --

  private endGame(seat: number, reason: EndReason): never {
    const st = this.state;
    st.over = true;
    st.winner = seat;
    st.endReason = reason;
    this.pending = null;
    this.emit('win', reason === 'ascend'
      ? `${this.pn(seat)} 渡劫化神，飞升而去！`
      : `第 ${this.cfg.rounds} 轮结束，秘境关闭，${this.pn(seat)} 境界最高，夺得魁首！`, { player: seat });
    this.emit('gameEnd', '本局结束', { player: seat });
    throw new GameOverSignal(seat);
  }

  /** Players ordered by standing: realm, then bar, then total assets (GDD §11). */
  ranking(): number[] {
    return this.state.players.map((p) => p.seat).sort((a, b) => compareStanding(this.state, this.board, this.data, a, b));
  }

  private finishByRoundCap(): void {
    try {
      this.endGame(this.ranking()[0], 'roundCap');
    } catch (e) {
      if (!(e instanceof GameOverSignal)) throw e;
    }
  }

  // -------------------------------------------------- test / debug hooks --

  /** Run an isolated movement for tests: walks `steps` from the current position and settles. */
  *debugMove(seat: number, steps: number, dir: 1 | -1 = 1): Flow {
    this.state.current = seat;
    this.state.turn = this.freshTurn(seat);
    yield* this.walk(seat, steps, dir);
    yield* this.settle(seat, this.state.players[seat].pos);
  }

  /** Drive an arbitrary engine sub-flow with scripted answers (tests). Swallows the win signal. */
  runFlow(flow: Flow<unknown>, answer: (c: PendingChoice) => string): void {
    try {
      let r = flow.next(undefined as unknown as string);
      while (!r.done) r = flow.next(answer(r.value));
    } catch (e) {
      if (!(e instanceof GameOverSignal)) throw e;
    }
  }

  testPayRent(seat: number, node: NodeId): Flow { return this.payRent(seat, node); }
  testDuel(attacker: number, defender: number): Flow { return this.duel(attacker, defender); }
  testUseSkill(seat: number): Flow<'moved' | 'ok' | 'cancel'> { return this.useSkill(seat); }
  testSettle(seat: number, node: NodeId): Flow { this.state.current = seat; return this.settle(seat, node); }
  testActionPhase(seat: number): Flow { this.state.current = seat; return this.actionPhase(seat); }
  testClosure(seat: number): Flow<boolean> { this.state.current = seat; return this.closure(seat); }
  testRoundStart(): Flow { return this.roundStart(); }
  testTurnEnd(seat: number): void { this.turnEnd(seat); }
  testFortune(seat: number, id: string): Flow { return this.resolveFortune(seat, id, 0); }
  /** A full turn for `seat` (dice from the game rng). */
  testPlayTurn(seat: number): Flow {
    this.state.current = seat;
    return this.playTurn(seat);
  }
  /** One move of `total` steps for `seat` as in a normal turn (迷魂丹, 斗法 offer, settle), skipping the dice. */
  *testMove(seat: number, total: number): Flow {
    this.state.current = seat;
    this.state.turn = this.freshTurn(seat);
    yield* this.doMove(seat, total);
  }
}
