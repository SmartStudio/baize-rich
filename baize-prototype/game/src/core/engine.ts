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
import { ALTAR, Board, REGION_IDS } from './board';
import type {
  ActionAct, ChoiceKind, ChoiceOption, ChoiceSpec, ChoiceValueMap, PendingChoice, PendingChoiceOf,
  PreRollAct, Target, ThreatKind, DiceBet,
} from './choices';
import { defaultData } from './data';
import type { DuelResult, GameEvent, GameEventType } from './events';
import { hashSeed, nextFloat } from './rng';
import {
  breakthroughCost, breakthroughsAvailable, buyoutPrice, buyPrice, canBreakthrough, computeVeinLords,
  countOwned, cultivation, goldbodyReady, isWardActive, ownsStreet, realmName, rentFor, totalAssets, uniqueLeader,
  upgradeCost,
} from './rules';
import type {
  ActiveTask, EventCardData, GameData, GameSetup, GameState, HeroData, MiniGameTier, NodeId, PlayerState, RegionId,
  SpecialKind, SpellData, SpiritState, TaskData, TurnState,
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
  /** Settling the tile one is standing on without moving (定身符). */
  stay?: boolean;
  depth?: number;
}

const NEGATIVE_STATUS_LABEL = { bound: '定身', tremor: '地脉异动' } as const;

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
  readonly taskById = new Map<string, TaskData>();

  constructor(readonly setup: GameSetup, readonly data: GameData = defaultData, readonly opts: GameOptions = {}) {
    this.board = new Board(data.board);
    for (const s of data.spells.cards) this.spellById.set(s.id, s);
    for (const e of data.events.events) this.eventById.set(e.id, e);
    for (const t of data.events.tasks) this.taskById.set(t.id, t);
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
    for (const c of this.data.spells.cards) {
      if (c.shopOnly) continue; // §18.3 道具只在百宝阁出售
      for (let k = 0; k < this.data.spells.copiesEach; k++) spellDeck.push(c.id);
    }
    const eventDeck = [...this.data.events.tasks.map((t) => t.id), ...this.data.events.events.map((e) => e.id)];
    const tiles: GameState['tiles'] = {};
    for (const id of this.board.lands) tiles[id] = { owner: null, level: 0, trap: false };
    const n = this.setup.players.length;
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
        hand: [], divines: [], tasks: [], seal: false, jailed: false, jailTurns: 0, bound: false,
        wardUntilRound: 0, tremorRound: 0, treasure: [], rentImmuneUntilTurn: -1, turnsTaken: 0, ultUses: 0,
        goldbodyReadyRound: 0, shrinkReadyRound: 0, gatherRound: 0, mazeAvailable: false, chooseRoll: false,
        badStreak: 0, milestones: [], skillReadyTurn: 0, duelShieldRound: 0, dazed: false, hospitalTurns: 0,
        stats: {
          rentCollected: 0, rentPaid: 0, breakthroughs: 0, demonDamage: 0, twoGateMoves: 0, roadEntries: 0,
          altarVisits: 0, bankruptcies: 0, tasksDone: 0, duels: 0, duelWins: 0, bountyClaims: 0, trapTriggers: 0, skillUses: 0,
          possessions: 0, heartPasses: 0, shopBuys: 0, specialsBuilt: 0, miniGames: 0, streets: 0,
        },
      })),
      tiles,
      spellDeck,
      spellDiscard: [],
      eventDeck,
      eventDiscard: [],
      heavenDeck: this.data.blessings.heaven.map((h) => h.id),
      demon: null,
      manifested: false,
      veinLords: { wood: null, fire: null, water: null, earth: null },
      regionReach: {
        wood: new Array(n).fill(0), fire: new Array(n).fill(0), water: new Array(n).fill(0), earth: new Array(n).fill(0),
      },
      seq: 0,
      bountySeat: null,
      roadblock: null,
      spirits: [],
      barriers: [],
      blasts: [],
      turn: this.freshTurn(0),
    };
    this.state = st;
    this.shuffle(st.spellDeck);
    this.shuffle(st.eventDeck);
    this.shuffle(st.heavenDeck);
    // §18.2 two spirits on distinct spawn cells (none on a board without spawns).
    const spawns = this.shuffle([...(this.data.board.spiritSpawns ?? [])]);
    if (spawns.length >= 2) {
      st.spirits = (['fox', 'heart'] as const).map((kind, i) => ({ kind, node: spawns[i], holder: null, turnsLeft: 0 }));
    }
    return st;
  }

  private freshTurn(seat: number): TurnState {
    return {
      seat, doubles: 0, mireUsed: false, upgraded: false, discount: false,
      swiftstep: false, reverse: false, swordUlt: false, lastPath: [], lastDir: 1, duelDone: false, passed: [],
      diceCard: false,
    };
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
        yield* this.roundStart();
        for (let s = 0; s < this.state.players.length; s++) {
          this.state.current = s;
          yield* this.playTurn(s);
        }
        yield* this.roundEnd();
      }
      this.finishByRoundCap();
    } catch (e) {
      if (!(e instanceof GameOverSignal)) throw e;
    }
  }

  private *roundStart(): Flow {
    const st = this.state;
    const r = st.round;
    this.emit('roundStart', `—— 第 ${r} / ${this.cfg.rounds} 轮 ——`);
    const manifestNow = r === this.cfg.baizeManifestRound && !st.manifested;
    // 1) demon leaves / moves
    if (st.demon) {
      if (r >= st.demon.leaveRound) {
        this.emit('demonGone', '天魔停留期满，遁出秘境。', { node: st.demon.node });
        st.demon = null;
      } else if (!manifestNow) {
        yield* this.demonMove();
      }
    }
    // 2) demon spawns
    if (this.cfg.demon.spawnRounds.includes(r) && !st.demon) {
      const node = this.board.lands[this.randInt(this.board.lands.length)];
      st.demon = { node, hp: this.cfg.demon.hp, maxHp: this.cfg.demon.hp, spawnRound: r, leaveRound: r + this.cfg.demon.stayRounds };
      this.emit('demonSpawn', `域外天魔降临于【${this.nodeName(node)}】！突破费用 +${this.cfg.demonCostPenalty}。`, { node });
    }
    // 3) Baize manifests
    if (manifestNow) yield* this.manifest();
    // 4) §17 悬赏令
    this.updateBounty();
    // 5) §18.4 药园
    for (const id of this.board.lands) {
      const t = st.tiles[id];
      if (t.special === 'garden' && t.owner !== null) this.gainPills(t.owner, this.cfg.rules.gardenPills, `药园【${this.nodeName(id)}】`);
    }
  }

  /** §17 悬赏令：修为唯一最高且不低于 bountyMinCult 者持令。 */
  private updateBounty(): void {
    const st = this.state;
    const leader = uniqueLeader(st, this.data);
    const next = leader !== null && this.cult(leader) >= this.cfg.rules.bountyMinCult ? leader : null;
    if (next === st.bountySeat) return;
    const before = st.bountySeat;
    st.bountySeat = next;
    if (next !== null) {
      this.emit('bounty', `悬赏令高悬：${this.pn(next)} 修为独占鳌头（${this.cult(next)}），斗法击败其者修为 +${this.cfg.rules.bountyDuelCultivation}`, { player: next });
    } else if (before !== null) {
      this.emit('bounty', `${this.pn(before)} 不再独占鳌头，悬赏令撤下`, { player: before });
    }
  }

  private *roundEnd(): Flow {
    if (this.cfg.eruptionRounds.includes(this.state.round)) yield* this.eruption();
    this.spiritsWander();
    this.emit('roundEnd', `第 ${this.state.round} 轮结束`);
  }

  // -------------------------------------------------------- §18.2 灵体 ----

  spiritName(kind: SpiritState['kind']): string {
    return kind === 'fox' ? '福缘灵狐' : '心魔';
  }

  /** The spirit possessing `seat`, if any. */
  heldSpirit(seat: number): SpiritState | undefined {
    return this.state.spirits.find((s) => s.holder === seat);
  }

  /** Each wandering spirit takes 1..spiritMoveMax steps along `next`, picking forks by rng. Moving onto a player does not possess. */
  private spiritsWander(): void {
    for (const sp of this.state.spirits) {
      if (sp.node === null) continue;
      const from = sp.node;
      let node = from;
      const steps = 1 + this.randInt(this.cfg.rules.spiritMoveMax);
      for (let k = 0; k < steps; k++) {
        const next = this.board.node(node).next;
        node = next.length > 1 ? next[this.randInt(next.length)] : next[0];
      }
      sp.node = node;
      this.emit('spirit', `${this.spiritName(sp.kind)}游荡至【${this.nodeName(node)}】`, {
        node, from, spirit: { kind: sp.kind, action: 'move', from, to: node },
      });
    }
  }

  /** `seat` steps onto `node` (passing or stopping): a wandering spirit there possesses them. */
  private meetSpirits(seat: number, node: NodeId): void {
    for (const sp of this.state.spirits) if (sp.node === node) this.possess(seat, sp, null);
  }

  /** `sp` possesses `seat`, displacing any other spirit they hold. `giver` is set when 心魔 is passed on. */
  private possess(seat: number, sp: SpiritState, giver: number | null): void {
    const p = this.state.players[seat];
    const old = this.heldSpirit(seat);
    if (old && old !== sp) this.expireSpirit(old, `被${this.spiritName(sp.kind)}顶替`);
    const from = sp.node ?? undefined;
    sp.node = null;
    sp.holder = seat;
    sp.turnsLeft = giver === null ? this.cfg.rules.spiritTurns : Math.max(1, sp.turnsLeft);
    p.stats.possessions++;
    const effect = sp.kind === 'fox'
      ? `收租 ×${this.cfg.rules.foxRentMult}、购地 ${Math.round(this.cfg.rules.foxLandDiscount * 10)} 折`
      : `付租 ×${this.cfg.rules.heartRentMult}、每回合 −${this.cfg.rules.heartPills} 灵丹`;
    if (giver === null) {
      this.emit('spirit', `${this.spiritName(sp.kind)}附身 ${this.pn(seat)}（${sp.turnsLeft} 回合：${effect}）`, {
        player: seat, node: p.pos, spirit: { kind: sp.kind, action: 'possess', seat, from },
      });
    } else {
      this.state.players[giver].stats.heartPasses++;
      this.emit('spirit', `${this.pn(giver)} 擦身而过，心魔转附 ${this.pn(seat)}（剩 ${sp.turnsLeft} 回合）`, {
        player: seat, node: p.pos, spirit: { kind: sp.kind, action: 'transfer', seat, giver },
      });
    }
  }

  /** The spirit leaves its holder and reappears on a free spawn cell chosen by rng. */
  private expireSpirit(sp: SpiritState, why: string): void {
    const st = this.state;
    const seat = sp.holder;
    const spawns = this.data.board.spiritSpawns ?? [];
    const free = spawns.filter((n) => !st.players.some((o) => o.pos === n) && !st.spirits.some((s) => s.node === n));
    const pool = free.length ? free : spawns;
    const to = pool[this.randInt(pool.length)];
    sp.holder = null;
    sp.turnsLeft = 0;
    sp.node = to;
    this.emit('spirit', `${this.spiritName(sp.kind)}${why}，离开 ${seat !== null ? this.pn(seat) : ''}，重现于【${this.nodeName(to)}】`, {
      player: seat ?? undefined, node: to, spirit: { kind: sp.kind, action: 'expire', seat: seat ?? undefined, to },
    });
  }

  // ------------------------------------------------------ §18.3 医馆 ------

  /** 爆炎阵: off to the 医馆 (or bound in place on a board without one). False if 白泽护道 prevented it. */
  private sendToHospital(seat: number): boolean {
    const p = this.state.players[seat];
    if (isWardActive(this.state, seat)) {
      this.emit('block', `${this.pn(seat)} 受白泽护道庇佑，毫发无伤`, { player: seat });
      return false;
    }
    const h = this.board.hospitalId;
    if (h === null) {
      p.bound = true;
      this.emit('bind', `${this.pn(seat)} 被炸伤，下回合无法移动`, { player: seat });
      return true;
    }
    const from = p.pos;
    p.pos = h;
    p.cameFrom = null;
    p.hospitalTurns = this.cfg.rules.hospitalTurns;
    this.emit('teleport', `${this.pn(seat)} 被抬往医馆`, { player: seat, node: h, from });
    this.emit('hospital', `${this.pn(seat)} 在医馆休养 ${p.hospitalTurns} 回合`, { player: seat, node: h, amount: p.hospitalTurns });
    return true;
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

    // §18.2 a possession counts the holder's own turns; 心魔 bites every turn.
    const sp = this.heldSpirit(seat);
    if (sp) {
      sp.turnsLeft--;
      if (sp.kind === 'heart' && p.pills > 0) {
        const n = Math.min(p.pills, this.cfg.rules.heartPills);
        p.pills -= n;
        this.emit('pills', `${this.pn(seat)} 心魔噬心，失去 ${n} 灵丹`, { player: seat, amount: -n });
      }
    }

    // §18.3 医馆: a hospital turn is skipped whole.
    if (p.hospitalTurns > 0) {
      p.hospitalTurns--;
      this.emit('hospital', `${this.pn(seat)} 在医馆休养，本回合无法行动${p.hospitalTurns === 0 ? '（下回合出院）' : ''}`, { player: seat, node: p.pos, amount: p.hospitalTurns });
      this.endTurn(seat);
      return;
    }

    if (p.divines.includes('pillheart') && p.pills < this.cfg.rules.pillheartBelow) {
      p.pills += 1;
      this.emit('pills', `${this.pn(seat)} 丹心生效，+1 灵丹`, { player: seat, amount: 1 });
    }

    let forcedDice: [number, number] | null = null;
    if (p.jailed) {
      const res = yield* this.jailPhase(seat);
      if (res.kind === 'stay') {
        yield* this.actionPhase(seat);
        this.endTurn(seat);
        return;
      }
      if (res.kind === 'rolled') forcedDice = res.dice;
    }

    if (p.bound) {
      p.bound = false;
      this.emit('bind', `${this.pn(seat)} 被定身，本回合无法移动，直接结算所在地块。`, { player: seat });
      yield* this.settle(seat, p.pos, { stay: true });
      yield* this.actionPhase(seat);
      this.checkTasks();
      this.endTurn(seat);
      return;
    }

    for (;;) {
      let rolledDoubles = false;
      if (forcedDice) {
        const d = forcedDice;
        forcedDice = null;
        yield* this.doMove(seat, d[0] + d[1]);
      } else {
        const pre = yield* this.preRollPhase(seat);
        if (pre === 'roll') {
          if (st.turn.diceCard) {
            // §18.3 御骰符: the player names the total; no doubles.
            st.turn.diceCard = false;
            const opts: ChoiceOption<number>[] = [];
            for (let v = this.cfg.rules.diceCardMin; v <= this.cfg.rules.diceCardMax; v++) opts.push({ id: `v${v}`, label: `${v} 点`, value: v });
            const v = yield* this.ask({ player: seat, kind: 'rollValue', title: '御骰符', desc: '选择本次移动点数', options: opts, forceAsk: true });
            this.emit('roll', `${this.pn(seat)} 御骰定数，选择 ${v} 点`, { player: seat, amount: v });
            yield* this.doMove(seat, v);
          } else if (p.chooseRoll) {
            p.chooseRoll = false;
            const opts: ChoiceOption<number>[] = [];
            for (let v = this.cfg.rules.beastRollMin; v <= this.cfg.rules.beastRollMax; v++) opts.push({ id: `v${v}`, label: `${v} 点`, value: v });
            const v = yield* this.ask({ player: seat, kind: 'rollValue', title: '灵兽引路', desc: '选择本次移动点数', options: opts, forceAsk: true });
            this.emit('roll', `${this.pn(seat)} 灵兽引路，选择 ${v} 点`, { player: seat, amount: v });
            yield* this.doMove(seat, v);
          } else {
            const dice: [number, number] = [this.d6(), this.d6()];
            const dbl = dice[0] === dice[1];
            this.emit('roll', `${this.pn(seat)} 掷出 ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}${dbl ? '（双数）' : ''}`, { player: seat, dice, amount: dice[0] + dice[1] });
            if (dbl) {
              st.turn.doubles++;
              rolledDoubles = true;
              if (st.turn.doubles > this.cfg.maxDoubles) {
                this.emit('doubles', `${this.pn(seat)} 连续第 ${st.turn.doubles} 次双数，心魔暗生，被送往思过崖！`, { player: seat });
                this.sendToCliff(seat);
                break;
              }
            }
            yield* this.doMove(seat, dice[0] + dice[1], dice);
          }
        }
      }
      yield* this.actionPhase(seat);
      this.checkTasks();
      if (rolledDoubles && !p.jailed) {
        this.emit('doubles', `${this.pn(seat)} 掷出双数，再掷一次！`, { player: seat });
        continue;
      }
      break;
    }
    this.checkTasks();
    this.endTurn(seat);
  }

  private endTurn(seat: number): void {
    const p = this.state.players[seat];
    const n = this.board.node(p.pos);
    p.mazeAvailable = n.type === 'land' && n.region === 'wood';
    const sp = this.heldSpirit(seat);
    if (sp && sp.turnsLeft <= 0) this.expireSpirit(sp, '附身期满');
    this.emit('turnEnd', `${this.pn(seat)} 结束回合`, { player: seat });
  }

  // --------------------------------------------------------------- jail ----

  private *jailPhase(seat: number): Flow<{ kind: 'stay' } | { kind: 'free' } | { kind: 'rolled'; dice: [number, number] }> {
    const p = this.state.players[seat];
    p.jailTurns++;
    if (p.jailTurns >= this.cfg.cliffMaxTurns) {
      this.release(seat, `面壁 ${p.jailTurns} 回合期满，自动离开思过崖`);
      return { kind: 'free' };
    }
    const opts: ChoiceOption<'pay' | 'roll' | 'calm'>[] = [];
    if (p.stones >= this.cfg.cliffFee) opts.push({ id: 'pay', label: `付 ${this.cfg.cliffFee} 灵石离开`, value: 'pay' });
    if (this.canPay(p, 'calm')) opts.push({ id: 'calm', label: `清心符（${this.spellById.get('calm')!.cost} 灵丹）`, value: 'calm' });
    opts.push({ id: 'roll', label: '掷骰（双数离开）', value: 'roll' });
    const ch = yield* this.ask({
      player: seat, kind: 'cliff', title: '思过崖 · 面壁', desc: `第 ${p.jailTurns} 回合面壁。第 ${this.cfg.cliffMaxTurns} 回合自动离开。`,
      options: opts, defaultId: 'roll', forceAsk: true,
    });
    if (ch === 'pay') {
      p.stones -= this.cfg.cliffFee;
      this.release(seat, `付 ${this.cfg.cliffFee} 灵石离开思过崖`);
      return { kind: 'free' };
    }
    if (ch === 'calm') {
      this.payCard(seat, 'calm');
      this.release(seat, '施放清心符，离开思过崖');
      return { kind: 'free' };
    }
    const dice: [number, number] = [this.d6(), this.d6()];
    this.emit('roll', `${this.pn(seat)} 面壁掷骰 ${dice[0]} + ${dice[1]}`, { player: seat, dice, amount: dice[0] + dice[1] });
    if (dice[0] === dice[1]) {
      this.release(seat, '掷出双数，离开思过崖');
      return { kind: 'rolled', dice };
    }
    this.emit('jail', `${this.pn(seat)} 未掷出双数，继续面壁`, { player: seat });
    return { kind: 'stay' };
  }

  private release(seat: number, why: string): void {
    const p = this.state.players[seat];
    p.jailed = false;
    p.jailTurns = 0;
    this.emit('release', `${this.pn(seat)} ${why}`, { player: seat });
  }

  /** Sends a player to 思过崖. Returns false if 白泽护道 prevented it. */
  sendToCliff(seat: number): boolean {
    const p = this.state.players[seat];
    if (isWardActive(this.state, seat)) {
      this.emit('block', `${this.pn(seat)} 受白泽护道庇佑，免于面壁`, { player: seat });
      return false;
    }
    const from = p.pos;
    p.pos = this.board.cliffId;
    p.cameFrom = null;
    p.jailed = true;
    p.jailTurns = 0;
    this.emit('teleport', `${this.pn(seat)} 前往思过崖面壁`, { player: seat, node: p.pos, from });
    this.emit('jail', `${this.pn(seat)} 开始面壁`, { player: seat });
    return true;
  }

  // ------------------------------------------------------------ pre-roll ---

  private canPay(p: PlayerState, card: string): boolean {
    const s = this.spellById.get(card)!;
    return p.hand.includes(card) && p.pills >= s.cost;
  }

  /** Remove card from hand, pay its 灵丹 cost, discard it. */
  private payCard(seat: number, card: string): void {
    const p = this.state.players[seat];
    const i = p.hand.indexOf(card);
    if (i < 0) throw new Error(`${card} not in hand`);
    const s = this.spellById.get(card)!;
    p.hand.splice(i, 1);
    p.pills -= s.cost;
    if (!s.shopOnly) this.state.spellDiscard.push(card); // 道具用完即消失，不进牌堆
    this.emit('cast', `${this.pn(seat)} 施放【${s.name}】`, { player: seat });
  }

  private ultAvailable(seat: number, phase: 'preroll' | 'action'): boolean {
    const p = this.state.players[seat];
    if (p.ultUses >= this.cfg.ult.maxUses || p.pills < this.cfg.ult.pillCost) return false;
    switch (p.hero) {
      case 'body': return p.rentImmuneUntilTurn < p.turnsTaken;
      case 'sword': return phase === 'preroll' && !this.state.turn.swordUlt;
      case 'magic': return phase === 'action' && this.thunderTargets(seat).length > 0;
      case 'alch': return phase === 'action' && this.buyoutTargets(seat).length > 0;
    }
  }

  private ultOption(seat: number): { id: 'ult'; label: string; value: { t: 'ult' }; hint: string } {
    const h = this.data.heroes.find((x) => x.id === this.state.players[seat].hero)!;
    return { id: 'ult', label: `大招【${h.ult.name}】（${this.cfg.ult.pillCost} 灵丹）`, value: { t: 'ult' }, hint: h.ult.desc };
  }

  private *preRollPhase(seat: number): Flow<'roll' | 'moved'> {
    const p = this.state.players[seat];
    const t = this.state.turn;
    for (;;) {
      const opts: ChoiceOption<PreRollAct>[] = [{ id: 'roll', label: '掷骰子', value: { t: 'roll' } }];
      const onRing = this.board.node(p.pos).outer;
      for (const card of new Set(p.hand)) {
        const s = this.spellById.get(card)!;
        if (s.timing !== 'preroll' && card !== 'discount') continue;
        if (!this.canPay(p, card)) continue;
        if (card === 'swiftstep' && t.swiftstep) continue;
        if ((card === 'reverse' || card === 'turnback') && (t.reverse || !onRing)) continue;
        if (card === 'dice' && t.diceCard) continue;
        if (card === 'burrow' && !onRing) continue;
        if (card === 'discount' && t.discount) continue;
        opts.push({ id: `cast:${card}`, label: `${s.name}（${s.cost} 灵丹）`, value: { t: 'cast', card }, hint: s.desc });
      }
      if (this.ultAvailable(seat, 'preroll')) opts.push(this.ultOption(seat));
      if (p.divines.includes('shrink') && this.state.round >= p.shrinkReadyRound && onRing && this.board.node(p.pos).region) {
        opts.push({ id: 'shrink', label: '神通【缩地成寸】', value: { t: 'shrink' } });
      }
      if (this.skillAvailable(seat, 'preroll')) opts.push(this.skillOption(seat));
      const act = yield* this.ask({
        player: seat, kind: 'preRoll', title: '掷骰前', desc: '可施放身法符、财运符，或直接掷骰。',
        options: opts, defaultId: 'roll', forceAsk: true,
      });
      if (act.t === 'roll') return 'roll';
      if (act.t === 'ult') { yield* this.useUlt(seat); continue; }
      if (act.t === 'shrink') { yield* this.useShrink(seat); return 'moved'; }
      if (act.t === 'skill') {
        if ((yield* this.useSkill(seat)) === 'moved') return 'moved';
        continue;
      }
      const r = yield* this.castPreroll(seat, act.card);
      if (r === 'moved') return 'moved';
    }
  }

  private *castPreroll(seat: number, card: string): Flow<'moved' | 'ok'> {
    const p = this.state.players[seat];
    const t = this.state.turn;
    if (card === 'treasure') {
      const opts: ChoiceOption<RegionId | 'cancel'>[] = REGION_IDS.map((r) => ({
        id: r, label: `${this.data.board.regions[r].name}（拥有 ${countOwned(this.state, this.board, seat, r)} 块）`, value: r,
      }));
      opts.push({ id: 'cancel', label: '取消', value: 'cancel' });
      const region = yield* this.ask({
        player: seat, kind: 'region', title: '聚宝符', desc: '指定一个灵域，本轮你在该灵域的租金 ×2',
        options: opts, cancelId: 'cancel', ctx: { purpose: 'treasure' },
      });
      if (region === 'cancel') return 'ok';
      this.payCard(seat, card);
      p.treasure.push({ region, round: this.state.round });
      this.emit('status', `${this.pn(seat)} 本轮在${this.data.board.regions[region].name}的租金 ×2`, { player: seat });
      return 'ok';
    }
    this.payCard(seat, card);
    switch (card) {
      case 'swiftstep': t.swiftstep = true; return 'ok';
      case 'reverse': case 'turnback': t.reverse = true; return 'ok';
      case 'discount': t.discount = true; return 'ok';
      case 'dice': t.diceCard = true; return 'ok';
      case 'burrow': {
        const path = this.board.pathToGate(p.pos);
        const gate = path[path.length - 1];
        let from = p.pos;
        for (const n of path) {
          p.pos = n;
          this.emit('step', '', { player: seat, node: n, from });
          if (this.board.node(n).type === 'start') this.gainStones(seat, this.cfg.salaryPass, '经过宗门山门');
          this.meetSpirits(seat, n);
          from = n;
        }
        this.emit('info', `${this.pn(seat)} 遁地至【${this.nodeName(gate)}】`, { player: seat, node: gate });
        p.cameFrom = null;
        t.lastPath = [];
        return 'moved';
      }
      default: throw new Error(`not a preroll card: ${card}`);
    }
  }

  private *useShrink(seat: number): Flow {
    const p = this.state.players[seat];
    const region = this.board.node(p.pos).region!;
    const opts = this.board.regionNodes(region).filter((n) => n !== p.pos).map((n) => ({
      id: n, label: this.nodeLabel(n), value: n, node: n,
    }));
    const node = yield* this.ask({
      player: seat, kind: 'node', title: '缩地成寸', desc: '移动到当前灵域任意外环格并结算', options: opts, ctx: { purpose: 'shrink' },
    });
    p.shrinkReadyRound = this.state.round + this.cfg.rules.shrinkCooldownRounds;
    this.teleport(seat, node, '缩地成寸');
    yield* this.settle(seat, node);
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
    let dir: 1 | -1 = 1;
    if (t.reverse) dir = -1;
    else if (p.mazeAvailable && this.board.node(p.pos).outer) {
      dir = yield* this.ask({
        player: seat, kind: 'direction', title: '迷踪', desc: `本次移动 ${total} 步，可选择逆时针`,
        options: [
          { id: 'cw', label: '顺时针', value: 1 },
          { id: 'ccw', label: '逆时针', value: -1 },
        ],
        defaultId: 'cw', ctx: { remaining: total },
      });
    }
    p.mazeAvailable = false;
    yield* this.walk(seat, total, dir);
    t.swiftstep = false;
    t.reverse = false;
    t.swordUlt = false;
    yield* this.offerDuel(seat);
    yield* this.settle(seat, p.pos);
  }

  private *adjustRoll(seat: number, base: number, dice?: [number, number]): Flow<number> {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const sets: number[][] = [];
    if (t.swiftstep) sets.push(Array.from({ length: this.cfg.rules.swiftstepMax }, (_, i) => i + 1));
    if (p.divines.includes('swift')) sets.push([-this.cfg.rules.swiftDivineDelta, 0, this.cfg.rules.swiftDivineDelta]);
    if (t.swordUlt) sets.push(Array.from({ length: this.cfg.rules.swordUltDelta * 2 + 1 }, (_, i) => i - this.cfg.rules.swordUltDelta));
    let totals = new Set<number>([base]);
    for (const s of sets) {
      const next = new Set<number>();
      for (const a of totals) for (const d of s) next.add(Math.max(1, a + d));
      totals = next;
    }
    const list = [...totals].sort((a, b) => a - b);
    if (list.length === 1) return list[0];
    const def = list.includes(base) ? base : list[0];
    const v = yield* this.ask({
      player: seat, kind: 'adjust', title: '调整点数', desc: `掷出 ${base}，选择最终移动步数`,
      options: list.map((n) => ({ id: `n${n}`, label: `${n} 步`, value: n, hint: n === base ? '原点数' : `${n > base ? '+' : ''}${n - base}` })),
      defaultId: `n${def}`, ctx: { base, dice },
    });
    if (v !== base) this.emit('info', `${this.pn(seat)} 调整点数 ${base} → ${v}`, { player: seat, amount: v });
    return v;
  }

  /**
   * Step-by-step movement (§3.3 / §3.4) along the board graph: forks, altar stop/toll,
   * start salary, mire, water slide, passing effects.
   */
  *walk(seat: number, steps: number, dir: 1 | -1): Flow {
    const p = this.state.players[seat];
    const t = this.state.turn;
    const b = this.board;
    let remaining = steps;
    let node = p.pos;
    let cameFrom = b.isTwoWay(node) ? p.cameFrom : null;
    const path: NodeId[] = [node];
    let gates = 0;
    let blocked = false;
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
      this.enterNode(seat, node, next, remaining, false);
      cameFrom = node;
      node = next;
      path.push(next);
      const nn = b.node(next);
      if (nn.type === 'gate') gates++;
      // 镇山: the mountain stops the next other player who enters its tile.
      const rb = this.state.roadblock;
      if (rb && rb.node === next && rb.seat !== seat) {
        this.state.roadblock = null;
        blocked = true;
        remaining = 0;
        this.emit('roadblockHit', `${this.pn(seat)} 被 ${this.pn(rb.seat)} 的山岳拦下，停在【${this.nodeName(next)}】`, { player: seat, node: next });
        break;
      }
      // §18.3 路障符: same as the mountain, consumed by the first other walker.
      const bi = this.state.barriers.findIndex((x) => x.node === next && x.seat !== seat);
      if (bi >= 0) {
        const bar = this.state.barriers.splice(bi, 1)[0];
        blocked = true;
        remaining = 0;
        this.emit('barrierHit', `${this.pn(seat)} 撞上 ${this.pn(bar.seat)} 的路障，停在【${this.nodeName(next)}】`, { player: seat, node: next });
        break;
      }
      // 瘴泽泥沼: first entry onto an earth land this turn costs one remaining step.
      if (nn.type === 'land' && nn.region === 'earth' && !t.mireUsed) {
        t.mireUsed = true;
        if (remaining > 0) {
          remaining--;
          this.emit('mire', `${this.pn(seat)} 陷入瘴泽泥沼，剩余步数 −1`, { player: seat, node: next });
        }
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
    // 寒冰滑行: ending a move on water slides one more cell in the same direction.
    const fin = b.node(node);
    if (!blocked && fin.type === 'land' && fin.region === 'water') {
      const next = b.exits(node, cameFrom, dir)[0];
      this.emit('slide', `${this.pn(seat)} 踏上寒冰，滑行 1 格`, { player: seat, node: next, from: node });
      this.enterNode(seat, node, next, 0, true);
      cameFrom = node;
      node = next;
      path.push(next);
    }
    p.pos = node;
    p.cameFrom = cameFrom;
    t.lastPath = path;
    t.lastDir = dir;
    if (gates >= 2) p.stats.twoGateMoves++;
    for (const task of p.tasks) {
      const def = this.taskById.get(task.id)!;
      if (def.check.kind === 'gatesInOneMove' && gates >= def.check.value) task.base = -1; // mark achieved
    }
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
  private enterNode(seat: number, from: NodeId, to: NodeId, remaining: number, slide: boolean): void {
    const p = this.state.players[seat];
    p.pos = to;
    const n = this.board.node(to);
    if (!slide) this.emit('step', '', { player: seat, node: to, from });
    if (n.type === 'start' && remaining > 0) this.gainStones(seat, this.cfg.salaryPass, '经过宗门山门');
    const t = this.state.turn;
    if (remaining > 0 && !slide && t.seat === seat) {
      for (const o of this.state.players) if (o.seat !== seat && o.pos === to && !t.passed.includes(o.seat)) t.passed.push(o.seat);
    }
    // §18.2 心魔 jumps to the first other player its holder meets on its own move (passing or stopping).
    const heart = this.heldSpirit(seat);
    if (heart?.kind === 'heart' && !slide && t.seat === seat) {
      const o = this.state.players.find((x) => x.seat !== seat && x.pos === to);
      if (o) this.possess(o.seat, heart, seat);
    }
    this.meetSpirits(seat, to);
    if (p.hero === 'magic' && n.type === 'spring') {
      p.pills += this.cfg.rules.magicPassivePills;
      this.emit('pills', `${this.pn(seat)} 灵息：经过${n.name} +${this.cfg.rules.magicPassivePills} 灵丹`, { player: seat, amount: this.cfg.rules.magicPassivePills });
    }
    if (p.hero === 'sword' && remaining > 0 && !slide) {
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
    this.meetSpirits(seat, node);
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
      let prev: NodeId;
      if (i > 0) prev = path[--i];
      else prev = b.mainStep(node, (b.isTwoWay(node) || t.seat !== seat ? -1 : -t.lastDir) as 1 | -1);
      this.emit('step', '', { player: seat, node: prev, from: node });
      node = prev;
      p.pos = node;
      this.meetSpirits(seat, node);
    }
    p.pos = node;
    p.cameFrom = null;
    t.lastPath = [];
    yield* this.settle(seat, node, { depth: depth + 1 });
  }

  // ------------------------------------------------------------- settling --

  private *settle(seat: number, node: NodeId, ctx: SettleCtx = {}): Flow {
    const depth = ctx.depth ?? 0;
    if (depth > 4) return;
    const p = this.state.players[seat];
    const n = this.board.node(node);
    // §18.3 爆炎阵 goes off before the tile settles; being blown away skips the settle.
    const bi = ctx.stay ? -1 : this.state.blasts.findIndex((x) => x.node === node && x.seat !== seat);
    if (bi >= 0) {
      const bl = this.state.blasts.splice(bi, 1)[0];
      this.emit('blast', `${this.pn(seat)} 踩中 ${this.pn(bl.seat)} 暗埋的爆炎阵！`, { player: seat, node });
      if (this.sendToHospital(seat)) return;
    }
    switch (n.type) {
      case 'start':
        this.gainStones(seat, this.cfg.salaryLand, '停留宗门山门');
        break;
      case 'land':
        yield* this.settleLand(seat, node, ctx);
        break;
      case 'gate':
        break;
      case 'trial':
        this.emit('info', `${this.pn(seat)} 参悟历练碑`, { player: seat, node });
        yield* this.drawFortune(seat, depth);
        break;
      case 'spring': {
        this.gainPills(seat, this.cfg.rules.springPills, '灵泉');
        if (p.bound) { p.bound = false; this.emit('status', `灵泉洗去${NEGATIVE_STATUS_LABEL.bound}`, { player: seat }); }
        else if (p.tremorRound === this.state.round) { p.tremorRound = 0; this.emit('status', `灵泉洗去${NEGATIVE_STATUS_LABEL.tremor}`, { player: seat }); }
        break;
      }
      case 'market':
        yield* this.market(seat);
        break;
      case 'furnace':
        this.gainPills(seat, this.cfg.rules.furnacePills, '丹炉');
        break;
      case 'cliff':
        if (!ctx.stay && !p.jailed) this.sendToCliff(seat);
        break;
      case 'array':
        yield* this.arrayTeleport(seat, depth);
        break;
      case 'shrine':
        this.gainPills(seat, this.cfg.rules.shrinePills, '白泽祠');
        if (!p.seal) { p.seal = true; this.emit('status', `${this.pn(seat)} 获得祠印（下次突破 −${this.cfg.shrineDiscount}）`, { player: seat }); }
        break;
      case 'altar':
        yield* this.altar(seat, depth);
        break;
      case 'shop':
        yield* this.shop(seat);
        break;
      case 'minigame':
        yield* this.miniGame(seat, node);
        break;
      case 'hospital':
        this.emit('info', `${this.pn(seat)} 到医馆探望伤者`, { player: seat, node });
        break;
    }
  }

  // ------------------------------------------------------ §18.3 百宝阁 ----

  /** Cards on sale: every card with a price. */
  shopItems(): SpellData[] {
    return this.data.spells.cards.filter((c) => c.price !== undefined);
  }

  private *shop(seat: number): Flow {
    const p = this.state.players[seat];
    if (p.hand.length >= this.cfg.handLimit) {
      this.emit('info', `${this.pn(seat)} 手牌已满，在百宝阁看了看`, { player: seat });
      return;
    }
    const items = this.shopItems().filter((c) => p.stones >= c.price!);
    if (items.length === 0) {
      this.emit('info', `${this.pn(seat)} 囊中羞涩，在百宝阁看了看`, { player: seat });
      return;
    }
    const opts: ChoiceOption<{ card: string; price: number } | null>[] = items.map((c) => ({
      id: c.id, label: `${c.name}（${c.price} 灵石）`, value: { card: c.id, price: c.price! }, hint: c.desc,
    }));
    opts.push({ id: 'leave', label: '离开', value: null });
    const buy = yield* this.ask({
      player: seat, kind: 'shop', title: '百宝阁', desc: `每次限购 1 件（持有 ${p.stones} 灵石，手牌 ${p.hand.length} / ${this.cfg.handLimit}）`,
      options: opts, defaultId: 'leave', cancelId: 'leave', forceAsk: true,
    });
    if (!buy) return;
    p.stones -= buy.price;
    p.hand.push(buy.card);
    p.stats.shopBuys++;
    this.emit('shop', `${this.pn(seat)} 在百宝阁以 ${buy.price} 灵石买下【${this.spellName(buy.card)}】`, { player: seat, card: buy.card, amount: buy.price });
  }

  // ------------------------------------------------------ §18.5 小游戏 ----

  private *miniGame(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const r = this.cfg.rules;
    const game = this.board.node(node).game ?? 'alchemy';
    p.stats.miniGames++;
    if (game === 'alchemy') {
      const tierLabel: Record<MiniGameTier, string> = { perfect: '极品丹成', ok: '丹成', fail: '炸炉' };
      const res = yield* this.ask({
        player: seat, kind: 'miniGame', title: '炼丹房', desc: '看准火候收火：完美、命中或失手',
        options: (['perfect', 'ok', 'fail'] as const).map((tier) => ({
          id: tier, label: `${tierLabel[tier]}（+${r.miniGameRewards.alchemy[tier]} 灵丹）`, value: { game, tier },
        })),
        defaultId: 'ok', forceAsk: true, ctx: { game },
      });
      const pills = r.miniGameRewards.alchemy[res.tier];
      p.pills += pills;
      this.emit('miniGame', `${this.pn(seat)} 在炼丹房${tierLabel[res.tier]}${pills ? `，+${pills} 灵丹` : '，一无所获'}`, {
        player: seat, node, amount: pills, miniGame: { game, tier: res.tier, reward: { pills, stones: 0 } },
      });
      return;
    }
    // 灵骰台: bet, then the engine rolls (rng) and the miniGame answer only confirms the verdict.
    const opts: ChoiceOption<DiceBet>[] = [];
    for (const side of ['big', 'small'] as const) {
      for (const stake of r.diceStakes) {
        if (stake > p.stones) continue;
        opts.push({ id: `${side}${stake}`, label: `押${side === 'big' ? '大' : '小'} · ${stake ? `${stake} 灵石` : '不下注'}`, value: { stake, side } });
      }
    }
    const bet = yield* this.ask({
      player: seat, kind: 'diceBet', title: '灵骰台',
      desc: `两颗骰子，${r.diceBigMin} 点及以上为大，${r.diceSmallMax} 点及以下为小，其余庄家通吃。猜中押注 ×${r.diceWinMult}，并 +${r.miniGameRewards.dice.perfect} 灵丹`,
      options: opts, defaultId: 'big0', forceAsk: true, ctx: { game },
    });
    p.stones -= bet.stake;
    const roll: [number, number] = [this.d6(), this.d6()];
    const sum = roll[0] + roll[1];
    const win = bet.side === 'big' ? sum >= r.diceBigMin : sum <= r.diceSmallMax;
    const tier: MiniGameTier = win ? 'perfect' : 'fail';
    yield* this.ask({
      player: seat, kind: 'miniGame', title: '灵骰台 · 开盅', desc: `${roll[0]} + ${roll[1]} = ${sum} 点`,
      options: [{ id: tier, label: win ? '猜中了！' : '没猜中', value: { game, tier } }],
      forceAsk: true, ctx: { game, diceBet: bet, dice: roll },
    });
    const back = win ? bet.stake * r.diceWinMult : 0;
    const pills = r.miniGameRewards.dice[tier];
    p.stones += back;
    p.pills += pills;
    const net = back - bet.stake;
    this.emit('miniGame', `${this.pn(seat)} 押${bet.side === 'big' ? '大' : '小'}${bet.stake ? ` ${bet.stake} 灵石` : ''}，开出 ${roll[0]} + ${roll[1]} = ${sum}，${win ? `猜中${net ? `，赢 ${net} 灵石` : ''}${pills ? `，+${pills} 灵丹` : ''}` : `落空${bet.stake ? `，输 ${bet.stake} 灵石` : ''}`}`, {
      player: seat, node, amount: net, dice: roll,
      miniGame: { game, tier, reward: { pills, stones: net }, roll, side: bet.side, stake: bet.stake },
    });
  }

  private *settleLand(seat: number, node: NodeId, ctx: SettleCtx = {}): Flow {
    const p = this.state.players[seat];
    const t = this.state.tiles[node];
    const n = this.board.node(node);
    if (t.owner === null) {
      const price = buyPrice(this.state, this.data, p, n.price!, this.state.turn.discount && this.state.current === seat);
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
      this.setOwner(node, seat);
      this.emit('buy', `${this.pn(seat)} 以 ${price} 灵石购得【${n.name}】`, { player: seat, node, amount: price });
      this.checkStreet(seat, node);
      this.updateVeinLords();
    } else if (t.owner !== seat) {
      const owner = t.owner;
      yield* this.payRent(seat, node);
      if (t.special === 'bazaar' && t.owner === owner) this.bazaarSale(seat, owner);
      if (t.trap && t.owner !== null && t.owner !== seat && !ctx.stay) this.triggerTrap(seat, node);
    } else if (t.special === 'portal' && !ctx.stay) {
      yield* this.portal(seat, node);
    }
  }

  /** §18.1 Emits `street` when `seat` has just completed the street of `node`. */
  private checkStreet(seat: number, node: NodeId): void {
    if (!ownsStreet(this.state, this.board, node, seat)) return;
    const street = this.board.node(node).street!;
    this.state.players[seat].stats.streets++;
    this.emit('street', `${this.pn(seat)} 凑齐【${this.board.streetName(street)}】整条街，街上租金 ×${this.cfg.rules.streetRentMult}`, {
      player: seat, node, street,
    });
  }

  /** §18.4 集市: the visitor must buy the owner's oldest card at its price (skipped if they cannot). */
  private bazaarSale(buyer: number, owner: number): void {
    const b = this.state.players[buyer];
    const o = this.state.players[owner];
    const card = o.hand[0];
    if (card === undefined) return;
    const price = this.spellById.get(card)!.price ?? this.cfg.marketCardPrice;
    if (b.hand.length >= this.cfg.handLimit || b.stones < price) {
      this.emit('info', `${this.pn(buyer)} ${b.hand.length >= this.cfg.handLimit ? '手牌已满' : '灵石不足'}，免于集市强卖`, { player: buyer });
      return;
    }
    o.hand.shift();
    b.hand.push(card);
    b.stones -= price;
    o.stones += price;
    this.emit('special', `${this.pn(buyer)} 在 ${this.pn(owner)} 的集市被迫以 ${price} 灵石买下【${this.spellName(card)}】`, {
      player: buyer, special: 'bazaar', card, amount: price,
    });
  }

  /** §18.4 挪移阵: from one own portal to another, without settling there. */
  private *portal(seat: number, node: NodeId): Flow {
    const p = this.state.players[seat];
    const cost = this.cfg.rules.portalPills;
    const others = this.board.lands.filter((id) => id !== node && this.state.tiles[id].owner === seat && this.state.tiles[id].special === 'portal');
    if (others.length === 0 || p.pills < cost) return;
    const opts: ChoiceOption<NodeId | null>[] = others.map((id) => ({ id, label: `挪移至${this.nodeLabel(id)}`, value: id, node: id }));
    opts.push({ id: 'stay', label: '留在此处', value: null });
    const to = yield* this.ask({
      player: seat, kind: 'portal', title: '挪移阵', desc: `传送到你的另一座挪移阵${cost ? `（${cost} 灵丹）` : ''}`,
      options: opts, defaultId: 'stay', cancelId: 'stay', forceAsk: true,
    });
    if (to === null) return;
    p.pills -= cost;
    this.teleport(seat, to, '踏入挪移阵');
    this.state.turn.lastPath = [];
  }

  /** §17 禁制：停在他人布了禁制的洞府上 → 交罚金并被定身，禁制消耗。 */
  private triggerTrap(seat: number, node: NodeId): void {
    const t = this.state.tiles[node];
    const owner = t.owner!;
    t.trap = false;
    this.state.players[owner].stats.trapTriggers++;
    this.emit('trap', `${this.pn(seat)} 触发 ${this.pn(owner)} 在【${this.nodeName(node)}】布下的禁制！`, { player: seat, node });
    const paid = this.pay(seat, owner, this.cfg.rules.trapStones, '禁制罚金');
    this.emit('stones', `${this.pn(seat)} 交给 ${this.pn(owner)} 禁制罚金 ${paid} 灵石`, { player: seat, amount: paid });
    this.state.players[seat].bound = true;
    this.emit('bind', `${this.pn(seat)} 被禁制定身，下回合无法移动`, { player: seat });
  }

  private *payRent(seat: number, node: NodeId): Flow {
    const st = this.state;
    const p = st.players[seat];
    const t = st.tiles[node];
    const ownerSeat = t.owner!;
    const owner = st.players[ownerSeat];
    if (st.demon && st.demon.node === node) {
      this.emit('rentFree', `天魔盘踞【${this.nodeName(node)}】，租金为 0`, { player: seat, node });
      return;
    }
    if (p.turnsTaken <= p.rentImmuneUntilTurn) {
      this.emit('rentFree', `${this.pn(seat)} 不动明王，免付租金`, { player: seat, node });
      return;
    }
    const rb = rentFor(st, this.board, this.data, node, seat);
    if (rb.amount <= 0) return;
    if (this.canPay(p, 'evade')) {
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
    owner.stats.rentCollected += paid;
    p.stats.rentPaid += paid;
    this.emit('rent', `${this.pn(seat)} 向 ${this.pn(ownerSeat)} 支付租金 ${paid}${rb.mults.length > 1 ? `（${rb.mults.slice(1).map((m) => m.label).join('、')}）` : ''}`, { player: seat, node, amount: paid });
    if (paid > 0 && owner.divines.includes('gather') && owner.gatherRound !== st.round) {
      owner.gatherRound = st.round;
      this.gainPills(ownerSeat, this.cfg.rules.gatherPills, '聚灵');
    }
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

  /** §7 破产重整. */
  private bankrupt(seat: number): void {
    const p = this.state.players[seat];
    const cfg = this.cfg.bankrupt;
    for (const id of this.board.lands) {
      const t = this.state.tiles[id];
      if (t.owner === seat) { t.owner = null; t.level = 0; t.trap = false; delete t.special; }
    }
    for (const r of REGION_IDS) this.state.regionReach[r][seat] = ++this.state.seq;
    p.stones = cfg.resetStones;
    p.cultBase = Math.max(0, p.cultBase - cfg.cultivationLoss);
    p.stats.bankruptcies++;
    this.emit('bankrupt', `${this.pn(seat)} 破产重整：灵田尽数归还，领取 ${cfg.resetStones} 灵石，修为 −${cfg.cultivationLoss}`, { player: seat });
    this.updateVeinLords();
  }

  private gainStones(seat: number, n: number, why: string): void {
    this.state.players[seat].stones += n;
    this.emit('salary', `${this.pn(seat)} ${why} +${n} 灵石`, { player: seat, amount: n });
  }

  private gainPills(seat: number, n: number, why: string): void {
    this.state.players[seat].pills += n;
    this.emit('pills', `${this.pn(seat)} ${why} +${n} 灵丹`, { player: seat, amount: n });
  }

  private setOwner(node: NodeId, seat: number | null): void {
    const t = this.state.tiles[node];
    const region = this.board.node(node).region!;
    if (t.owner !== null) this.state.regionReach[region][t.owner] = ++this.state.seq;
    if (t.owner !== seat) t.trap = false;
    t.owner = seat;
    if (seat !== null) this.state.regionReach[region][seat] = ++this.state.seq;
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
      player: seat, kind: 'market', title: '坊市', desc: `${price} 灵石 / 张，最多 ${this.cfg.marketMaxBuy} 张（交易功能暂未开放）`,
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
    const avail = breakthroughsAvailable(p);
    const opts: ChoiceOption<'break' | 'calm' | 'leave'>[] = [];
    if (can) opts.push({ id: 'break', label: `突破（${cost} 灵丹）`, value: 'break' });
    opts.push({ id: 'calm', label: '静心（+1 灵丹，抽机缘）', value: 'calm' });
    opts.push({ id: 'leave', label: '离开', value: 'leave' });
    const th = this.cfg.breakthroughThresholds;
    const noChance = p.btEarned < th.length
      ? `暂无突破机会（修为每达 ${th.join(' / ')} 各得 1 次，下一次在修为 ${th[p.btEarned]}）`
      : '突破机会已用完';
    const why = avail <= 0 ? noChance : p.divines.length >= this.cfg.maxDivine ? '神通已满' : !can ? `灵丹不足（需 ${cost}）` : `突破机会 ${avail} 次`;
    const ch = yield* this.ask({
      player: seat, kind: 'altar', title: '白泽灵台', desc: why, options: opts, defaultId: can ? 'break' : 'calm', ctx: { cost },
    });
    if (ch === 'leave') return;
    if (ch === 'calm') {
      this.gainPills(seat, 1, '静心');
      yield* this.drawFortune(seat, depth);
      return;
    }
    // breakthrough
    p.pills -= cost;
    if (p.seal) p.seal = false;
    p.btUsed++;
    p.stats.breakthroughs++;
    this.emit('breakthrough', `${this.pn(seat)} 于白泽灵台第 ${p.btUsed} 次突破（耗 ${cost} 灵丹）`, { player: seat, amount: cost });
    const others = st.players.filter((o) => o.seat !== seat).map((o) => this.cult(o.seat));
    const lowest = this.cult(seat) <= Math.min(...others);
    const count = lowest ? this.cfg.breakthroughDrawLowest : this.cfg.breakthroughDraw;
    const pool = this.shuffle(this.data.blessings.divine.map((d) => d.id).filter((id) => !p.divines.includes(id)));
    const offered = pool.slice(0, count);
    const pick = yield* this.ask({
      player: seat, kind: 'divinePick', title: '选择神通', desc: lowest ? '你是全场修为最低者，多翻 1 张' : '选 1 张永久生效',
      options: offered.map((id) => {
        const d = this.data.blessings.divine.find((x) => x.id === id)!;
        return { id, label: d.name, value: id, hint: d.desc };
      }),
      forceAsk: true,
    });
    p.divines.push(pick);
    if (pick === 'goldbody') p.goldbodyReadyRound = st.round;
    if (pick === 'shrink') p.shrinkReadyRound = st.round;
    this.emit('divine', `${this.pn(seat)} 领悟神通【${this.data.blessings.divine.find((x) => x.id === pick)!.name}】`, { player: seat });
  }

  // ---------------------------------------------------------- 机缘 cards --

  private drawEventCard(seat: number, forceGood: boolean): string | null {
    const st = this.state;
    const p = st.players[seat];
    for (let attempt = 0; attempt < 40; attempt++) {
      if (st.eventDeck.length === 0) {
        st.eventDeck = this.shuffle(st.eventDiscard);
        st.eventDiscard = [];
      }
      if (st.eventDeck.length === 0) return null;
      let id: string;
      if (forceGood) {
        const isGood = (x: string) => this.eventById.get(x)?.good === true;
        let idx = st.eventDeck.findIndex(isGood);
        if (idx >= 0) id = st.eventDeck.splice(idx, 1)[0];
        else {
          idx = st.eventDiscard.findIndex(isGood);
          id = idx >= 0 ? st.eventDiscard.splice(idx, 1)[0] : st.eventDeck.shift()!;
        }
        this.emit('info', `${this.pn(seat)} 时来运转（保底）`, { player: seat });
      } else {
        id = st.eventDeck.shift()!;
      }
      if (this.taskById.has(id) && p.tasks.length >= this.cfg.maxActiveTasks) {
        st.eventDiscard.push(id); // already holding the max number of tasks: redraw
        continue;
      }
      return id;
    }
    return null;
  }

  private *drawFortune(seat: number, depth: number): Flow {
    const p = this.state.players[seat];
    const count = p.divines.includes('sense') ? this.cfg.rules.senseDrawCount : 1;
    const cards: string[] = [];
    for (let k = 0; k < count; k++) {
      const id = this.drawEventCard(seat, k === 0 && p.badStreak >= this.cfg.badLuckStreak);
      if (id) cards.push(id);
    }
    if (cards.length === 0) return;
    let chosen = cards[0];
    if (cards.length > 1) {
      chosen = yield* this.ask({
        player: seat, kind: 'eventPick', title: '神识 · 机缘', desc: '抽 2 选 1',
        options: cards.map((id, i) => {
          const c = this.eventById.get(id) ?? this.taskById.get(id)!;
          return { id: `${i}:${id}`, label: c.name, value: id, hint: c.desc };
        }),
        forceAsk: true,
      });
      const other = cards.indexOf(chosen) === 0 ? cards[1] : cards[0];
      this.state.eventDiscard.push(other);
    }
    yield* this.resolveFortune(seat, chosen, depth);
  }

  private taskCounter(p: PlayerState, def: TaskData): number {
    switch (def.check.kind) {
      case 'rentCollected': return p.stats.rentCollected;
      case 'breakthroughDone': return p.stats.breakthroughs;
      case 'demonDamage': return p.stats.demonDamage;
      default: return 0;
    }
  }

  private *resolveFortune(seat: number, id: string, depth: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    const task = this.taskById.get(id);
    if (task) {
      if (p.tasks.length >= this.cfg.maxActiveTasks) { st.eventDiscard.push(id); return; }
      p.tasks.push({ id, base: this.taskCounter(p, task) });
      p.badStreak = 0;
      this.emit('task', `${this.pn(seat)} 接下${task.name}：${task.desc}`, { player: seat });
      return;
    }
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
    if (e.shrineSeal) p.seal = true;
    if (e.allPills) for (const o of st.players) o.pills += e.allPills;
    if (e.rentHalfSelf) p.tremorRound = st.round;
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
    if (e.payLeader !== undefined) {
      const my = this.cult(seat);
      const best = Math.max(...st.players.map((o) => this.cult(o.seat)));
      if (my < best) {
        const leader = st.players.find((o) => this.cult(o.seat) === best)!.seat;
        const paid = this.pay(seat, leader, e.payLeader, '宗门供奉');
        this.emit('stones', `${this.pn(seat)} 向 ${this.pn(leader)} 供奉 ${paid} 灵石`, { player: seat, amount: paid });
      }
    }
    if (e.toCliff) this.sendToCliff(seat);
    if (e.moveBack) yield* this.moveBack(seat, e.moveBack, depth);
  }

  checkTasks(): void {
    for (const p of this.state.players) {
      for (const task of [...p.tasks]) {
        if (!this.taskDone(p, task)) continue;
        p.tasks.splice(p.tasks.indexOf(task), 1);
        this.state.eventDiscard.push(task.id);
        p.stats.tasksDone++;
        const def = this.taskById.get(task.id)!;
        this.emit('taskDone', `${this.pn(p.seat)} 完成${def.name}，修为 +1`, { player: p.seat });
        this.addCult(p.seat, 1, def.name);
      }
    }
  }

  private taskDone(p: PlayerState, task: ActiveTask): boolean {
    const def = this.taskById.get(task.id)!;
    const c = def.check;
    switch (c.kind) {
      case 'rentCollected': return p.stats.rentCollected - task.base >= c.value;
      case 'breakthroughDone': return p.stats.breakthroughs - task.base >= c.value;
      case 'demonDamage': return p.stats.demonDamage - task.base >= c.value;
      case 'gatesInOneMove': return task.base === -1;
      case 'handSize': return p.hand.length >= c.value;
      case 'buildingsAtLeast':
        return this.board.lands.filter((id) => this.state.tiles[id].owner === p.seat && this.state.tiles[id].level >= c.level).length >= c.count;
    }
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
          if (t.owner !== seat || t.level >= 4 || t.special) continue;
          const c = upgradeCost(this.data, this.board.node(id).price!, t.level + 1, st.turn.discount);
          if (p.stones < c.stones || p.pills < c.pills) continue;
          opts.push({
            id: `upgrade:${id}`, label: `升级 ${this.nodeName(id)} → ${this.data.board.buildings[t.level + 1].name}（${c.stones}${c.pills ? ` + ${c.pills} 灵丹` : ''}）`,
            value: { t: 'upgrade', node: id }, node: id,
          });
        }
        for (const special of this.specialOptions(seat)) {
          const id = p.pos;
          const def = this.data.board.specials?.[special];
          const c = upgradeCost(this.data, this.board.node(id).price!, 1, st.turn.discount);
          opts.push({
            id: `upgrade:${id}:${special}`, label: `改建 ${this.nodeName(id)} → ${def?.name ?? special}（${c.stones}）`,
            value: { t: 'upgrade', node: id, special }, node: id, hint: def?.desc,
          });
        }
      }
      for (const card of new Set(p.hand)) {
        const s = this.spellById.get(card)!;
        if (s.timing !== 'action' || !this.canPay(p, card)) continue;
        if (card === 'thunder' && this.thunderTargets(seat).length === 0) continue;
        if (card === 'drain' && this.drainTargets(seat).length === 0) continue;
        if (card === 'bind' && this.bindTargets(seat).length === 0) continue;
        if (card === 'discount' && st.turn.discount) continue;
        if (card === 'barrier' && this.barrierSpots(seat).length === 0) continue;
        if (card === 'blast' && this.blastSpots(seat).length === 0) continue;
        opts.push({ id: `cast:${card}`, label: `${s.name}（${s.cost} 灵丹）`, value: { t: 'cast', card }, hint: s.desc });
      }
      if (this.ultAvailable(seat, 'action')) opts.push(this.ultOption(seat));
      if (this.skillAvailable(seat, 'action')) opts.push(this.skillOption(seat));
      for (const id of this.trapSpots(seat)) {
        opts.push({
          id: `trap:${id}`, label: `布置禁制 · ${this.nodeName(id)}（${this.cfg.rules.trapPillCost} 灵丹）`, value: { t: 'trap', node: id }, node: id,
          hint: `他人停留时交 ${this.cfg.rules.trapStones} 灵石并被定身 1 回合`,
        });
      }
      opts.push({ id: 'end', label: '结束回合', value: { t: 'end' } });
      const act = yield* this.ask({
        player: seat, kind: 'action', title: '行动阶段', desc: '升级 1 次、施放符箓、发动大招', options: opts, defaultId: 'end', forceAsk: true,
      });
      switch (act.t) {
        case 'end': return;
        case 'upgrade':
          if (act.special) this.buildSpecial(seat, act.node, act.special);
          else this.upgrade(seat, act.node, false);
          st.turn.upgraded = true;
          break;
        case 'ult': yield* this.useUlt(seat); break;
        case 'cast': yield* this.castAction(seat, act.card); break;
        case 'skill': yield* this.useSkill(seat); break;
        case 'trap': this.placeTrap(seat, act.node); break;
      }
    }
  }

  /** Performs one level of upgrade (paying unless free). Handles Lv3/Lv4 first-time 修为. */
  upgrade(seat: number, node: NodeId, free: boolean): void {
    const st = this.state;
    const p = st.players[seat];
    const t = st.tiles[node];
    const price = this.board.node(node).price!;
    const lv = t.level + 1;
    const c = upgradeCost(this.data, price, lv, st.turn.discount && st.current === seat);
    if (!free) p.stones -= c.stones;
    p.pills -= c.pills;
    t.level = lv;
    this.emit('upgrade', `${this.pn(seat)} 将【${this.nodeName(node)}】升为${this.data.board.buildings[lv].name}${free ? '（天降祥瑞）' : `（${c.stones} 灵石）`}`, { player: seat, node, amount: free ? 0 : c.stones });
    const gain = this.cfg.cultivationOnBuild[String(lv)];
    const key = `${node}:${lv}`;
    if (gain && !p.milestones.includes(key)) {
      p.milestones.push(key);
      this.addCult(seat, gain, `筑府·${this.data.board.buildings[lv].name}`);
    }
  }

  /** §18.4 功能建筑 `seat` may build now: only on the own Lv0 land they stand on, for the Lv1 price. */
  specialOptions(seat: number): SpecialKind[] {
    const st = this.state;
    const p = st.players[seat];
    const n = this.board.node(p.pos);
    const t = st.tiles[p.pos];
    if (n.type !== 'land' || !t || t.owner !== seat || t.level !== 0 || t.special) return [];
    if (p.stones < upgradeCost(this.data, n.price!, 1, st.turn.discount).stones) return [];
    return ['garden', 'bazaar', 'portal'];
  }

  private buildSpecial(seat: number, node: NodeId, special: SpecialKind): void {
    const st = this.state;
    const p = st.players[seat];
    const c = upgradeCost(this.data, this.board.node(node).price!, 1, st.turn.discount && st.current === seat);
    p.stones -= c.stones;
    st.tiles[node].special = special;
    p.stats.specialsBuilt++;
    const name = this.data.board.specials?.[special]?.name ?? special;
    this.emit('special', `${this.pn(seat)} 将【${this.nodeName(node)}】改建为${name}（${c.stones} 灵石）`, { player: seat, node, special, amount: c.stones });
    const key = `${node}:special`;
    if (this.cfg.rules.specialCultivation && !p.milestones.includes(key)) {
      p.milestones.push(key);
      this.addCult(seat, this.cfg.rules.specialCultivation, `筑府·${name}`);
    }
  }

  private downgrade(node: NodeId, why: string): void {
    const t = this.state.tiles[node];
    if (t.level <= 0) return;
    t.level--;
    this.emit('downgrade', `【${this.nodeName(node)}】${why}，降为${this.data.board.buildings[t.level].name}`, { node, player: t.owner ?? undefined });
  }

  /** Targets for 五雷符 / 五雷正法: others' buildings Lv≥1 (not ironskin-protected, not warded) + demon. */
  thunderTargets(seat: number): Target[] {
    const st = this.state;
    const out: Target[] = [];
    for (const id of this.board.lands) {
      const t = st.tiles[id];
      if (t.owner === null || t.owner === seat || t.level < 1) continue;
      const o = st.players[t.owner];
      if (o.hero === 'body' && t.level >= 3) continue; // 铜皮铁骨
      if (isWardActive(st, t.owner)) continue;
      out.push({ t: 'land', node: id });
    }
    if (st.demon) out.push({ t: 'demon' });
    return out;
  }

  drainTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && o.pills > 0).map((o) => o.seat);
  }

  bindTargets(seat: number): number[] {
    return this.state.players.filter((o) => o.seat !== seat && !o.bound && !isWardActive(this.state, o.seat)).map((o) => o.seat);
  }

  buyoutTargets(seat: number): NodeId[] {
    const st = this.state;
    const p = st.players[seat];
    return this.board.lands.filter((id) => {
      const t = st.tiles[id];
      // §18.4 功能建筑 cannot be bought out
      return t.owner !== null && t.owner !== seat && t.level <= 1 && !t.special && buyoutPrice(this.data, this.board.node(id).price!, t.level) <= p.stones;
    });
  }

  private targetOption(tg: Target): ChoiceOption<Target> {
    if (tg.t === 'land') return { id: `land:${tg.node}`, label: this.nodeLabel(tg.node), value: tg, node: tg.node };
    if (tg.t === 'demon') return { id: 'demon', label: `天魔（HP ${this.state.demon!.hp}）`, value: tg, node: this.state.demon!.node };
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
      case 'thunder': {
        const tg = yield* this.askTarget(seat, s.name, s.desc, this.thunderTargets(seat), 'thunder');
        if (tg.t === 'cancel') return;
        this.payCard(seat, card);
        if (tg.t === 'demon') this.damageDemon(seat, this.cfg.rules.thunderDemonDamage);
        else if (tg.t === 'land') yield* this.attackLand(seat, tg.node, 'thunder');
        return;
      }
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
      case 'goldtouch':
        this.payCard(seat, card);
        this.gainStones(seat, this.cfg.rules.goldtouchStones, '点金符');
        return;
      case 'discount':
        this.payCard(seat, card);
        this.state.turn.discount = true;
        this.emit('status', `${this.pn(seat)} 本回合购地 / 升级 7 折`, { player: seat });
        return;
      case 'barrier': {
        const tg = yield* this.askTarget(seat, s.name, s.desc, this.barrierSpots(seat).map((node) => ({ t: 'node' as const, node })), 'barrier');
        if (tg.t !== 'node') return;
        this.payCard(seat, card);
        const st = this.state;
        st.barriers = st.barriers.filter((x) => x.seat !== seat); // one barrier per player
        st.barriers.push({ node: tg.node, seat });
        this.emit('barrier', `${this.pn(seat)} 在【${this.nodeName(tg.node)}】放下路障`, { player: seat, node: tg.node });
        return;
      }
      case 'blast': {
        const tg = yield* this.askTarget(seat, s.name, s.desc, this.blastSpots(seat).map((node) => ({ t: 'node' as const, node })), 'blast');
        if (tg.t !== 'node') return;
        this.payCard(seat, card);
        this.state.blasts.push({ node: tg.node, seat });
        this.emit('blastSet', `${this.pn(seat)} 暗中埋下一道爆炎阵`, { player: seat, node: tg.node });
        return;
      }
      default:
        throw new Error(`not an action card: ${card}`);
    }
  }

  /** §18.3 路障符: the 1..barrierRange cells ahead of `seat` along its heading, without a player or another barrier. */
  barrierSpots(seat: number): NodeId[] {
    const st = this.state;
    const p = st.players[seat];
    const b = this.board;
    const out: NodeId[] = [];
    let prev = b.isTwoWay(p.pos) ? p.cameFrom : null;
    let n = p.pos;
    for (let k = 0; k < this.cfg.rules.barrierRange; k++) {
      const next = b.exits(n, prev, 1)[0];
      if (next === undefined) break;
      [prev, n] = [n, next];
      if (n === ALTAR) break;
      if (st.players.some((o) => o.pos === n) || st.barriers.some((x) => x.node === n) || st.roadblock?.node === n) continue;
      out.push(n);
    }
    return out;
  }

  /** §18.3 爆炎阵: any cell without a player or another blast, except the altar, the start and the 医馆. */
  blastSpots(_seat: number): NodeId[] {
    const st = this.state;
    return this.board.allNodeIds().filter((id) => {
      const type = this.board.node(id).type;
      if (type === 'altar' || type === 'start' || type === 'hospital') return false;
      return !st.players.some((o) => o.pos === id) && !st.blasts.some((x) => x.node === id);
    });
  }

  /** Defender may answer with 金光符. Returns true if the threat is blocked. */
  private *guard(defender: number, threat: ThreatKind, attacker: number | null, node?: NodeId): Flow<boolean> {
    const d = this.state.players[defender];
    if (!this.canPay(d, 'goldlight')) return false;
    const labels: Record<ThreatKind, string> = {
      thunder: '五雷符', fivethunder: '五雷正法', drain: '夺灵符', bind: '定身符', buyout: '灵丹换地', eruption: '地火喷发',
    };
    const use = yield* this.ask({
      player: defender, kind: 'guardReact', title: '是否反制？',
      desc: `${attacker !== null ? this.pn(attacker) + ' 对你施放' : '你遭遇'}【${labels[threat]}】`,
      options: [
        { id: 'goldlight', label: `金光符（${this.spellById.get('goldlight')!.cost} 灵丹）抵挡`, value: true },
        { id: 'no', label: '不反制', value: false },
      ],
      defaultId: 'no', cancelId: 'no', ctx: { threat, attacker: attacker ?? undefined, node },
    });
    if (!use) return false;
    this.payCard(defender, 'goldlight');
    this.emit('block', `${this.pn(defender)} 金光符护体，抵挡了${labels[threat]}`, { player: defender });
    return true;
  }

  private *attackLand(attacker: number, node: NodeId, kind: 'thunder' | 'fivethunder'): Flow {
    const st = this.state;
    const owner = st.tiles[node].owner!;
    if (goldbodyReady(st, owner)) {
      st.players[owner].goldbodyReadyRound = st.round + this.cfg.rules.goldbodyCooldownRounds;
      this.emit('block', `${this.pn(owner)} 金身自动护体，抵挡雷法`, { player: owner });
      return;
    }
    if (yield* this.guard(owner, kind, attacker, node)) return;
    const leader = uniqueLeader(st, this.data);
    this.downgrade(node, `遭 ${this.pn(attacker)} 雷击`);
    if (kind === 'thunder' && leader === owner && owner !== attacker) {
      this.emit('info', `${this.pn(attacker)} 击中修为第一者的洞府，获得悬赏`, { player: attacker });
      this.addCult(attacker, this.cfg.rules.bountyCultivation, '悬赏');
    }
  }

  private damageDemon(seat: number, base: number): void {
    const st = this.state;
    const d = st.demon;
    if (!d) return;
    const p = st.players[seat];
    const dmg = base * (p.divines.includes('subdue') ? this.cfg.rules.subdueDamageMult : 1);
    d.hp -= dmg;
    p.stats.demonDamage += dmg;
    this.emit('demonHit', `${this.pn(seat)} 对天魔造成 ${dmg} 点伤害（剩余 ${Math.max(0, d.hp)}）`, { player: seat, amount: dmg, node: d.node });
    if (d.hp <= 0) {
      st.demon = null;
      this.emit('demonGone', `${this.pn(seat)} 斩杀天魔！`, { player: seat, node: d.node });
      this.addCult(seat, this.cfg.rules.demonLastHitCultivation, '斩妖除魔');
    }
  }

  private *useUlt(seat: number): Flow {
    const st = this.state;
    const p = st.players[seat];
    const hero = this.data.heroes.find((h) => h.id === p.hero)!;
    const payUlt = () => {
      p.pills -= this.cfg.ult.pillCost;
      p.ultUses++;
      this.emit('ult', `${this.pn(seat)} 发动大招【${hero.ult.name}】`, { player: seat });
    };
    switch (p.hero) {
      case 'body':
        payUlt();
        p.rentImmuneUntilTurn = p.turnsTaken + this.cfg.rules.immovableTurns - 1;
        return;
      case 'sword':
        payUlt();
        st.turn.swordUlt = true;
        return;
      case 'magic': {
        const tg = yield* this.askTarget(seat, hero.ult.name, hero.ult.desc, this.thunderTargets(seat), 'fivethunder');
        if (tg.t === 'cancel') return;
        payUlt();
        if (tg.t === 'demon') this.damageDemon(seat, this.cfg.rules.magicUltDemonDamage);
        else if (tg.t === 'land') yield* this.attackLand(seat, tg.node, 'fivethunder');
        return;
      }
      case 'alch': {
        const tg = yield* this.askTarget(seat, hero.ult.name, hero.ult.desc, this.buyoutTargets(seat).map((node) => ({ t: 'land' as const, node })), 'buyout');
        if (tg.t !== 'land') return;
        payUlt();
        const t = st.tiles[tg.node];
        const owner = t.owner!;
        if (yield* this.guard(owner, 'buyout', seat, tg.node)) return;
        const price = buyoutPrice(this.data, this.board.node(tg.node).price!, t.level);
        p.stones -= price;
        st.players[owner].stones += price;
        this.setOwner(tg.node, seat);
        this.emit('ownerChange', `${this.pn(seat)} 以 ${price} 灵石强购 ${this.pn(owner)} 的【${this.nodeName(tg.node)}】`, { player: seat, node: tg.node, amount: price });
        this.checkStreet(seat, tg.node);
        this.updateVeinLords();
        return;
      }
    }
  }

  // ------------------------------------------------- §17 斗法 / 禁制 / 技能 --

  heroOf(seat: number): HeroData {
    return this.data.heroes.find((h) => h.id === this.state.players[seat].hero)!;
  }

  /** May `seat` be challenged right now (not 面壁, not already challenged this round)? */
  duelEligible(seat: number): boolean {
    const o = this.state.players[seat];
    return !o.jailed && o.duelShieldRound !== this.state.round;
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
      id: `p${s}`,
      label: `挑战 ${this.pn(s)}${st.bountySeat === s ? '（悬赏令）' : ''}`,
      value: s,
      node: st.players[s].pos,
      hint: `胜：夺 ${this.duelStake(s)} 灵石${st.bountySeat === s ? `，修为 +${this.cfg.rules.bountyDuelCultivation}` : ''}；败：失 ${this.duelStake(seat)} 灵石`,
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

  /** §17 斗法. Resolves fully, including the 悬赏令 payout. */
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
    const bounty = st.bountySeat === loser;
    const duel: DuelResult = { attacker, defender, bets: [betA, betD], rolls, bonus, totals, winner, loser, amount, bounty };
    const part = (i: 0 | 1) => `${rolls[i]}${[betA, betD][i] ? ` + 丹 ${[betA, betD][i]}` : ''}${bonus[i] ? ` + ${bonus[i]}` : ''} = ${totals[i]}`;
    this.emit('duel', `斗法：${this.pn(attacker)} ${part(0)} 对 ${this.pn(defender)} ${part(1)}，${this.pn(winner)} 胜${totals[0] === totals[1] ? '（平局守方胜）' : ''}，夺得 ${amount} 灵石`, {
      player: winner, node: pd.pos, amount, duel,
    });
    if (bounty) {
      st.bountySeat = null;
      st.players[winner].stats.bountyClaims++;
      this.emit('bounty', `${this.pn(winner)} 击败持令者 ${this.pn(loser)}，揭下悬赏令`, { player: winner });
      this.addCult(winner, r.bountyDuelCultivation, '悬赏令');
    }
  }

  /** Own lands where a 禁制 may be placed right now. */
  trapSpots(seat: number): NodeId[] {
    const st = this.state;
    const r = this.cfg.rules;
    if (st.players[seat].pills < r.trapPillCost) return [];
    const mine = this.board.lands.filter((id) => st.tiles[id].owner === seat);
    if (mine.filter((id) => st.tiles[id].trap).length >= r.trapMaxPerPlayer) return [];
    return mine.filter((id) => !st.tiles[id].trap);
  }

  private placeTrap(seat: number, node: NodeId): void {
    this.state.players[seat].pills -= this.cfg.rules.trapPillCost;
    this.state.tiles[node].trap = true;
    this.emit('trapSet', `${this.pn(seat)} 在【${this.nodeName(node)}】布下禁制`, { player: seat, node, amount: this.cfg.rules.trapPillCost });
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
            return !o.jailed && o.pos !== p.pos && d >= 0 && d <= this.cfg.rules.swapRange;
          })
          .map((o) => o.seat);
      case 'daze':
        return others.filter((o) => !o.dazed && !isWardActive(st, o.seat)).map((o) => o.seat);
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
        const to = o.pos;
        this.teleport(seat, to, `剑遁追至 ${this.pn(tg.seat)} 身前`);
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

  // ------------------------------------------------------- world events ---

  private *demonMove(): Flow {
    const st = this.state;
    const d = st.demon!;
    let node = d.node;
    for (let k = 0; k < this.cfg.demon.movePerRound; k++) node = this.board.mainStep(node, 1);
    const from = d.node;
    d.node = node;
    this.emit('demonMove', `天魔移动至【${this.nodeName(node)}】`, { node, from });
    const t = st.tiles[node];
    if (!t || t.owner === null || t.level < 1) return;
    const owner = st.players[t.owner];
    if (owner.divines.includes('subdue')) { this.emit('block', `${this.pn(t.owner)} 镇妖：天魔不敢作乱`, { player: t.owner }); return; }
    if (isWardActive(st, t.owner)) { this.emit('block', `${this.pn(t.owner)} 受白泽护道庇佑`, { player: t.owner }); return; }
    if (goldbodyReady(st, t.owner)) {
      owner.goldbodyReadyRound = st.round + this.cfg.rules.goldbodyCooldownRounds;
      this.emit('block', `${this.pn(t.owner)} 金身护住洞府`, { player: t.owner });
      return;
    }
    this.downgrade(node, '遭天魔破坏');
  }

  private *eruption(): Flow {
    const st = this.state;
    // Interpretation (NOTES.md): "有主且 Lv≤1" + "降 1 级" → only Lv1 buildings can actually drop.
    const cands = this.board.landsInRegion('fire').filter((id) => st.tiles[id].owner !== null && st.tiles[id].level === 1);
    if (cands.length === 0) {
      this.emit('eruption', '地火喷发，所幸无洞府受损', {});
      return;
    }
    const node = cands[this.randInt(cands.length)];
    const owner = st.tiles[node].owner!;
    this.emit('eruption', `地火喷发！波及【${this.nodeName(node)}】`, { node, player: owner });
    if (isWardActive(st, owner)) { this.emit('block', `${this.pn(owner)} 受白泽护道庇佑`, { player: owner }); return; }
    if (goldbodyReady(st, owner)) {
      st.players[owner].goldbodyReadyRound = st.round + this.cfg.rules.goldbodyCooldownRounds;
      this.emit('block', `${this.pn(owner)} 金身抵挡地火`, { player: owner });
      return;
    }
    if (yield* this.guard(owner, 'eruption', null, node)) return;
    this.downgrade(node, '被地火焚毁');
  }

  private *manifest(): Flow {
    const st = this.state;
    st.manifested = true;
    this.emit('manifest', '白泽现世！灵雨普降，本轮所有租金减半。', {});
    if (st.demon) {
      this.emit('demonGone', '白泽驱散了天魔（无人获得斩妖修为）', { node: st.demon.node });
      st.demon = null;
    }
    const revealed = st.heavenDeck.splice(0, st.players.length);
    const order = st.players.map((p) => p.seat).sort((a, b) =>
      this.cult(a) - this.cult(b) || st.players[a].stones - st.players[b].stones || a - b);
    for (const seat of order) {
      if (revealed.length === 0) break;
      const pick = yield* this.ask({
        player: seat, kind: 'heavenPick', title: '白泽天赐', desc: '按修为从低到高依次选择 1 张',
        options: revealed.map((id) => {
          const h = this.data.blessings.heaven.find((x) => x.id === id)!;
          return { id, label: h.name, value: id, hint: h.desc };
        }),
        forceAsk: true,
      });
      revealed.splice(revealed.indexOf(pick), 1);
      this.emit('heaven', `${this.pn(seat)} 获得天赐【${this.data.blessings.heaven.find((x) => x.id === pick)!.name}】`, { player: seat });
      yield* this.applyHeaven(seat, pick);
    }
  }

  private *applyHeaven(seat: number, id: string): Flow {
    const st = this.state;
    const p = st.players[seat];
    switch (id) {
      case 'chart':
        for (let k = 0; k < this.cfg.rules.chartDraw; k++) this.drawSpell(seat);
        this.addCult(seat, this.cfg.rules.chartCultivation, '白泽图');
        return;
      case 'ward':
        p.wardUntilRound = st.round + this.cfg.rules.wardRounds - 1;
        this.emit('status', `${this.pn(seat)} 获白泽护道（至第 ${p.wardUntilRound} 轮）`, { player: seat });
        return;
      case 'vein':
        this.gainStones(seat, this.cfg.rules.veinStones, '灵脉馈赠');
        return;
      case 'dawn':
        this.gainPills(seat, this.cfg.rules.dawnPills, '丹霞');
        return;
      case 'auspice': {
        const done: NodeId[] = [];
        for (let k = 0; k < this.cfg.rules.auspiceLands; k++) {
          const cands = this.board.lands.filter((n) => {
            const t = st.tiles[n];
            return t.owner === seat && t.level < 4 && !t.special && !done.includes(n) && (t.level + 1 < 4 || p.pills >= this.cfg.lv4PillCost);
          });
          if (cands.length === 0) break;
          const node = yield* this.ask({
            player: seat, kind: 'node', title: '天降祥瑞', desc: `选择第 ${k + 1} 块洞府免费升 1 级`,
            options: cands.map((n) => ({ id: n, label: this.nodeLabel(n), value: n, node: n })), ctx: { purpose: 'auspice' },
          });
          done.push(node);
          this.upgrade(seat, node, true);
        }
        return;
      }
      case 'guide': {
        const node = yield* this.ask({
          player: seat, kind: 'node', title: '指路', desc: '立即移动到任意节点并结算',
          options: this.board.allNodeIds().filter((n) => n !== p.pos).map((n) => ({ id: n, label: this.nodeLabel(n), value: n, node: n })),
          ctx: { purpose: 'guide' },
        });
        this.teleport(seat, node, '白泽指路');
        yield* this.settle(seat, node);
        return;
      }
    }
  }

  // ---------------------------------------------------- cultivation / end --

  addCult(seat: number, n: number, why: string): void {
    const p = this.state.players[seat];
    p.cultBase = Math.max(0, p.cultBase + n);
    this.emit('cult', `${this.pn(seat)} ${why}，修为 ${n >= 0 ? '+' : ''}${n}（现 ${this.cult(seat)}）`, { player: seat, amount: n });
    this.afterCultChange();
  }

  private updateVeinLords(): void {
    const next = computeVeinLords(this.state, this.board, this.data);
    for (const r of REGION_IDS) {
      const before = this.state.veinLords[r];
      if (next[r] === before) continue;
      const rn = this.data.board.regions[r].name;
      if (before !== null) this.emit('veinLord', `${this.pn(before)} 失去${rn}灵脉之主（修为 −${this.cfg.veinLordCultivation}）`, { player: before });
      if (next[r] !== null) this.emit('veinLord', `${this.pn(next[r]!)} 成为${rn}灵脉之主（修为 +${this.cfg.veinLordCultivation}）`, { player: next[r]! });
    }
    this.state.veinLords = next;
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

  /**
   * Run an isolated movement for tests: puts `seat` at `from`, walks `steps`
   * (answering through the normal decision interface) and settles. Only for
   * unit tests — bypasses dice and turn structure.
   */
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

  /** Exposed for tests. */
  testPayRent(seat: number, node: NodeId): Flow { return this.payRent(seat, node); }
  testAltar(seat: number): Flow { return this.altar(seat, 0); }
  testTasks(): void { this.checkTasks(); }
  testUpdateVeinLords(): void { this.updateVeinLords(); }
  testUpdateBounty(): void { this.updateBounty(); }
  testDuel(attacker: number, defender: number): Flow { return this.duel(attacker, defender); }
  testUseSkill(seat: number): Flow<'moved' | 'ok' | 'cancel'> { return this.useSkill(seat); }
  testSettle(seat: number, node: NodeId): Flow { this.state.current = seat; return this.settle(seat, node); }
  testActionPhase(seat: number): Flow { this.state.current = seat; return this.actionPhase(seat); }
  testRoundStart(): Flow { return this.roundStart(); }
  testSpiritsWander(): void { this.spiritsWander(); }
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
