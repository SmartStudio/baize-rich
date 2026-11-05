// AI controller (GDD §13). Normal difficulty follows the table in the GDD;
// easy / hard are parameter tweaks plus a one-step look-ahead for hard.
// Personalities 稳健 / 激进 / 守财 shift thresholds and preferences.
import { ALTAR, REGION_IDS } from '../core/board';
import type { ActionAct, Controller, PendingChoice, PendingChoiceOf, PreRollAct, Target } from '../core/choices';
import type { Game } from '../core/engine';
import { Rng } from '../core/rng';
import {
  breakthroughCost, breakthroughsAvailable, buyoutPrice, buyPrice, canBreakthrough, countOwned, cultivation,
  isWardActive, nominalRent, rentFor, spiritOf, uniqueLeader, upgradeCost,
} from '../core/rules';
import type { MiniGameTier, NodeId, RegionId, SpecialKind, SpiritKind } from '../core/types';
import { DICE_DIST, predictWalk, type Prediction, type WalkPolicy } from './predict';

const mainLine: WalkPolicy['fork'] = (_node, _remaining, options) => options[0];
const passive: WalkPolicy = { fork: mainLine, altar: () => 'stop', canPayToll: false };

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'steady' | 'aggressive' | 'miser';

export const PERSONALITY_LABEL: Record<Personality, string> = { steady: '稳健', aggressive: '激进', miser: '守财' };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '简单', normal: '普通', hard: '困难' };

interface Persona {
  /** Stones that must remain after buying land (§13: 300 / 激进 150 / 守财 600). */
  buyReserve: number;
  /** Stones that must remain after an upgrade (§13: 升级费 + 400). */
  upgradeReserve: number;
  /** Multiplier on the value of attacking others. */
  attack: number;
  /** Use 避劫符 if rent ≥ this fraction of current stones. */
  evadeRatio: number;
  /** Extra preference weights for blessings. */
  likes: Record<string, number>;
}

const PERSONAS: Record<Personality, Persona> = {
  steady: { buyReserve: 300, upgradeReserve: 400, attack: 1, evadeRatio: 0.15, likes: {} },
  aggressive: { buyReserve: 150, upgradeReserve: 250, attack: 1.5, evadeRatio: 0.25, likes: { chart: 2, guide: 2, subdue: 3, swift: 2 } },
  miser: { buyReserve: 600, upgradeReserve: 600, attack: 0.6, evadeRatio: 0.1, likes: { midas: 3, vein: 4, gather: 2, dawn: 2 } },
};

/** Rough stone-equivalents used when comparing heterogeneous gains. */
const VALUE = { pill: 50, cult: 400, card: 80, bound: 150 };

/** §18.2 Stone-equivalent of catching each spirit (fox: rent ×1.5 and cheap land; heart: −pills and rent ×1.5). */
const SPIRIT_VALUE: Record<SpiritKind, number> = { fox: 250, heart: -300 };

/** §18.5 炼丹房: how often the AI hits each tier (it plays the timing game by chance). */
const ALCHEMY_ODDS: Record<Difficulty, Record<MiniGameTier, number>> = {
  easy: { perfect: 0.15, ok: 0.5, fail: 0.35 },
  normal: { perfect: 0.3, ok: 0.5, fail: 0.2 },
  hard: { perfect: 0.45, ok: 0.45, fail: 0.1 },
};

/** §18.3 What each 百宝阁 item is worth to hold, before persona scaling. */
const SHOP_VALUE: Record<string, number> = {
  dice: 160, barrier: 110, blast: 170, turnback: 90, goldlight: 120, evade: 150, swiftstep: 90, discount: 80,
};
const ATTACK_ITEMS = new Set(['barrier', 'blast']);

/** Rough chance an opponent stops on a given cell each round, for long-run building values. */
const VISITS_PER_ROUND = 0.25;

/** P(attacker wins) when the attacker's total is offset by `off` over the defender's (ties go to the defender). */
export function duelWinChance(off: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (a + off > d) n++;
  return n / 36;
}

/** Minimum duel EV (stones) worth a challenge, by difficulty. */
const DUEL_BAR: Record<Difficulty, number> = { easy: 150, normal: 30, hard: 0 };

export interface AIOptions {
  difficulty?: Difficulty;
  personality?: Personality;
  seed?: number;
}

export class AIController implements Controller {
  readonly difficulty: Difficulty;
  readonly personality: Personality;
  private persona: Persona;
  private rng: Rng;

  constructor(private game: Game, readonly seat: number, opts: AIOptions = {}) {
    this.difficulty = opts.difficulty ?? 'normal';
    this.personality = opts.personality ?? 'steady';
    this.persona = PERSONAS[this.personality];
    this.rng = new Rng((opts.seed ?? 1) * 7919 + seat);
  }

  // ----------------------------------------------------------- helpers ---

  private get st() { return this.game.state; }
  private get me() { return this.game.state.players[this.seat]; }
  private get board() { return this.game.board; }
  private get data() { return this.game.data; }
  private cult(seat = this.seat) { return cultivation(this.st, this.data, seat); }

  private wantsAltar(): boolean {
    return canBreakthrough(this.st, this.data, this.seat);
  }

  /** 灵丹 to keep for the next breakthrough. */
  private pillReserve(): number {
    if (breakthroughsAvailable(this.me) > 0 && this.me.divines.length < this.data.config.maxDivine) {
      return breakthroughCost(this.st, this.data, this.seat);
    }
    return 0;
  }

  private sparePills(): number {
    return this.me.pills - this.pillReserve();
  }

  private policy(): WalkPolicy {
    const want = this.wantsAltar();
    return {
      fork: (node, _remaining, options) => this.forkRule(node, options, 1),
      altar: () => 'stop',
      canPayToll: this.me.pills >= this.data.config.altarToll && !want,
    };
  }

