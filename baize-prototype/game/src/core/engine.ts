// ---------------------------------------------------------------------------
// Rules engine for 白泽秘境大富翁 (pure TypeScript, no Phaser).
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
  ActionAct, ChoiceKind, ChoiceOption, ChoiceSpec, ChoiceValueMap, PendingChoice, PendingChoiceOf,
  PreRollAct, Target, ThreatKind,
} from './choices';
import { defaultData } from './data';
import type { DuelResult, GameEvent, GameEventType } from './events';
import { hashSeed, nextFloat } from './rng';
import {
  breakthroughCost, breakthroughsAvailable, buyPrice, canBreakthrough, cultivation, realmName, rentFor, totalAssets,
  upgradeCost,
} from './rules';
import type {
  EventCardData, GameData, GameSetup, GameState, HeroData, MiniGameTier, NodeId, PlayerState, SpellData, TurnState,
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

interface SettleCtx {
  depth?: number;
}

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

  cult(seat: number): number {
    return cultivation(this.state, this.data, seat);
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

  pn(seat: number): string {
    return this.state.players[seat].name;
  }

  nodeName(id: NodeId): string {
    return this.board.node(id).name;
  }

  spellName(id: string): string {
    return this.spellById.get(id)?.name ?? id;
  }

  private get cfg() {
    return this.data.config;
  }

  // -------------------------------------------------------------- setup ----

  private createInitialState(): GameState {
    const cfg = this.data.config;
    const spellDeck: string[] = [];
    for (const c of this.data.spells.cards) for (let k = 0; k < this.data.spells.copiesEach; k++) spellDeck.push(c.id);
    const tiles: GameState['tiles'] = {};
    for (const id of this.board.lands) tiles[id] = { owner: null, level: 0 };
    const st: GameState = {
      seed: this.setup.seed,
      rng: hashSeed(this.setup.seed),
      round: 0,
      current: 0,
      over: false,
      winner: null,
      endReason: null,
      players: this.setup.players.map((sp, i) => ({
        seat: i, name: sp.name, hero: sp.hero, pos: this.board.startId, cameFrom: null,
        stones: cfg.startStones + cfg.seatBonusStones[i], pills: cfg.startPills, cultBase: 0, peakCult: 0, btEarned: 0, btUsed: 0,
        hand: [], bound: false, turnsTaken: 0, chooseRoll: false,
        badStreak: 0, milestones: [], skillReadyTurn: 0, duelShieldRound: 0, dazed: false,
        stats: {
          rentCollected: 0, rentPaid: 0, breakthroughs: 0, roadEntries: 0,
          altarVisits: 0, bankruptcies: 0, duels: 0, duelWins: 0, skillUses: 0, miniGames: 0,
        },
      })),
      tiles,
      spellDeck,
      spellDiscard: [],
      eventDeck: this.data.events.events.map((e) => e.id),
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

  private freshTurn(seat: number): TurnState {
    return { seat, upgraded: false, swiftstep: false, reverse: false, lastPath: [], lastDir: 1, duelDone: false, passed: [], diceCard: false };
  }

  // ------------------------------------------------------------ main loop --

  private *run(): Flow {
    try {
      for (const p of this.state.players) for (let k = 0; k < this.cfg.startHand; k++) this.drawSpell(p.seat, true);
      this.emit('gameStart', '白泽秘境开启，众散修踏入秘境。');
      const bonus = this.state.players.filter((p) => this.cfg.seatBonusStones[p.seat] > 0)
        .map((p) => `${this.pn(p.seat)} +${this.cfg.seatBonusStones[p.seat]}`);
      if (bonus.length) this.emit('info', `后手补偿灵石：${bonus.join('，')}`);
      for (let r = 1; r <= this.cfg.rounds; r++) {
        this.state.round = r;
        this.roundStart();
        for (let s = 0; s < this.state.players.length; s++) {
          this.state.current = s;
          yield* this.playTurn(s);
        }
        this.emit('roundEnd', `第 ${this.state.round} 轮结束`);
      }
      this.finishByRoundCap();
    } catch (e) {
      if (!(e instanceof GameOverSignal)) throw e;
    }
  }

  private roundStart(): void {
    const st = this.state;
    this.emit('roundStart', `—— 第 ${st.round} / ${this.cfg.rounds} 轮 ——`);
    if (st.round === this.cfg.baizeManifestRound && !st.manifested) {
      st.manifested = true;
      this.emit('manifest', '白泽现世！灵雨普降，本轮所有租金减半。', {});
    }
  }

  private *playTurn(seat: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    p.turnsTaken++;
    st.turn = this.freshTurn(seat);
    this.emit('turnStart', `${this.pn(seat)} 的回合`, { player: seat });
    if (st.roadblock && st.roadblock.seat === seat) {
      const node = st.roadblock.node;
      st.roadblock = null;
      this.emit('roadblockGone', `${this.pn(seat)} 的山岳消散`, { player: seat, node });
    }
    if (p.bound) {
      p.bound = false;
      this.emit('bind', `${this.pn(seat)} 被定身，本回合无法移动。`, { player: seat });
    } else if ((yield* this.preRollPhase(seat)) === 'roll') {
      yield* this.rollAndMove(seat);
    }
    yield* this.actionPhase(seat);
    this.emit('turnEnd', `${this.pn(seat)} 结束回合`, { player: seat });
  }

  private *rollAndMove(seat: number): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    if (t.diceCard || p.chooseRoll) {
      const byCard = t.diceCard;
      const r = this.cfg.rules;
      const [min, max, title] = byCard ? [r.diceCardMin, r.diceCardMax, '御骰符'] : [r.beastRollMin, r.beastRollMax, '灵兽引路'];
      if (byCard) t.diceCard = false;
      else p.chooseRoll = false;
      const opts: ChoiceOption<number>[] = [];
      for (let v = min; v <= max; v++) opts.push({ id: `v${v}`, label: `${v} 点`, value: v });
      const v = yield* this.ask({ player: seat, kind: 'rollValue', title, desc: '选择本次移动点数', options: opts, forceAsk: true });
      this.emit('roll', `${this.pn(seat)} ${title}，选择 ${v} 点`, { player: seat, amount: v });
      yield* this.doMove(seat, v);
      return;
    }
    const dice: [number, number] = [this.d6(), this.d6()];
    this.emit('roll', `${this.pn(seat)} 掷出 ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`, { player: seat, dice, amount: dice[0] + dice[1] });
    yield* this.doMove(seat, dice[0] + dice[1], dice);
  }

  // ------------------------------------------------------------ pre-roll ---

  private hasCard(p: PlayerState, card: string): boolean {
    return p.hand.includes(card) && p.pills >= this.spellById.get(card)!.cost;
  }

  /** Remove card from hand, pay its 灵丹 cost, discard it. */
  private payCard(seat: number, card: string): void {
    const p = this.state.players[seat];
    const i = p.hand.indexOf(card);
    if (i < 0) throw new Error(`${card} not in hand`);
    const s = this.spellById.get(card)!;
    p.hand.splice(i, 1);
    p.pills -= s.cost;
    this.state.spellDiscard.push(card);
    this.emit('cast', `${this.pn(seat)} 施放【${s.name}】`, { player: seat });
  }

  private *preRollPhase(seat: number): Flow<'roll' | 'moved'> {
    const p = this.state.players[seat];
    const t = this.state.turn;
    for (;;) {
      const opts: ChoiceOption<PreRollAct>[] = [{ id: 'roll', label: '掷骰子', value: { t: 'roll' } }];
      const onRing = this.board.node(p.pos).outer;
      for (const card of new Set(p.hand)) {
        const s = this.spellById.get(card)!;
        if (s.timing !== 'preroll' || !this.hasCard(p, card)) continue;
        if (card === 'swiftstep' && t.swiftstep) continue;
        if (card === 'reverse' && (t.reverse || !onRing)) continue;
        if (card === 'dice' && t.diceCard) continue;
        opts.push({ id: `cast:${card}`, label: `${s.name}（${s.cost} 灵丹）`, value: { t: 'cast', card }, hint: s.desc });
      }
      if (this.skillAvailable(seat, 'preroll')) opts.push(this.skillOption(seat));
      const act = yield* this.ask({
        player: seat, kind: 'preRoll', title: '掷骰前', desc: '可施放身法符，或直接掷骰。',
        options: opts, defaultId: 'roll', forceAsk: true,
      });
      if (act.t === 'roll') return 'roll';
      if (act.t === 'skill') {
        if ((yield* this.useSkill(seat)) === 'moved') return 'moved';
        continue;
      }
      this.payCard(seat, act.card);
      if (act.card === 'swiftstep') t.swiftstep = true;
      else if (act.card === 'reverse') t.reverse = true;
      else if (act.card === 'dice') t.diceCard = true;
    }
  }

  // --------------------------------------------------------------- moving --

  private *doMove(seat: number, base: number, dice?: [number, number]): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    let total = yield* this.adjustRoll(seat, base, dice);
    if (p.dazed) {
      p.dazed = false;
      const halved = Math.max(1, Math.floor(total / 2));
      this.emit('status', `${this.pn(seat)} 受迷魂丹所困，步数 ${total} → ${halved}`, { player: seat, amount: halved });
      total = halved;
    }
    yield* this.walk(seat, total, t.reverse ? -1 : 1);
    t.swiftstep = false;
    t.reverse = false;
    yield* this.offerDuel(seat);
    yield* this.settle(seat, p.pos);
  }

  private *adjustRoll(seat: number, base: number, dice?: [number, number]): Flow<number> {
    if (!this.state.turn.swiftstep) return base;
    const list = Array.from({ length: this.cfg.rules.swiftstepMax + 1 }, (_, i) => base + i);
    const v = yield* this.ask({
      player: seat, kind: 'adjust', title: '调整点数', desc: `掷出 ${base}，选择最终移动步数`,
      options: list.map((n) => ({ id: `n${n}`, label: `${n} 步`, value: n, hint: n === base ? '原点数' : `+${n - base}` })),
      defaultId: `n${base}`, ctx: { base, dice },
    });
    if (v !== base) this.emit('info', `${this.pn(seat)} 调整点数 ${base} → ${v}`, { player: seat, amount: v });
    return v;
  }

  /** Step-by-step movement along the board graph: forks, altar stop/toll, start salary, passing effects. */
  *walk(seat: number, steps: number, dir: 1 | -1): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const b = this.board;
    let remaining = steps;
    let node = p.pos;
    let cameFrom = b.isTwoWay(node) ? p.cameFrom : null;
    const path: NodeId[] = [node];
    let forced: NodeId | null = null;

    if (node === ALTAR) {
      forced = yield* this.ask({
        player: seat, kind: 'exitRoad', title: '离开白泽灵台', desc: `选择一条神道向外走（${remaining} 步）`,
        options: b.node(ALTAR).next.map((x) => ({ id: x, label: this.exitLabel(x), value: x, node: x })),
        ctx: { remaining },
      });
    }

    while (remaining > 0) {
      let next = forced;
      forced = null;
      if (next === null) {
        const exits = b.exits(node, cameFrom, dir);
        next = exits.length > 1 ? yield* this.askFork(seat, node, exits, remaining) : exits[0];
      }
      remaining--;
      this.enterNode(seat, node, next, remaining);
      cameFrom = node;
      node = next;
      path.push(next);
      const nn = b.node(next);
      // 镇山: the mountain stops the next other player who enters its tile.
      const rb = this.state.roadblock;
      if (rb && rb.node === next && rb.seat !== seat) {
        this.state.roadblock = null;
        remaining = 0;
        this.emit('roadblockHit', `${this.pn(seat)} 被 ${this.pn(rb.seat)} 的山岳拦下，停在【${this.nodeName(next)}】`, { player: seat, node: next });
        break;
      }
      if (next === ALTAR) {
        if (remaining > 0 && p.pills >= this.cfg.altarToll) {
          const ch = yield* this.ask({
            player: seat, kind: 'altarPass', title: '白泽灵台', desc: `剩余 ${remaining} 步：停留结算，或付 ${this.cfg.altarToll} 灵丹借道离开？`,
            options: [
              { id: 'stop', label: '停留灵台', value: 'stop' as const },
              ...nn.next.map((x) => ({ id: x, label: `借道 · ${this.exitLabel(x)}`, value: x, node: x })),
            ],
            defaultId: 'stop', ctx: { remaining },
          });
          if (ch === 'stop') remaining = 0;
          else {
            p.pills -= this.cfg.altarToll;
            forced = ch;
            this.emit('toll', `${this.pn(seat)} 付 ${this.cfg.altarToll} 灵丹借道，经${b.roadName(b.node(ch).road!)}离开`, { player: seat, node: ALTAR });
          }
        } else {
          remaining = 0;
        }
      }
    }
    p.pos = node;
    p.cameFrom = cameFrom;
    t.lastPath = path;
    t.lastDir = dir;
  }

  private *askFork(seat: number, node: NodeId, exits: NodeId[], remaining: number): Flow<NodeId> {
    const b = this.board;
    const here = b.node(node);
    const label = (x: NodeId): string => {
      const n = b.node(x);
      if (n.road && n.road !== here.road) return `拐入${b.roadName(n.road)}`;
      return `前往【${n.name}】`;
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

  /** Entering a node during a walk: emits a step and applies passing effects. */
  private enterNode(seat: number, from: NodeId, to: NodeId, remaining: number): void {
    const p = this.state.players[seat];
    p.pos = to;
    const n = this.board.node(to);
    this.emit('step', '', { player: seat, node: to, from });
    if (n.type === 'start' && remaining > 0) this.gainStones(seat, this.cfg.salaryPass, '经过宗门山门');
    const t = this.state.turn;
    if (remaining > 0 && t.seat === seat) {
      for (const o of this.state.players) if (o.seat !== seat && o.pos === to && !t.passed.includes(o.seat)) t.passed.push(o.seat);
    }
    if (p.hero === 'magic' && n.type === 'spring') {
      p.pills += this.cfg.rules.magicPassivePills;
      this.emit('pills', `${this.pn(seat)} 灵息：经过${n.name} +${this.cfg.rules.magicPassivePills} 灵丹`, { player: seat, amount: this.cfg.rules.magicPassivePills });
    }
    if (p.hero === 'sword' && remaining > 0) {
      for (const o of this.state.players) {
        if (o.seat === seat || o.pos !== to || o.stones <= 0) continue;
        const amt = Math.min(this.cfg.rules.swordQiSteal, o.stones);
        o.stones -= amt;
        p.stones += amt;
        this.emit('stones', `${this.pn(seat)} 剑气掠过 ${this.pn(o.seat)}，夺取 ${amt} 灵石`, { player: seat, amount: amt });
      }
    }
  }

  /** An exit from the altar, named by its 神道 and the node where that road ends. */
  private exitLabel(exit: NodeId): string {
    const end = this.board.corridorEnd(ALTAR, exit);
    return `${this.board.roadName(this.board.node(exit).road!)} → ${end} ${this.nodeName(end)}`;
  }

  nodeLabel(id: NodeId): string {
    const n = this.board.node(id);
    if (n.type === 'land') {
      const t = this.state.tiles[id];
      const own = t.owner === null ? '无主' : `${this.pn(t.owner)} Lv${t.level}`;
      return `${n.name}（${own}）`;
    }
    return `${n.name}·${id}`;
  }

  private teleport(seat: number, node: NodeId, why: string): void {
    const p = this.state.players[seat];
    const from = p.pos;
    p.pos = node;
    p.cameFrom = null;
    this.emit('teleport', `${this.pn(seat)} ${why}，来到【${this.nodeName(node)}】`, { player: seat, node, from });
  }

  /** 误入幻阵: step back along the path just walked, then back along the main line (two-way nodes head outward). */
  private *moveBack(seat: number, steps: number, depth: number): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const b = this.board;
    const path = t.seat === seat && t.lastPath[t.lastPath.length - 1] === p.pos ? [...t.lastPath] : [p.pos];
    let i = path.length - 1;
    let node = p.pos;
    for (let k = 0; k < steps; k++) {
      const prev = i > 0 ? path[--i] : b.mainStep(node, (b.isTwoWay(node) || t.seat !== seat ? -1 : -t.lastDir) as 1 | -1);
      this.emit('step', '', { player: seat, node: prev, from: node });
      node = prev;
      p.pos = node;
    }
    p.cameFrom = null;
    t.lastPath = [];
    yield* this.settle(seat, node, { depth: depth + 1 });
  }

  // ------------------------------------------------------------- settling --

  private *settle(seat: number, node: NodeId, ctx: SettleCtx = {}): Flow {
    const depth = ctx.depth ?? 0;
    if (depth > 4) return;
    const n = this.board.node(node);
    switch (n.type) {
      case 'start': this.gainStones(seat, this.cfg.salaryLand, '停留宗门山门'); break;
      case 'land': yield* this.settleLand(seat, node); break;
      case 'trial':
        this.emit('info', `${this.pn(seat)} 参悟历练碑`, { player: seat, node });
        yield* this.drawFortune(seat, depth);
        break;
      case 'spring': this.gainPills(seat, this.cfg.rules.springPills, '灵泉'); break;
      case 'market': yield* this.market(seat); break;
      case 'furnace': this.gainPills(seat, this.cfg.rules.furnacePills, '丹炉'); break;
      case 'array': yield* this.arrayTeleport(seat, depth); break;
      case 'shrine': this.gainPills(seat, this.cfg.rules.shrinePills, '白泽祠'); break;
      case 'altar': yield* this.altar(seat, depth); break;
      case 'minigame': if (n.game !== 'dice') yield* this.alchemy(seat, node); break;
      default: break;
    }
  }

  private *alchemy(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const rewards = this.cfg.rules.miniGameRewards;
    p.stats.miniGames++;
    const tierLabel: Record<MiniGameTier, string> = { perfect: '极品丹成', ok: '丹成', fail: '炸炉' };
    const res = yield* this.ask({
      player: seat, kind: 'miniGame', title: '炼丹房', desc: '看准火候收火：完美、命中或失手',
      options: (['perfect', 'ok', 'fail'] as const).map((tier) => ({
        id: tier, label: `${tierLabel[tier]}（+${rewards[tier]} 灵丹）`, value: { game: 'alchemy' as const, tier },
      })),
      defaultId: 'ok', forceAsk: true, ctx: { game: 'alchemy' },
    });
    const pills = rewards[res.tier];
    p.pills += pills;
    this.emit('miniGame', `${this.pn(seat)} 在炼丹房${tierLabel[res.tier]}${pills ? `，+${pills} 灵丹` : '，一无所获'}`, {
      player: seat, node, amount: pills, miniGame: { game: 'alchemy', tier: res.tier, reward: { pills, stones: 0 } },
    });
  }

  private *settleLand(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const t = this.state.tiles[node];
    const n = this.board.node(node);
    if (t.owner === null) {
      const price = buyPrice(this.data, p, n.price!);
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
      t.owner = seat;
      this.emit('buy', `${this.pn(seat)} 以 ${price} 灵石购得【${n.name}】`, { player: seat, node, amount: price });
    } else if (t.owner !== seat) {
      yield* this.payRent(seat, node);
    }
  }

  private *payRent(seat: number, node: NodeId): Flow {
    const st = this.state;
    const p = st.players[seat];
    const ownerSeat = st.tiles[node].owner!;
    const rb = rentFor(st, this.board, this.data, node, seat);
    if (rb.amount <= 0) return;
    if (this.hasCard(p, 'evade')) {
      const use = yield* this.ask({
        player: seat, kind: 'rentReact', title: '是否反制？', desc: `需向 ${this.pn(ownerSeat)} 支付 ${rb.amount} 灵石租金`,
        options: [
          { id: 'evade', label: `避劫符（${this.spellById.get('evade')!.cost} 灵丹）免付`, value: true },
          { id: 'pay', label: '支付', value: false },
        ],
        defaultId: 'pay', cancelId: 'pay', ctx: { rent: rb.amount, node },
      });
      if (use) {
        this.payCard(seat, 'evade');
        this.emit('rentFree', `${this.pn(seat)} 避劫符免付 ${rb.amount} 灵石租金`, { player: seat, node });
        return;
      }
    }
    const paid = this.pay(seat, ownerSeat, rb.amount, `【${this.nodeName(node)}】租金`);
    st.players[ownerSeat].stats.rentCollected += paid;
    p.stats.rentPaid += paid;
    this.emit('rent', `${this.pn(seat)} 向 ${this.pn(ownerSeat)} 支付租金 ${paid}${rb.mults.length > 1 ? `（${rb.mults.slice(1).map((m) => m.label).join('、')}）` : ''}`, { player: seat, node, amount: paid });
  }

  /**
   * Mandatory payment between players (or to the bank if `to` is null).
   * Triggers 破产重整 when the payer cannot cover it. Returns the amount actually paid.
   */
  private pay(from: number, to: number | null, amount: number, why: string): number {
    const p = this.state.players[from];
    if (p.stones >= amount) {
      p.stones -= amount;
      if (to !== null) this.state.players[to].stones += amount;
      return amount;
    }
    const paid = p.stones;
    p.stones = 0;
    if (to !== null) this.state.players[to].stones += paid;
    this.emit('stones', `${this.pn(from)} 无力支付${why}（${amount}），倾尽 ${paid} 灵石`, { player: from, amount: paid });
    this.bankrupt(from);
    return paid;
  }

  /** 破产重整. */
  private bankrupt(seat: number): void {
    const p = this.state.players[seat];
    const cfg = this.cfg.bankrupt;
    for (const id of this.board.lands) {
      const t = this.state.tiles[id];
      if (t.owner === seat) { t.owner = null; t.level = 0; }
    }
    p.stones = cfg.resetStones;
    p.cultBase = Math.max(0, p.cultBase - cfg.cultivationLoss);
    p.stats.bankruptcies++;
    this.emit('bankrupt', `${this.pn(seat)} 破产重整：灵田尽数归还，领取 ${cfg.resetStones} 灵石，修为 −${cfg.cultivationLoss}`, { player: seat });
  }

  private gainStones(seat: number, n: number, why: string): void {
    this.state.players[seat].stones += n;
    this.emit('salary', `${this.pn(seat)} ${why} +${n} 灵石`, { player: seat, amount: n });
  }

  private gainPills(seat: number, n: number, why: string): void {
    this.state.players[seat].pills += n;
    this.emit('pills', `${this.pn(seat)} ${why} +${n} 灵丹`, { player: seat, amount: n });
  }

  private *market(seat: number): Flow {
    const p = this.state.players[seat];
    const price = this.cfg.marketCardPrice;
    const max = Math.min(this.cfg.marketMaxBuy, this.cfg.handLimit - p.hand.length, Math.floor(p.stones / price));
    if (max <= 0) {
      this.emit('info', `${this.pn(seat)} 逛了逛坊市`, { player: seat });
      return;
    }
    const opts: ChoiceOption<number>[] = [];
    for (let k = 1; k <= max; k++) opts.push({ id: `buy${k}`, label: `购买 ${k} 张（${k * price}）`, value: k });
    opts.push({ id: 'no', label: '不买', value: 0 });
    const k = yield* this.ask({
      player: seat, kind: 'market', title: '坊市', desc: `${price} 灵石 / 张，最多 ${this.cfg.marketMaxBuy} 张`,
      options: opts, cancelId: 'no', defaultId: 'no', forceAsk: true,
    });
    for (let i = 0; i < k; i++) {
      p.stones -= price;
      this.drawSpell(seat);
    }
  }

  private *arrayTeleport(seat: number, depth: number): Flow {
    const targets = this.board.lands.filter((id) => {
      const o = this.state.tiles[id].owner;
      return o === null || o === seat;
    });
    if (targets.length === 0) return;
    const node = yield* this.ask({
      player: seat, kind: 'node', title: '传送阵', desc: '传送到任意无主灵田或自己的洞府，并在那里结算',
      options: targets.map((id) => ({ id, label: this.nodeLabel(id), value: id, node: id })), ctx: { purpose: 'array' },
    });
    this.teleport(seat, node, '踏入传送阵');
    yield* this.settle(seat, node, { depth: depth + 1 });
  }

  // ---------------------------------------------------------------- altar --

  private *altar(seat: number, depth: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    p.stats.altarVisits++;
    const can = canBreakthrough(st, this.data, seat);
    const cost = breakthroughCost(st, this.data, seat);
    const opts: ChoiceOption<'break' | 'calm' | 'leave'>[] = [];
    if (can) opts.push({ id: 'break', label: `突破（${cost} 灵丹）`, value: 'break' });
    opts.push({ id: 'calm', label: '静心（+1 灵丹，抽机缘）', value: 'calm' });
    opts.push({ id: 'leave', label: '离开', value: 'leave' });
    const why = breakthroughsAvailable(p) <= 0 ? '暂无突破机会' : !can ? `灵丹不足（需 ${cost}）` : `突破机会 ${breakthroughsAvailable(p)} 次`;
    const ch = yield* this.ask({
      player: seat, kind: 'altar', title: '白泽灵台', desc: why, options: opts, defaultId: can ? 'break' : 'calm', ctx: { cost },
    });
    if (ch === 'leave') return;
    if (ch === 'calm') {
      this.gainPills(seat, 1, '静心');
      yield* this.drawFortune(seat, depth);
      return;
    }
    p.pills -= cost;
    p.btUsed++;
    p.stats.breakthroughs++;
    this.emit('breakthrough', `${this.pn(seat)} 于白泽灵台第 ${p.btUsed} 次突破（耗 ${cost} 灵丹）`, { player: seat, amount: cost });
  }

  // ---------------------------------------------------------- 机缘 cards --

  private drawEventCard(): string | null {
    const st = this.state;
    if (st.eventDeck.length === 0) {
      st.eventDeck = this.shuffle(st.eventDiscard);
      st.eventDiscard = [];
    }
    return st.eventDeck.shift() ?? null;
  }

  private *drawFortune(seat: number, depth: number): Flow {
    const id = this.drawEventCard();
    if (id) yield* this.resolveFortune(seat, id, depth);
  }

  private *resolveFortune(seat: number, id: string, depth: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    const ev = this.eventById.get(id)!;
    st.eventDiscard.push(id);
    p.badStreak = ev.good ? 0 : p.badStreak + 1;
    this.emit('event', `${this.pn(seat)} 机缘【${ev.name}】${ev.desc}`, { player: seat });
    const e = ev.effect;
    if (e.stones !== undefined) {
      if (e.stones >= 0) this.gainStones(seat, e.stones, ev.name);
      else {
        const loss = Math.min(p.stones, -e.stones);
        p.stones -= loss;
        this.emit('stones', `${this.pn(seat)} 失去 ${loss} 灵石`, { player: seat, amount: -loss });
      }
    }
    if (e.pills !== undefined) {
      if (e.pills >= 0) this.gainPills(seat, e.pills, ev.name);
      else {
        const loss = Math.min(p.pills, -e.pills);
        p.pills -= loss;
        this.emit('pills', `${this.pn(seat)} 失去 ${loss} 灵丹`, { player: seat, amount: -loss });
      }
    }
    if (e.chooseRoll) p.chooseRoll = true;
    if (e.draw) for (let k = 0; k < e.draw; k++) this.drawSpell(seat);
    if (e.allPills) for (const o of st.players) o.pills += e.allPills;
    if (e.buyCultivation !== undefined && p.stones >= e.buyCultivation) {
      const yes = yield* this.ask({
        player: seat, kind: 'auction', title: '坊市拍卖', desc: `花 ${e.buyCultivation} 灵石换 1 点修为？`,
        options: [
          { id: 'yes', label: `购买（${e.buyCultivation}）`, value: true },
          { id: 'no', label: '放弃', value: false },
        ],
        defaultId: 'yes', cancelId: 'no',
      });
      if (yes) {
        p.stones -= e.buyCultivation;
        this.addCult(seat, 1, '坊市拍卖');
      }
    }
    if (e.moveBack) yield* this.moveBack(seat, e.moveBack, depth);
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

  private *actionPhase(seat: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    for (;;) {
      if (st.over) return;
      const opts: ChoiceOption<ActionAct>[] = [];
      if (!st.turn.upgraded) {
        for (const id of this.board.lands) {
          const t = st.tiles[id];
          if (t.owner !== seat || t.level >= 4) continue;
          const c = upgradeCost(this.data, this.board.node(id).price!, t.level + 1);
          if (p.stones < c.stones || p.pills < c.pills) continue;
          opts.push({
            id: `upgrade:${id}`, label: `升级 ${this.nodeName(id)} → ${this.data.board.buildings[t.level + 1].name}（${c.stones}${c.pills ? ` + ${c.pills} 灵丹` : ''}）`,
            value: { t: 'upgrade', node: id }, node: id,
          });
        }
      }
      for (const card of new Set(p.hand)) {
        const s = this.spellById.get(card)!;
        if (s.timing !== 'action' || !this.hasCard(p, card)) continue;
        if (card === 'drain' && this.drainTargets(seat).length === 0) continue;
        if (card === 'bind' && this.bindTargets(seat).length === 0) continue;
        opts.push({ id: `cast:${card}`, label: `${s.name}（${s.cost} 灵丹）`, value: { t: 'cast', card }, hint: s.desc });
      }
      if (this.skillAvailable(seat, 'action')) opts.push(this.skillOption(seat));
      opts.push({ id: 'end', label: '结束回合', value: { t: 'end' } });
      const act = yield* this.ask({
        player: seat, kind: 'action', title: '行动阶段', desc: '升级 1 次、施放符箓、发动技能', options: opts, defaultId: 'end', forceAsk: true,
      });
      switch (act.t) {
        case 'end': return;
        case 'upgrade':
          this.upgrade(seat, act.node);
          st.turn.upgraded = true;
          break;
        case 'cast': yield* this.castAction(seat, act.card); break;
        case 'skill': yield* this.useSkill(seat); break;
      }
    }
  }

  /** Performs one level of upgrade. Grants the first-time building 修为. */
  upgrade(seat: number, node: NodeId): void {
    const p = this.state.players[seat];
    const t = this.state.tiles[node];
    const lv = t.level + 1;
    const c = upgradeCost(this.data, this.board.node(node).price!, lv);
    p.stones -= c.stones;
    p.pills -= c.pills;
    t.level = lv;
    this.emit('upgrade', `${this.pn(seat)} 将【${this.nodeName(node)}】升为${this.data.board.buildings[lv].name}（${c.stones} 灵石）`, { player: seat, node, amount: c.stones });
    const gain = this.cfg.cultivationOnBuild[String(lv)];
    const key = `${node}:${lv}`;
    if (gain && !p.milestones.includes(key)) {
      p.milestones.push(key);
      this.addCult(seat, gain, `筑府·${this.data.board.buildings[lv].name}`);
    }
  }

  drainTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && o.pills > 0).map((o) => o.seat);
  }

  bindTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && !o.bound).map((o) => o.seat);
  }

  private targetOption(tg: Target): ChoiceOption<Target> {
    if (tg.t === 'player') return { id: `p${tg.seat}`, label: `${this.pn(tg.seat)}（灵丹 ${this.state.players[tg.seat].pills}）`, value: tg };
    if (tg.t === 'node') return { id: `node:${tg.node}`, label: this.nodeLabel(tg.node), value: tg, node: tg.node };
    return { id: 'cancel', label: '取消', value: tg };
  }

  private *askTarget(seat: number, title: string, desc: string, targets: Target[], purpose: NonNullable<PendingChoice['ctx']['purpose']>): Flow<Target> {
    const opts = targets.map((t) => this.targetOption(t));
    opts.push(this.targetOption({ t: 'cancel' }));
    return yield* this.ask({ player: seat, kind: 'target', title, desc, options: opts, cancelId: 'cancel', ctx: { purpose } });
  }

  private *castAction(seat: number, card: string): Flow {
    const p = this.state.players[seat];
    const s = this.spellById.get(card)!;
    switch (card) {
      case 'drain': {
        const tg = yield* this.askTarget(seat, s.name, s.desc, this.drainTargets(seat).map((x) => ({ t: 'player' as const, seat: x })), 'drain');
        if (tg.t !== 'player') return;
        this.payCard(seat, card);
        if (yield* this.guard(tg.seat, 'drain', seat)) return;
        const o = this.state.players[tg.seat];
        const n = Math.min(1, o.pills);
        o.pills -= n;
        p.pills += n;
        this.emit('pills', `${this.pn(seat)} 从 ${this.pn(tg.seat)} 处夺取 ${n} 灵丹`, { player: seat, amount: n });
        return;
      }
      case 'bind': {
        const tg = yield* this.askTarget(seat, s.name, s.desc, this.bindTargets(seat).map((x) => ({ t: 'player' as const, seat: x })), 'bind');
        if (tg.t !== 'player') return;
        this.payCard(seat, card);
        if (yield* this.guard(tg.seat, 'bind', seat)) return;
        this.state.players[tg.seat].bound = true;
        this.emit('bind', `${this.pn(tg.seat)} 被定身，下回合无法移动`, { player: tg.seat });
        return;
      }
      default:
        throw new Error(`not an action card: ${card}`);
    }
  }

  /** Defender may answer with 金光符. Returns true if the threat is blocked. */
  private *guard(defender: number, threat: ThreatKind, attacker: number): Flow<boolean> {
    const d = this.state.players[defender];
    if (!this.hasCard(d, 'goldlight')) return false;
    const labels: Record<ThreatKind, string> = { drain: '夺灵符', bind: '定身符' };
    const use = yield* this.ask({
      player: defender, kind: 'guardReact', title: '是否反制？',
      desc: `${this.pn(attacker)} 对你施放【${labels[threat]}】`,
      options: [
        { id: 'goldlight', label: `金光符（${this.spellById.get('goldlight')!.cost} 灵丹）抵挡`, value: true },
        { id: 'no', label: '不反制', value: false },
      ],
      defaultId: 'no', cancelId: 'no', ctx: { threat, attacker },
    });
    if (!use) return false;
    this.payCard(defender, 'goldlight');
    this.emit('block', `${this.pn(defender)} 金光符护体，抵挡了${labels[threat]}`, { player: defender });
    return true;
  }

  // ------------------------------------------------------- 斗法 / 技能 ----

  heroOf(seat: number): HeroData {
    return this.data.heroes.find((h) => h.id === this.state.players[seat].hero)!;
  }

  /** May `seat` be challenged right now (not already challenged this round)? */
  duelEligible(seat: number): boolean {
    return this.state.players[seat].duelShieldRound !== this.state.round;
  }

  /** Stones the loser of a duel hands over. */
  duelStake(loser: number): number {
    const r = this.cfg.rules;
    return Math.min(r.duelStealMax, Math.floor(this.state.players[loser].stones * r.duelStealPct));
  }

  /** After a walk: challenge someone on the landing tile or passed on the way (once per turn). */
  private *offerDuel(seat: number): Flow {
    const st = this.state;
    const t = st.turn;
    const p = st.players[seat];
    const met = [...st.players.filter((o) => o.seat !== seat && o.pos === p.pos).map((o) => o.seat), ...t.passed];
    t.passed = [];
    if (t.duelDone || t.seat !== seat) return;
    const cands = [...new Set(met)].filter((s) => this.duelEligible(s)).sort((a, b) => a - b);
    if (cands.length === 0) return;
    const opts: ChoiceOption<number | null>[] = cands.map((s) => ({
      id: `p${s}`, label: `挑战 ${this.pn(s)}`, value: s, node: st.players[s].pos,
      hint: `胜：夺 ${this.duelStake(s)} 灵石；败：失 ${this.duelStake(seat)} 灵石`,
    }));
    opts.push({ id: 'none', label: '不斗法', value: null });
    const target = yield* this.ask({
      player: seat, kind: 'duel', title: '斗法',
      desc: `可向途中相遇的一名修士发起斗法：双方各掷 1 颗骰，可押灵丹加点，点高者胜（平局守方胜），败者交出 ${Math.round(this.cfg.rules.duelStealPct * 100)}% 灵石（至多 ${this.cfg.rules.duelStealMax}）。`,
      options: opts, defaultId: 'none', cancelId: 'none', ctx: {},
    });
    if (target === null) return;
    yield* this.duel(seat, target);
  }

  private *askBet(seat: number, attacker: number, defender: number, oppBet: number | undefined): Flow<number> {
    const p = this.state.players[seat];
    const max = Math.min(this.cfg.rules.duelMaxPills, p.pills);
    const opts: ChoiceOption<number>[] = [];
    for (let k = 0; k <= max; k++) opts.push({ id: `b${k}`, label: k === 0 ? '不押灵丹' : `押 ${k} 灵丹（+${k} 点）`, value: k });
    const other = seat === attacker ? defender : attacker;
    return yield* this.ask({
      player: seat, kind: 'duelBet', title: seat === attacker ? `斗法 · 向 ${this.pn(defender)} 出手` : `斗法 · ${this.pn(attacker)} 向你出手`,
      desc: `每颗灵丹 +1 点，胜负都会消耗。胜得 ${this.duelStake(other)} 灵石，败失 ${this.duelStake(seat)} 灵石。${oppBet !== undefined ? `对方押了 ${oppBet} 颗。` : ''}`,
      options: opts, defaultId: 'b0', cancelId: 'b0',
      ctx: { attacker, defender, stake: this.duelStake(other), bet: oppBet },
    });
  }

  private *duel(attacker: number, defender: number): Flow {
    const st = this.state;
    const r = this.cfg.rules;
    const pa = st.players[attacker];
    const pd = st.players[defender];
    st.turn.duelDone = true;
    pd.duelShieldRound = st.round;
    pa.stats.duels++;
    this.emit('info', `${this.pn(attacker)} 向 ${this.pn(defender)} 发起斗法！`, { player: attacker, node: pd.pos });
    const betA = yield* this.askBet(attacker, attacker, defender, undefined);
    const betD = yield* this.askBet(defender, attacker, defender, betA);
    pa.pills -= betA;
    pd.pills -= betD;
    const rolls: [number, number] = [this.d6(), this.d6()];
    const bonus: [number, number] = [pa.hero === 'sword' ? r.swordDuelAttack : 0, pd.hero === 'body' ? r.bodyDuelDefense : 0];
    const totals: [number, number] = [rolls[0] + betA + bonus[0], rolls[1] + betD + bonus[1]];
    const winner = totals[0] > totals[1] ? attacker : defender;
    const loser = winner === attacker ? defender : attacker;
    const amount = this.duelStake(loser);
    st.players[loser].stones -= amount;
    st.players[winner].stones += amount;
    st.players[winner].stats.duelWins++;
    const duel: DuelResult = { attacker, defender, bets: [betA, betD], rolls, bonus, totals, winner, loser, amount };
    const part = (i: 0 | 1) => `${rolls[i]}${[betA, betD][i] ? ` + 丹 ${[betA, betD][i]}` : ''}${bonus[i] ? ` + ${bonus[i]}` : ''} = ${totals[i]}`;
    this.emit('duel', `斗法：${this.pn(attacker)} ${part(0)} 对 ${this.pn(defender)} ${part(1)}，${this.pn(winner)} 胜${totals[0] === totals[1] ? '（平局守方胜）' : ''}，夺得 ${amount} 灵石`, {
      player: winner, node: pd.pos, amount, duel,
    });
  }

  skillReady(seat: number): boolean {
    const p = this.state.players[seat];
    return p.turnsTaken >= p.skillReadyTurn;
  }

  /** Targets of the hero's active skill (players for 剑遁 / 乾坤挪移 / 迷魂丹, ring nodes for 镇山). */
  skillTargets(seat: number): number[] | NodeId[] {
    const st = this.state;
    const p = st.players[seat];
    const others = st.players.filter((o) => o.seat !== seat);
    switch (this.heroOf(seat).skill.id) {
      case 'sworddash':
        if (st.turn.duelDone) return [];
        return others
          .filter((o) => this.duelEligible(o.seat) && o.pos !== p.pos && this.board.distance(p.pos, o.pos) <= this.cfg.rules.swordDashRange)
          .map((o) => o.seat);
      case 'swap':
        if (!this.board.node(p.pos).outer) return [];
        return others
          .filter((o) => {
            const d = this.board.outerDistance(p.pos, o.pos);
            return o.pos !== p.pos && d >= 0 && d <= this.cfg.rules.swapRange;
          })
          .map((o) => o.seat);
      case 'daze':
        return others.filter((o) => !o.dazed).map((o) => o.seat);
      case 'roadblock': {
        if (!this.board.node(p.pos).outer || st.roadblock) return [];
        const out: NodeId[] = [];
        let n = p.pos;
        for (let k = 0; k < this.cfg.rules.roadblockRange; k++) {
          n = this.board.mainStep(n, 1);
          if (!st.players.some((o) => o.pos === n)) out.push(n);
        }
        return out;
      }
    }
  }

  private skillAvailable(seat: number, phase: 'preroll' | 'action'): boolean {
    return this.heroOf(seat).skill.timing === phase && this.skillReady(seat) && this.skillTargets(seat).length > 0;
  }

  private skillOption(seat: number): ChoiceOption<{ t: 'skill' }> {
    const sk = this.heroOf(seat).skill;
    return { id: 'skill', label: `技能【${sk.name}】（冷却 ${this.cfg.rules.skillCooldownTurns} 回合）`, value: { t: 'skill' }, hint: sk.desc };
  }

  private spendSkill(seat: number): void {
    const p = this.state.players[seat];
    p.skillReadyTurn = p.turnsTaken + this.cfg.rules.skillCooldownTurns;
    p.stats.skillUses++;
    this.emit('skill', `${this.pn(seat)} 施展技能【${this.heroOf(seat).skill.name}】`, { player: seat });
  }

  /** Returns 'moved' when the skill replaced this turn's roll (剑遁), 'cancel' when backed out. */
  private *useSkill(seat: number): Flow<'moved' | 'ok' | 'cancel'> {
    const st = this.state;
    const p = st.players[seat];
    const sk = this.heroOf(seat).skill;
    if (sk.id === 'roadblock') {
      const nodes = this.skillTargets(seat) as NodeId[];
      const tg = yield* this.askTarget(seat, sk.name, sk.desc, nodes.map((node) => ({ t: 'node' as const, node })), 'roadblock');
      if (tg.t !== 'node') return 'cancel';
      this.spendSkill(seat);
      st.roadblock = { node: tg.node, seat };
      this.emit('roadblock', `${this.pn(seat)} 在【${this.nodeName(tg.node)}】落下山岳`, { player: seat, node: tg.node });
      return 'ok';
    }
    const seats = this.skillTargets(seat) as number[];
    const tg = yield* this.askTarget(seat, sk.name, sk.desc, seats.map((x) => ({ t: 'player' as const, seat: x })), sk.id);
    if (tg.t !== 'player') return 'cancel';
    const o = st.players[tg.seat];
    this.spendSkill(seat);
    switch (sk.id) {
      case 'sworddash': {
        this.teleport(seat, o.pos, `剑遁追至 ${this.pn(tg.seat)} 身前`);
        p.cameFrom = o.cameFrom;
        st.turn.lastPath = [];
        yield* this.duel(seat, tg.seat);
        yield* this.settle(seat, p.pos);
        return 'moved';
      }
      case 'swap': {
        const mine = p.pos;
        const theirs = o.pos;
        p.pos = theirs;
        o.pos = mine;
        [p.cameFrom, o.cameFrom] = [o.cameFrom, p.cameFrom];
        this.emit('teleport', `${this.pn(seat)} 乾坤挪移，与 ${this.pn(tg.seat)} 互换位置`, { player: seat, node: theirs, from: mine });
        this.emit('teleport', '', { player: tg.seat, node: mine, from: theirs });
        return 'ok';
      }
      case 'daze':
        o.dazed = true;
        this.emit('status', `${this.pn(tg.seat)} 中了迷魂丹，下次移动步数减半`, { player: tg.seat });
        return 'ok';
    }
    return 'ok';
  }

  // ---------------------------------------------------- cultivation / end --

  addCult(seat: number, n: number, why: string): void {
    const p = this.state.players[seat];
    p.cultBase = Math.max(0, p.cultBase + n);
    this.emit('cult', `${this.pn(seat)} ${why}，修为 ${n >= 0 ? '+' : ''}${n}（现 ${this.cult(seat)}）`, { player: seat, amount: n });
    this.afterCultChange();
  }

  /** Grants breakthrough opportunities for newly crossed thresholds and checks for a winner. */
  private afterCultChange(): void {
    const st = this.state;
    for (const p of st.players) {
      const c = this.cult(p.seat);
      if (c > p.peakCult) {
        for (const th of this.cfg.breakthroughThresholds) {
          if (p.peakCult < th && c >= th) {
            p.btEarned++;
            this.emit('info', `${this.pn(p.seat)} 修为达 ${th}，晋入${realmName(this.data, th)}，获得 1 次突破机会`, { player: p.seat });
          }
        }
        p.peakCult = c;
      }
    }
    const winners = st.players.filter((p) => this.cult(p.seat) >= this.cfg.winCultivation);
    if (winners.length > 0) {
      winners.sort((a, b) => this.cult(b.seat) - this.cult(a.seat) || (a.seat === st.current ? -1 : b.seat === st.current ? 1 : a.seat - b.seat));
      this.endGame(winners[0].seat, 'cultivation');
    }
  }

  private endGame(seat: number, reason: 'cultivation' | 'roundCap'): never {
    const st = this.state;
    st.over = true;
    st.winner = seat;
    st.endReason = reason;
    this.pending = null;
    this.emit('win', reason === 'cultivation'
      ? `${this.pn(seat)} 修为圆满，渡劫飞升！`
      : `第 ${this.cfg.rounds} 轮结束，${this.pn(seat)} 修为最高，夺得魁首！`, { player: seat });
    this.emit('gameEnd', '本局结束', { player: seat });
    throw new GameOverSignal(seat);
  }

  /** Players ordered by final standing: 修为 desc, then total assets desc. */
  ranking(): number[] {
    return this.state.players.map((p) => p.seat).sort((a, b) =>
      this.cult(b) - this.cult(a) ||
      totalAssets(this.state, this.board, this.data, b) - totalAssets(this.state, this.board, this.data, a) || a - b);
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

  /** Drive an arbitrary engine sub-flow with scripted answers (tests). */
  runFlow(flow: Flow<unknown>, answer: (c: PendingChoice) => string): void {
    let r = flow.next(undefined as unknown as string);
    while (!r.done) r = flow.next(answer(r.value));
  }

  testPayRent(seat: number, node: NodeId): Flow { return this.payRent(seat, node); }
  testAltar(seat: number): Flow { return this.altar(seat, 0); }
  testDuel(attacker: number, defender: number): Flow { return this.duel(attacker, defender); }
  testUseSkill(seat: number): Flow<'moved' | 'ok' | 'cancel'> { return this.useSkill(seat); }
  testSettle(seat: number, node: NodeId): Flow { this.state.current = seat; return this.settle(seat, node); }
  testActionPhase(seat: number): Flow { this.state.current = seat; return this.actionPhase(seat); }
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