  /** Value (in stones) of ending a move on `node` for this AI. */
  landingScore(node: NodeId, passStart = 0): number {
    const b = this.board;
    const st = this.st;
    const p = this.me;
    const n = b.node(node);
    let s = passStart * this.data.config.salaryPass;
    switch (n.type) {
      case 'land': {
        const t = st.tiles[node];
        if (t.owner === null) {
          const price = buyPrice(this.st, this.data, p, n.price!, false);
          if (p.stones - price >= this.persona.buyReserve) s += 0.3 * price + 100 * countOwned(st, b, this.seat, n.region) + this.streetPull(node);
        } else if (t.owner === this.seat) s += 10;
        else {
          const r = rentFor(st, b, this.data, node, this.seat).amount;
          s -= r;
          if (r >= p.stones) s -= 400;
          if (t.trap) s -= this.data.config.rules.trapStones + VALUE.bound;
        }
        break;
      }
      case 'start': s += this.data.config.salaryLand; break;
      case 'trial': s += 60; break;
      case 'spring': s += 60; break;
      case 'furnace': s += 2 * VALUE.pill; break;
      case 'market': s += p.hand.length < this.data.config.handLimit && p.stones > 500 ? 40 : 0; break;
      case 'cliff': s -= isWardActive(st, this.seat) ? 0 : 250; break;
      case 'array': s += 80; break;
      case 'shrine': s += VALUE.pill + (p.seal ? 0 : 80); break;
      case 'altar': s += this.wantsAltar() ? 500 : 40; break;
      case 'gate': s += 0; break;
      case 'shop': s += this.shopWorth(); break;
      case 'minigame': s += n.game === 'dice' ? 20 : this.alchemyPills() * VALUE.pill; break;
      case 'hospital': break;
    }
    return s;
  }

  /**
   * §18.1 Extra value of buying `node` for the street it sits on: 0 if a rival already holds part of it,
   * otherwise growing with each own land there, and a big bonus when it completes the street.
   */
  streetPull(node: NodeId): number {
    const lands = this.board.streetOf(node);
    if (lands.length === 0) return 0;
    let mine = 0;
    for (const id of lands) {
      const o = this.st.tiles[id].owner;
      if (o === this.seat) mine++;
      else if (o !== null && id !== node) return 0;
    }
    return mine + 1 === lands.length ? 300 : 60 * mine;
  }

  /** Landing plus what happens on the way: spirits met (§18.2) and duels. */
  private moveValue(pr: Prediction): number {
    return this.landingScore(pr.node, pr.passStart) + this.spiritValue(pr.path) + this.meetValue(pr.path);
  }

  /**
   * §18.2 Value of the spirits met along `path`: catching the fox is good, catching the heart is bad,
   * and while holding the heart, walking into another player hands it over.
   */
  spiritValue(path: NodeId[]): number {
    const st = this.st;
    let held = spiritOf(st, this.seat);
    let v = 0;
    for (const node of path.slice(1)) {
      if (held === 'heart' && st.players.some((o) => o.seat !== this.seat && o.pos === node)) {
        v -= SPIRIT_VALUE.heart;
        held = null;
      }
      for (const sp of st.spirits) {
        if (sp.node !== node || sp.kind === held) continue;
        if (held) v -= SPIRIT_VALUE[held];
        v += SPIRIT_VALUE[sp.kind];
        held = sp.kind;
      }
    }
    return v;
  }

  /** Expected 灵丹 from one visit to a 炼丹房. */
  private alchemyPills(): number {
    const odds = ALCHEMY_ODDS[this.difficulty];
    const r = this.data.config.rules.miniGameRewards.alchemy;
    return odds.perfect * r.perfect + odds.ok * r.ok + odds.fail * r.fail;
  }

  /** What stopping at a 百宝阁 is worth now. */
  private shopWorth(): number {
    return this.shopPick(false) ? 50 : 0;
  }

  private scoreMove(steps: number, dir: 1 | -1, from?: NodeId): number {
    const n = this.me.dazed ? Math.max(1, Math.floor(steps / 2)) : steps;
    return this.moveValue(predictWalk(this.board, this.st, this.seat, n, dir, this.policy(), from));
  }

  /** Best duel EV among players met on a predicted path (0 if none worth it or already dueled). */
  private meetValue(path: NodeId[]): number {
    if (this.difficulty === 'easy' || this.st.turn.duelDone) return 0;
    let best = 0;
    for (const o of this.st.players) {
      if (o.seat === this.seat || !path.slice(1).includes(o.pos) || !this.game.duelEligible(o.seat)) continue;
      best = Math.max(best, this.challengeValue(o.seat));
    }
    return best;
  }

  // ------------------------------------------------------------- duels ---

  private duelBonus(seat: number, role: 'atk' | 'def'): number {
    const r = this.data.config.rules;
    const h = this.st.players[seat].hero;
    return role === 'atk' ? (h === 'sword' ? r.swordDuelAttack : 0) : (h === 'body' ? r.bodyDuelDefense : 0);
  }

  /** What `seat` gains by beating `other` (stones + bounty). */
  private duelPrize(other: number): number {
    return this.game.duelStake(other) + (this.st.bountySeat === other ? this.data.config.rules.bountyDuelCultivation * VALUE.cult : 0);
  }

  /** Guess how many pills a player will bet (they bet when the stakes are worth more than the pills). */
  private guessBet(seat: number, stakeSum: number): number {
    const max = Math.min(this.data.config.rules.duelMaxPills, this.st.players[seat].pills);
    return stakeSum >= 250 ? max : stakeSum >= 120 ? Math.min(1, max) : 0;
  }

  /** Expected value (stones) for this AI of a duel, given both bets. */
  private duelEV(attacker: number, defender: number, betA: number, betD: number): number {
    const off = this.duelBonus(attacker, 'atk') + betA - this.duelBonus(defender, 'def') - betD;
    const pAtk = duelWinChance(off);
    const meAtk = attacker === this.seat;
    const opp = meAtk ? defender : attacker;
    const pWin = meAtk ? pAtk : 1 - pAtk;
    const myBet = meAtk ? betA : betD;
    return pWin * this.duelPrize(opp) * this.persona.attack - (1 - pWin) * this.duelPrize(this.seat) - myBet * VALUE.pill;
  }

  private maxBet(): number {
    return Math.max(0, Math.min(this.data.config.rules.duelMaxPills, this.sparePills()));
  }

  /** EV of challenging `target` now, with the best own bet against the guessed reply. */
  challengeValue(target: number): number {
    const stakeSum = this.game.duelStake(target) + this.game.duelStake(this.seat);
    const theirs = this.guessBet(target, stakeSum);
    let best = -Infinity;
    for (let b = 0; b <= this.maxBet(); b++) best = Math.max(best, this.duelEV(this.seat, target, b, theirs));
    const leader = this.leaderOpponent();
    return best + (target === leader ? 30 : 0);
  }

  private duelChoice(c: PendingChoiceOf<'duel'>): string {
    let bestId = 'none';
    let bestV = DUEL_BAR[this.difficulty];
    for (const o of c.options) {
      if (o.value === null) continue;
      const v = this.challengeValue(o.value);
      if (v > bestV) { bestV = v; bestId = o.id; }
    }
    return bestId;
  }

  private duelBet(c: PendingChoiceOf<'duelBet'>): string | undefined {
    if (this.difficulty === 'easy') return 'b0';
    const atk = c.ctx.attacker!;
    const def = c.ctx.defender!;
    const meAtk = atk === this.seat;
    const stakeSum = this.game.duelStake(atk) + this.game.duelStake(def);
    const cap = this.maxBet();
    const opts = c.options.filter((o) => o.value <= cap);
    if (opts.length === 0) return 'b0';
    if (meAtk) {
      const theirs = this.guessBet(def, stakeSum);
      return this.bestBy(opts, (o) => this.duelEV(atk, def, o.value, theirs));
    }
    const theirs = c.ctx.bet ?? 0;
    return this.bestBy(opts, (o) => this.duelEV(atk, def, theirs, o.value));
  }

  // ------------------------------------------------------------ skills ---

  /** Best target for the hero's active skill and its estimated gain over not using it. */
  private bestSkill(): { id: string; value: number } | null {
    const g = this.game;
    const st = this.st;
    const sk = g.heroOf(this.seat).skill;
    const targets = g.skillTargets(this.seat);
    let best: { id: string; value: number } | null = null;
    const consider = (id: string, value: number) => { if (!best || value > best.value) best = { id, value }; };
    switch (sk.id) {
      case 'sworddash': {
        const base = this.expectedRoll(1);
        for (const s of targets as number[]) consider(`p${s}`, this.challengeValue(s) + this.landingScore(st.players[s].pos) - base);
        break;
      }
      case 'swap': {
        const base = this.expectedRoll(1);
        for (const s of targets as number[]) consider(`p${s}`, this.expectedRoll(1, [0], st.players[s].pos) - base);
        break;
      }
      case 'daze': {
        const leader = this.leaderOpponent();
        for (const s of targets as number[]) consider(`p${s}`, 40 + (s === leader ? 40 : 0) + this.cult(s) * 5);
        break;
      }
      case 'roadblock':
        for (const n of targets as NodeId[]) consider(`node:${n}`, this.roadblockValue(n));
        break;
    }
    return best;
  }

  /** Expected gain of a 镇山 mountain on `node`: the next opponent to move is stopped there. */
  private roadblockValue(node: NodeId): number {
    const st = this.st;
    const n = st.players.length;
    for (let k = 1; k < n; k++) {
      const seat = (this.seat + k) % n;
      const o = st.players[seat];
      if (o.jailed || o.bound) continue;
      let pPass = 0;
      for (const { total, p } of DICE_DIST) {
        const pr = predictWalk(this.board, st, seat, total, 1, passive);
        if (pr.path.slice(1).includes(node)) pPass += p;
      }
      const t = st.tiles[node];
      let v = 30;
      if (t && t.owner === this.seat) {
        v += rentFor(st, this.board, this.data, node, seat).amount;
        if (t.trap) v += this.data.config.rules.trapStones + VALUE.bound;
      } else if (t && t.owner !== null) v += rentFor(st, this.board, this.data, node, seat).amount * 0.3;
      return pPass * v;
    }
    return 0;
  }

  /** Chance-weighted value of a 禁制 on `node` over the opponents' next rolls. */
  private trapValue(node: NodeId): number {
    const st = this.st;
    let e = 0;
    for (const o of st.players) {
      if (o.seat === this.seat || o.jailed) continue;
      for (const { total, p } of DICE_DIST) {
        const pr = predictWalk(this.board, st, o.seat, total, 1, passive);
        if (pr.node === node) e += p;
      }
    }
    return e * (this.data.config.rules.trapStones + VALUE.bound);
  }

  /** Expected landing value of a fresh 2d6 roll plus an optional bonus. */
  private expectedRoll(dir: 1 | -1, bonus: number[] = [0], from?: NodeId): number {
    let e = 0;
    for (const { total, p } of DICE_DIST) {
      let best = -Infinity;
      for (const b of bonus) best = Math.max(best, this.scoreMove(Math.max(1, total + b), dir, from));
      e += p * best;
    }
    return e;
  }

  /** Expected rent the AI would pay on the next roll (for 不动明王). */
  private expectedRentLoss(): number {
    let e = 0;
    for (const { total, p } of DICE_DIST) {
      const pr = predictWalk(this.board, this.st, this.seat, total, 1, this.policy());
      const t = this.st.tiles[pr.node];
      if (t && t.owner !== null && t.owner !== this.seat) e += p * rentFor(this.st, this.board, this.data, pr.node, this.seat).amount;
    }
    return e;
  }

  // GDD §13 fork rule (normal): breakthrough ready → toward the altar; heavy rent in the next 6
  // main-line cells → toward the altar; else stay on the main line.
  private forkRule(node: NodeId, options: NodeId[], dir: 1 | -1): NodeId {
    const detour = this.board.altarward(options);
    if (this.wantsAltar()) return detour;
    let cur = node;
    for (let k = 0; k < 6; k++) {
      cur = this.board.mainStep(cur, dir);
      const t = this.st.tiles[cur];
      if (t && t.owner !== null && t.owner !== this.seat) {
        const r = rentFor(this.st, this.board, this.data, cur, this.seat).amount;
        if (r >= this.me.stones * 0.2) return detour;
      }
    }
    return options[0];
  }

  private leaderOpponent(): number | null {
    let best = -1;
    let seat: number | null = null;
    for (const o of this.st.players) {
      if (o.seat === this.seat) continue;
      const c = this.cult(o.seat);
      if (c > best) { best = c; seat = o.seat; }
    }
    return seat;
  }

  // ------------------------------------------------------------ decide ---

  decide(c: PendingChoice): string {
    const id = this.choose(c);
    if (id && c.options.some((o) => o.id === id)) return id;
    return (c.defaultId && c.options.some((o) => o.id === c.defaultId)) ? c.defaultId : c.options[0].id;
  }

  private choose(c: PendingChoice): string | undefined {
    switch (c.kind) {
      case 'preRoll': return this.preRoll(c);
      case 'action': return this.action(c);
      case 'rollValue': return this.bestBy(c.options, (o) => this.scoreMove(o.value, 1));
      case 'adjust': {
        const dir: 1 | -1 = this.st.turn.reverse ? -1 : 1;
        const maze = this.me.mazeAvailable && this.board.node(this.me.pos).outer && !this.st.turn.reverse;
        return this.bestBy(c.options, (o) => Math.max(this.scoreMove(o.value, dir), maze ? this.scoreMove(o.value, -1) : -Infinity));
      }
      case 'direction': {
        const steps = c.ctx.remaining ?? 7;
        return this.bestBy(c.options, (o) => this.scoreMove(steps, o.value));
      }
      case 'fork': {
        const remaining = c.ctx.remaining ?? 1;
        const node = c.ctx.node!;
        const options = c.options.map((o) => o.value);
        if (this.difficulty === 'hard') {
          // one-step look-ahead: compare the landing value of the main line against each detour
          const stay = this.moveValue(predictWalk(this.board, this.st, this.seat, remaining, 1, { ...this.policy(), fork: mainLine }, node));
          const altarward = this.board.altarward(options);
          let best = options[0];
          let bestScore = stay;
          for (const alt of options.slice(1)) {
            const pr = predictWalk(this.board, this.st, this.seat, remaining, 1, { ...this.policy(), fork: (n, _r, o) => (n === node ? alt : o[0]) }, node);
            const score = this.moveValue(pr) + (this.wantsAltar() && alt === altarward ? 200 : 0);
            if (score > bestScore) { best = alt; bestScore = score; }
          }
          return best;
        }
        return this.forkRule(node, options, this.st.turn.reverse ? -1 : 1);
      }
      case 'altarPass': {
        if (this.wantsAltar()) return 'stop';
        const remaining = c.ctx.remaining ?? 0;
        if (remaining >= 3 && this.me.pills >= 3) {
          return this.bestBy(c.options.filter((o) => o.value !== 'stop'), (o) => this.exitScore(o.value as NodeId, remaining));
        }
        return 'stop';
      }
      case 'exitRoad': {
        const remaining = c.ctx.remaining ?? 7;
        return this.bestBy(c.options, (o) => this.exitScore(o.value, remaining + 0));
      }
      case 'buy': return this.buy(c);
      case 'rentReact': {
        const rent = c.ctx.rent ?? 0;
        const use = rent >= this.me.stones || (rent >= 150 && rent >= this.me.stones * this.persona.evadeRatio);
        return use ? 'evade' : 'pay';
      }
      case 'guardReact': return this.guardReact(c);
      case 'altar': {
        if (c.options.some((o) => o.value === 'break')) return 'break';
        return this.me.pills < 2 ? 'calm' : 'leave';
      }
      case 'divinePick': return this.bestBy(c.options, (o) => this.blessingWeight(o.value, 'divine'));
      case 'heavenPick': return this.bestBy(c.options, (o) => this.blessingWeight(o.value, 'heaven'));
      case 'eventPick': return this.bestBy(c.options, (o) => {
        const ev = this.game.eventById.get(o.value);
        if (!ev) return 50; // task
        return ev.good ? 100 + (ev.effect.stones ?? 0) / 10 : -50 + (ev.effect.pills ? 10 : 0);
      });
      case 'auction': return this.me.stones - 300 >= Math.min(300, this.persona.buyReserve) ? 'yes' : 'no';
      case 'market': {
        const reserve = this.persona.buyReserve;
        const roomy = this.me.hand.length <= 3;
        const want = this.me.stones >= reserve + 1200 && roomy ? 2 : this.me.stones >= reserve + 400 ? 1 : 0;
        const opt = c.options.find((o) => o.value === want) ?? c.options.find((o) => o.value === 1) ?? c.options[c.options.length - 1];
        return this.me.stones >= reserve + 400 ? opt.id : 'no';
      }
      case 'node': return this.nodeChoice(c);
      case 'target': return this.targetChoice(c);
      case 'region': return this.bestBy(c.options.filter((o) => o.value !== 'cancel'), (o) => this.regionRent(o.value as RegionId));
      case 'duel': return this.duelChoice(c);
      case 'duelBet': return this.duelBet(c);
      case 'shop': return this.shopPick(true) ?? 'leave';
      case 'miniGame': {
        if (c.options.length === 1) return c.options[0].id; // 灵骰台: the engine already rolled
        const odds = ALCHEMY_ODDS[this.difficulty];
        const x = this.rng.float();
        return x < odds.perfect ? 'perfect' : x < odds.perfect + odds.ok ? 'ok' : 'fail';
      }
      case 'diceBet': return this.diceBet(c);
      case 'portal': {
        if (this.difficulty === 'easy') return 'stay';
        let best = 'stay';
        let bv = this.expectedRoll(1) + 30;
        for (const o of c.options) {
          if (o.value === null) continue;
          const v = this.expectedRoll(1, [0], o.value);
          if (v > bv) { bv = v; best = o.id; }
        }
        return best;
      }
      case 'cliff': {
        if (c.options.some((o) => o.id === 'calm') && this.sparePills() >= 1) return 'calm';
        const payBar = this.data.config.cliffFee + this.persona.buyReserve + (this.personality === 'aggressive' ? 0 : 200);
        if (c.options.some((o) => o.id === 'pay') && this.me.stones >= payBar) return 'pay';
        return 'roll';
      }
    }
  }

  private bestBy<T extends { id: string }>(opts: T[], score: (o: T) => number): string | undefined {
    let best: T | undefined;
    let bs = -Infinity;
    for (const o of opts) {
      const s = score(o);
      if (s > bs) { bs = s; best = o; }
    }
    return best?.id;
  }

  private exitScore(exit: NodeId, remaining: number): number {
    return this.moveValue(predictWalk(this.board, this.st, this.seat, remaining, 1, { ...this.policy(), exit, fork: mainLine }, ALTAR));
  }

  private regionRent(region: RegionId): number {
    let s = 0;
    for (const id of this.board.landsInRegion(region)) {
      const t = this.st.tiles[id];
      if (t.owner === this.seat) s += nominalRent(this.data, this.board.node(id).price!, t.level);
    }
    return s;
  }

  // ---------------------------------------------------------- pre-roll ---

  private preRoll(c: PendingChoiceOf<'preRoll'>): string {
    const has = (pred: (v: PreRollAct) => boolean) => c.options.find((o) => pred(o.value));
    if (this.difficulty === 'easy') return 'roll';
    const p = this.me;
    const spare = this.sparePills();
    const base = this.expectedRoll(1);

    const skill = has((v) => v.t === 'skill');
    if (skill) {
      const sk = this.bestSkill();
      if (sk && sk.value > (this.difficulty === 'hard' ? 40 : 80)) return skill.id;
    }
    const shrink = has((v) => v.t === 'shrink');
    if (shrink) {
      const region = this.board.node(p.pos).region!;
      const best = Math.max(...this.board.regionNodes(region).filter((n) => n !== p.pos).map((n) => this.landingScore(n)));
      if (best > base + 150) return shrink.id;
    }
    const ult = has((v) => v.t === 'ult');
    if (ult && spare >= this.data.config.ult.pillCost) {
      if (p.hero === 'body' && this.expectedRentLoss() * this.data.config.rules.immovableTurns > 300) return ult.id;
      if (p.hero === 'sword') {
        const range = Array.from({ length: 7 }, (_, i) => i - 3);
        if (this.expectedRoll(1, range) - base > 300) return ult.id;
      }
    }
    const burrow = has((v) => v.t === 'cast' && v.card === 'burrow');
    if (burrow && this.wantsAltar() && this.me.pills >= this.pillReserve() + 1 && this.board.node(p.pos).type !== 'gate') return burrow.id;
    const treasure = has((v) => v.t === 'cast' && v.card === 'treasure');
    if (treasure && spare >= 2 && Math.max(...REGION_IDS.map((r) => this.regionRent(r))) * this.persona.attack >= 200) return treasure.id;
    const swift = has((v) => v.t === 'cast' && v.card === 'swiftstep');
    if (swift && spare >= 1 && this.expectedRoll(1, [1, 2, 3]) - base > 120) return swift.id;
    const dice = has((v) => v.t === 'cast' && v.card === 'dice');
    if (dice) {
      const r = this.data.config.rules;
      let best = -Infinity;
      for (let v = r.diceCardMin; v <= r.diceCardMax; v++) best = Math.max(best, this.scoreMove(v, 1));
      if (best - base > (this.difficulty === 'hard' ? 80 : 120)) return dice.id;
    }
    const turnback = has((v) => v.t === 'cast' && v.card === 'turnback');
    const back = turnback ?? has((v) => v.t === 'cast' && v.card === 'reverse');
    if (back && (turnback || spare >= 1)) {
      const gain = this.expectedRoll(-1) - base;
      if (gain > (turnback ? 100 : 150)) return back.id;
    }
    return 'roll';
  }

  // ------------------------------------------------------------ action ---

  private action(c: PendingChoiceOf<'action'>): string {
    const p = this.me;
    const st = this.st;
    const find = (pred: (v: ActionAct) => boolean) => c.options.find((o) => pred(o.value));
    const spare = this.sparePills();
    const attacks = this.difficulty !== 'easy';

    // 1) 五雷符: demon kill or bounty / heavy buildings
    const thunder = find((v) => v.t === 'cast' && v.card === 'thunder');
    if (thunder && attacks && spare >= 2) {
      const tg = this.bestThunderTarget('thunder');
      if (tg && tg.value * this.persona.attack >= 250) return thunder.id;
    }
    // 2) ults with value > 300
    const ult = find((v) => v.t === 'ult');
    if (ult && spare >= this.data.config.ult.pillCost) {
      if (p.hero === 'magic' && attacks) {
        const tg = this.bestThunderTarget('fivethunder');
        if (tg && tg.value * this.persona.attack > 300) return ult.id;
      }
      if (p.hero === 'alch') {
        const tg = this.bestBuyout();
        if (tg && tg.value > 300) return ult.id;
      }
      if (p.hero === 'body' && this.expectedRentLoss() * this.data.config.rules.immovableTurns > 300 && st.turn.doubles > 0) return ult.id;
    }
    // 3) 点金符 is almost always worth a pill
    const gold = find((v) => v.t === 'cast' && v.card === 'goldtouch');
    if (gold && spare >= 1) return gold.id;
    // 4) §18.4 功能建筑 on the land underfoot, when it beats a plain building there
    const special = this.bestSpecial(c.options.flatMap((o) => (o.value.t === 'upgrade' && o.value.special ? [o.value.special] : [])));
    if (special) return `upgrade:${p.pos}:${special}`;
    // 5) upgrades (with 折扣符 first when worthwhile)
    const ups = c.options.filter((o) => o.value.t === 'upgrade' && !o.value.special);
    const bestUp = this.bestUpgrade(ups.map((o) => (o.value as { node: NodeId }).node));
    if (bestUp) {
      const disc = find((v) => v.t === 'cast' && v.card === 'discount');
      if (disc && spare >= 1 && bestUp.cost >= 300 && !st.turn.discount) return disc.id;
      return `upgrade:${bestUp.node}`;
    }
    // 6) 定身 / 夺灵 on the leader
    if (attacks) {
      const leader = this.leaderOpponent();
      const bind = find((v) => v.t === 'cast' && v.card === 'bind');
      if (bind && spare >= 2 && leader !== null && this.cult(leader) >= 5 && this.cult(leader) >= this.cult()) return bind.id;
      const drain = find((v) => v.t === 'cast' && v.card === 'drain');
      if (drain && spare >= 1 && leader !== null && st.players[leader].pills >= 3) return drain.id;
    }
    // 7) active skill (free, on cooldown)
    const skill = find((v) => v.t === 'skill');
    if (skill && (this.difficulty !== 'easy' || this.rng.float() < 0.5)) {
      const sk = this.bestSkill();
      if (sk && sk.value > 20) return skill.id;
    }
    // 8) §18.3 路障符 / 爆炎阵 (free once bought)
    if (attacks) {
      const barrier = find((v) => v.t === 'cast' && v.card === 'barrier');
      if (barrier && (this.bestBarrier()?.value ?? 0) * this.persona.attack >= 12) return barrier.id;
      const blast = find((v) => v.t === 'cast' && v.card === 'blast');
      if (blast && (this.bestBlast()?.value ?? 0) * this.persona.attack >= 25) return blast.id;
    }
    // 9) 禁制 on the tile opponents are most likely to stop on
    const traps = c.options.filter((o) => o.value.t === 'trap');
    if (traps.length > 0 && attacks && spare >= this.data.config.rules.trapPillCost) {
      let best = traps[0];
      let bv = -Infinity;
      for (const o of traps) {
        const v = this.trapValue((o.value as { node: NodeId }).node);
        if (v > bv) { bv = v; best = o; }
      }
      if (bv * this.persona.attack >= 20 || spare >= 3) return best.id;
    }
    return 'end';
  }

  /**
   * §18.4 Which 功能建筑 to build on the land underfoot, or null to keep it upgradable.
   * Values are summed over the remaining rounds; a plain building keeps the Lv2–Lv4 修为 milestones open.
   */
  private bestSpecial(kinds: SpecialKind[]): SpecialKind | null {
    if (kinds.length === 0 || (this.difficulty === 'easy' && this.rng.float() < 0.5)) return null;
    const st = this.st;
    const node = this.me.pos;
    const r = this.data.config.rules;
    const price = this.board.node(node).price!;
    const cost = upgradeCost(this.data, price, 1, st.turn.discount).stones;
    if (this.me.stones < cost + this.persona.upgradeReserve) return null;
    const rounds = Math.min(8, this.data.config.rounds - st.round + 1);
    const rent0 = nominalRent(this.data, price, 0);
    const mine = this.board.lands.filter((id) => st.tiles[id].owner === this.seat && st.tiles[id].special);
    const portals = mine.filter((id) => st.tiles[id].special === 'portal').length;
    // each 功能建筑 already owned halves the appeal of another: it gives up that land's 修为 milestones
    const damp = 0.5 ** mine.length;
    const value: Record<SpecialKind, number> = {
      garden: rounds * r.gardenPills * VALUE.pill,
      bazaar: rounds * VISITS_PER_ROUND * (r.bazaarFee - rent0 + 40) * this.persona.attack,
      portal: rounds * (portals > 0 ? 40 : 25),
    };
    if (this.difficulty !== 'hard') for (const k of kinds) value[k] *= 0.6 + 0.8 * this.rng.float();
    // a plain building keeps Lv2–Lv4 open (up to 3 修为, slow); a special pays its 修为 now but caps the land
    const plain = rounds * VISITS_PER_ROUND * (nominalRent(this.data, price, 1) - rent0) + VALUE.cult * (rounds >= 4 ? 1.2 : 0.4);
    const now = this.me.milestones.includes(`${node}:special`) ? 0 : r.specialCultivation * VALUE.cult * 0.8;
    let best: SpecialKind | null = null;
    let bv = plain;
    for (const k of kinds) {
      const v = value[k] * damp + now;
      if (v > bv) { bv = v; best = k; }
    }
    return best;
  }

  /** §18.3 The 百宝阁 item to buy now, or null. `roll` draws among worthwhile items (only when really buying). */
  private shopPick(roll: boolean): string | null {
    const p = this.me;
    if (p.hand.length >= this.data.config.handLimit) return null;
    const worth: { id: string; score: number }[] = [];
    for (const card of this.game.shopItems()) {
      const price = card.price!;
      if (p.stones - price < this.persona.buyReserve + 200) continue;
      let v = (SHOP_VALUE[card.id] ?? 60) * (ATTACK_ITEMS.has(card.id) ? this.persona.attack : 1);
      if (p.hand.includes(card.id)) v *= 0.4;
      const score = v - price * 0.6;
      if (score > 0) worth.push({ id: card.id, score });
    }
    if (worth.length === 0) return null;
    if (!roll) return worth[0].id;
    // weighted by score, so the AI does not always buy the same item
    let x = this.rng.float() * worth.reduce((a, w) => a + w.score, 0);
    for (const w of worth) if ((x -= w.score) < 0) return w.id;
    return worth[worth.length - 1].id;
  }

  /** §18.5 灵骰台 bet: a stake loses 1/6 on average, so only bolder personas with spare stones gamble. */
  private diceBet(c: PendingChoiceOf<'diceBet'>): string {
    const side = this.rng.float() < 0.5 ? 'big' : 'small';
    const cap = this.difficulty === 'hard' ? 0
      : this.personality === 'aggressive' ? 200
      : this.personality === 'steady' ? 100 : 0;
    const pick = c.options
      .filter((o) => o.value.side === side && o.value.stake <= cap && this.me.stones - o.value.stake >= this.persona.buyReserve + 300)
      .sort((a, b) => b.value.stake - a.value.stake)[0];
    return pick?.id ?? `${side}0`;
  }

  /** Chance-weighted stop odds of every opponent on each node for their next roll. */
  private stopOdds(): Map<NodeId, number> {
    const out = new Map<NodeId, number>();
    for (const o of this.st.players) {
      if (o.seat === this.seat || o.jailed || o.bound || o.hospitalTurns > 0) continue;
      for (const { total, p } of DICE_DIST) {
        const pr = predictWalk(this.board, this.st, o.seat, total, 1, passive);
        out.set(pr.node, (out.get(pr.node) ?? 0) + p);
      }
    }
    return out;
  }

  /** Best 路障符 spot (valued like 镇山: the next opponent is stopped there). */
  private bestBarrier(): { node: NodeId; value: number } | null {
    let best: { node: NodeId; value: number } | null = null;
    for (const node of this.game.barrierSpots(this.seat)) {
      const v = this.roadblockValue(node);
      if (!best || v > best.value) best = { node, value: v };
    }
    return best;
  }

  /** Best 爆炎阵 spot: where opponents most likely stop next roll (a lost turn plus the walk back). */
  private bestBlast(): { node: NodeId; value: number } | null {
    const spots = new Set(this.game.blastSpots(this.seat));
    let best: { node: NodeId; value: number } | null = null;
    for (const [node, e] of this.stopOdds()) {
      if (!spots.has(node)) continue;
      const v = e * (VALUE.bound + 100);
      if (!best || v > best.value) best = { node, value: v };
    }
    return best;
  }

  private bestUpgrade(nodes: NodeId[]): { node: NodeId; cost: number } | null {
    let best: { node: NodeId; cost: number; score: number } | null = null;
    for (const id of nodes) {
      const t = this.st.tiles[id];
      const price = this.board.node(id).price!;
      const lv = t.level + 1;
      const c = upgradeCost(this.data, price, lv, this.st.turn.discount);
      if (this.me.stones < c.stones + this.persona.upgradeReserve) continue;
      if (c.pills > 0 && this.me.pills - c.pills < this.pillReserve()) continue;
      let score = nominalRent(this.data, price, lv) - nominalRent(this.data, price, t.level);
      if (this.data.config.cultivationOnBuild[String(lv)] && !this.me.milestones.includes(`${id}:${lv}`)) score += VALUE.cult / 2;
      if (!best || score > best.score) best = { node: id, cost: c.stones, score };
    }
    return best;
  }

  /** Best target for a thunder-type attack and its estimated value (stones). */
  private bestThunderTarget(kind: 'thunder' | 'fivethunder'): { target: Target; value: number } | null {
    const st = this.st;
    const demonDmg = kind === 'thunder' ? this.data.config.rules.thunderDemonDamage : this.data.config.rules.magicUltDemonDamage;
    let best: { target: Target; value: number } | null = null;
    const mult = this.me.divines.includes('subdue') ? this.data.config.rules.subdueDamageMult : 1;
    if (st.demon) {
      const dmg = demonDmg * mult;
      const v = st.demon.hp <= dmg ? this.data.config.rules.demonLastHitCultivation * VALUE.cult : dmg * 40;
      best = { target: { t: 'demon' }, value: v };
    }
    const leader = uniqueLeader(st, this.data);
    const roundsLeft = this.data.config.rounds - st.round + 1;
    for (const tg of this.game.thunderTargets(this.seat)) {
      if (tg.t !== 'land') continue;
      const t = st.tiles[tg.node];
      const price = this.board.node(tg.node).price!;
      let v = (nominalRent(this.data, price, t.level) - nominalRent(this.data, price, t.level - 1)) * Math.min(4, roundsLeft) * 0.5;
      if (kind === 'thunder' && leader === t.owner && leader !== this.seat) v += this.data.config.rules.bountyCultivation * VALUE.cult;
      if (!best || v > best.value) best = { target: tg, value: v };
    }
    return best;
  }

  private bestBuyout(): { node: NodeId; value: number } | null {
    let best: { node: NodeId; value: number } | null = null;
    for (const id of this.game.buyoutTargets(this.seat)) {
      const n = this.board.node(id);
      const t = this.st.tiles[id];
      const cost = buyoutPrice(this.data, n.price!, t.level);
      if (this.me.stones - cost < this.persona.buyReserve) continue;
      const mine = countOwned(this.st, this.board, this.seat, n.region);
      const theirs = countOwned(this.st, this.board, t.owner!, n.region);
      let v = n.price! * 0.4 + mine * 120;
      if (mine + 1 >= this.data.config.veinLordMinLands && mine + 1 > theirs - 1) v += VALUE.cult;
      if (mine === 4) v += 500;
      if (!best || v > best.value) best = { node: id, value: v };
    }
    return best;
  }

  private buy(c: PendingChoiceOf<'buy'>): string {
    const price = c.ctx.price ?? 0;
    const node = c.ctx.node!;
    const after = this.me.stones - price;
    if (this.difficulty === 'easy') return this.rng.float() < 0.5 && after >= 0 ? 'yes' : 'no';
    let reserve = this.persona.buyReserve;
    const region = this.board.node(node).region!;
    const mine = countOwned(this.st, this.board, this.seat, region);
    if (mine >= 2) reserve *= 0.5; // completing a 灵脉 / 独占 is worth stretching for
    if (this.streetPull(node) >= 300) reserve *= 0.4; // §18.1 the last land of a street doubles its rent
    if (this.difficulty === 'hard') {
      // look-ahead: keep enough to survive the worst likely rent next roll
      let worst = 0;
      for (const { total, p } of DICE_DIST) {
        if (p < 3 / 36) continue;
        const pr = predictWalk(this.board, this.st, this.seat, total, 1, this.policy(), node);
        worst = Math.max(worst, rentFor(this.st, this.board, this.data, pr.node, this.seat).amount);
      }
      reserve = Math.max(reserve * 0.7, worst * 1.2);
    }
    return after >= reserve ? 'yes' : 'no';
  }

  private guardReact(c: PendingChoiceOf<'guardReact'>): string {
    const pills = this.me.pills;
    switch (c.ctx.threat) {
      case 'buyout': return 'goldlight';
      case 'thunder':
      case 'fivethunder': {
        const lv = c.ctx.node ? this.st.tiles[c.ctx.node].level : 1;
        return lv >= 2 || pills >= 3 ? 'goldlight' : 'no';
      }
      case 'bind': return pills >= 2 ? 'goldlight' : 'no';
      case 'eruption': return pills >= 2 ? 'goldlight' : 'no';
      default: return 'no';
    }
  }

  private blessingWeight(id: string, kind: 'divine' | 'heaven'): number {
    const list = kind === 'divine' ? this.data.blessings.divine : this.data.blessings.heaven;
    let w = list.find((x) => x.id === id)?.aiWeight ?? 1;
    w += this.persona.likes[id] ?? 0;
    if (this.difficulty === 'easy') return w * (0.5 + this.rng.float());
    const lands = countOwned(this.st, this.board, this.seat);
    const myCult = this.cult();
    if (id === 'chart' && myCult + 1 >= this.data.config.winCultivation) w += 100;
    if (this.difficulty === 'hard') {
      if ((id === 'midas' || id === 'gather') && lands < 2) w -= 4;
      if (id === 'auspice') w += lands >= 2 ? 2 : -8;
      if (id === 'guide' && breakthroughsAvailable(this.me) > 0) w += 4;
      if (id === 'subdue' && this.st.round >= 10) w -= 3;
      if (id === 'vein' && this.me.stones < 500) w += 3;
    } else if (id === 'auspice' && lands === 0) w -= 8;
    return w;
  }

  private nodeChoice(c: PendingChoiceOf<'node'>): string | undefined {
    const purpose = c.ctx.purpose;
    if (purpose === 'guide') {
      if (this.wantsAltar() && c.options.some((o) => o.value === ALTAR)) return ALTAR;
      return this.bestBy(c.options, (o) => this.landingScore(o.value));
    }
    if (purpose === 'auspice') {
      return this.bestBy(c.options, (o) => {
        const t = this.st.tiles[o.value];
        const price = this.board.node(o.value).price!;
        const lv = t.level + 1;
        let s = nominalRent(this.data, price, lv) - nominalRent(this.data, price, t.level);
        if (this.data.config.cultivationOnBuild[String(lv)] && !this.me.milestones.includes(`${o.value}:${lv}`)) s += VALUE.cult;
        return s;
      });
    }
    if (purpose === 'array') {
      return this.bestBy(c.options, (o) => {
        const n = this.board.node(o.value);
        const t = this.st.tiles[o.value];
        if (t.owner === this.seat) return 0;
        const price = buyPrice(this.st, this.data, this.me, n.price!, false);
        if (this.me.stones - price < this.persona.buyReserve * 0.5) return -1;
        return n.price! + 150 * countOwned(this.st, this.board, this.seat, n.region);
      });
    }
    return this.bestBy(c.options, (o) => this.landingScore(o.value));
  }

  private targetChoice(c: PendingChoiceOf<'target'>): string | undefined {
    const purpose = c.ctx.purpose;
    const real = c.options.filter((o) => o.value.t !== 'cancel');
    if (real.length === 0) return 'cancel';
    if (purpose === 'thunder' || purpose === 'fivethunder') {
      const tg = this.bestThunderTarget(purpose);
      if (!tg) return 'cancel';
      return tg.target.t === 'demon' ? 'demon' : tg.target.t === 'land' ? `land:${tg.target.node}` : 'cancel';
    }
    if (purpose === 'buyout') {
      const b = this.bestBuyout();
      return b ? `land:${b.node}` : 'cancel';
    }
    if (purpose === 'bind') {
      const leader = this.leaderOpponent();
      const o = real.find((x) => x.value.t === 'player' && x.value.seat === leader);
      return o?.id ?? real[0].id;
    }
    if (purpose === 'sworddash' || purpose === 'swap' || purpose === 'daze' || purpose === 'roadblock') {
      return this.bestSkill()?.id ?? 'cancel';
    }
    if (purpose === 'barrier') {
      const b = this.bestBarrier();
      return b ? `node:${b.node}` : 'cancel';
    }
    if (purpose === 'blast') {
      const b = this.bestBlast();
      return b ? `node:${b.node}` : real[0].id;
    }
    if (purpose === 'drain') {
      return this.bestBy(real, (o) => (o.value.t === 'player' ? this.st.players[o.value.seat].pills + this.cult(o.value.seat) * 0.1 : 0));
    }
    return real[0].id;
  }
}

/** Convenience: pick a random personality for a seat. */
export function randomPersonality(rng: Rng): Personality {
  return rng.pick(['steady', 'aggressive', 'miser'] as const);
}

