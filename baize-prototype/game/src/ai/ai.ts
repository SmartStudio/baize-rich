// AI controller. Normal difficulty follows fixed thresholds;
// easy / hard are parameter tweaks plus a one-step look-ahead for hard.
// Personalities 稳健 / 激进 / 守财 shift thresholds and preferences.
import { ALTAR } from '../core/board';
import type { ActionAct, Controller, PendingChoice, PendingChoiceOf, PreRollAct } from '../core/choices';
import type { Game } from '../core/engine';
import { Rng } from '../core/rng';
import {
  breakthroughCost, breakthroughsAvailable, buyPrice, canBreakthrough, countOwned, cultivation, nominalRent, rentFor, upgradeCost,
} from '../core/rules';
import type { MiniGameTier, NodeId } from '../core/types';
import { DICE_DIST, predictWalk, type Prediction, type WalkPolicy } from './predict';

const mainLine: WalkPolicy['fork'] = (_node, _remaining, options) => options[0];
const passive: WalkPolicy = { fork: mainLine, altar: () => 'stop', canPayToll: false };

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'steady' | 'aggressive' | 'miser';

export const PERSONALITY_LABEL: Record<Personality, string> = { steady: '稳健', aggressive: '激进', miser: '守财' };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '简单', normal: '普通', hard: '困难' };

interface Persona {
  /** Stones that must remain after buying land. */
  buyReserve: number;
  /** Stones that must remain after an upgrade. */
  upgradeReserve: number;
  /** Multiplier on the value of attacking others. */
  attack: number;
  /** Use 避劫符 if rent ≥ this fraction of current stones. */
  evadeRatio: number;
}

const PERSONAS: Record<Personality, Persona> = {
  steady: { buyReserve: 300, upgradeReserve: 400, attack: 1, evadeRatio: 0.15 },
  aggressive: { buyReserve: 150, upgradeReserve: 250, attack: 1.5, evadeRatio: 0.25 },
  miser: { buyReserve: 600, upgradeReserve: 600, attack: 0.6, evadeRatio: 0.1 },
};

/** Rough stone-equivalents used when comparing heterogeneous gains. */
const VALUE = { pill: 50, cult: 400 };

/** 炼丹房: how often the AI hits each tier (it plays the timing game by chance). */
const ALCHEMY_ODDS: Record<Difficulty, Record<MiniGameTier, number>> = {
  easy: { perfect: 0.15, ok: 0.5, fail: 0.35 },
  normal: { perfect: 0.3, ok: 0.5, fail: 0.2 },
  hard: { perfect: 0.45, ok: 0.45, fail: 0.1 },
};

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
    return breakthroughsAvailable(this.me) > 0 ? breakthroughCost(this.st, this.data, this.seat) : 0;
  }

  private sparePills(): number {
    return this.me.pills - this.pillReserve();
  }

  private policy(): WalkPolicy {
    return {
      fork: (node, _remaining, options) => this.forkRule(node, options, 1),
      altar: () => 'stop',
      canPayToll: this.me.pills >= this.data.config.altarToll && !this.wantsAltar(),
    };
  }

  /** Value (in stones) of ending a move on `node` for this AI. */
  landingScore(node: NodeId, passStart = 0): number {
    const st = this.st;
    const p = this.me;
    const n = this.board.node(node);
    let s = passStart * this.data.config.salaryPass;
    switch (n.type) {
      case 'land': {
        const t = st.tiles[node];
        if (t.owner === null) {
          const price = buyPrice(this.data, p, n.price!);
          if (p.stones - price >= this.persona.buyReserve) s += 0.3 * price;
        } else if (t.owner === this.seat) s += 10;
        else {
          const r = rentFor(st, this.board, this.data, node, this.seat).amount;
          s -= r;
          if (r >= p.stones) s -= 400;
        }
        break;
      }
      case 'start': s += this.data.config.salaryLand; break;
      case 'trial': s += 60; break;
      case 'spring': s += 60; break;
      case 'furnace': s += 2 * VALUE.pill; break;
      case 'market': s += p.hand.length < this.data.config.handLimit && p.stones > 500 ? 40 : 0; break;
      case 'array': s += 80; break;
      case 'shrine': s += VALUE.pill; break;
      case 'altar': s += this.wantsAltar() ? 500 : 40; break;
      case 'minigame': s += n.game === 'alchemy' ? this.alchemyPills() * VALUE.pill : 0; break;
      default: break;
    }
    return s;
  }

  /** Landing plus duels on the way. */
  private moveValue(pr: Prediction): number {
    return this.landingScore(pr.node, pr.passStart) + this.meetValue(pr.path);
  }

  /** Expected 灵丹 from one visit to a 炼丹房. */
  private alchemyPills(): number {
    const odds = ALCHEMY_ODDS[this.difficulty];
    const r = this.data.config.rules.miniGameRewards;
    return odds.perfect * r.perfect + odds.ok * r.ok + odds.fail * r.fail;
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
    return pWin * this.game.duelStake(opp) * this.persona.attack - (1 - pWin) * this.game.duelStake(this.seat) - myBet * VALUE.pill;
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
    return best + (target === this.leaderOpponent() ? 30 : 0);
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
    const stakeSum = this.game.duelStake(atk) + this.game.duelStake(def);
    const opts = c.options.filter((o) => o.value <= this.maxBet());
    if (opts.length === 0) return 'b0';
    if (atk === this.seat) {
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
    const targets = g.skillTargets(this.seat);
    let best: { id: string; value: number } | null = null;
    const consider = (id: string, value: number) => { if (!best || value > best.value) best = { id, value }; };
    switch (g.heroOf(this.seat).skill.id) {
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
      if (st.players[seat].bound) continue;
      let pPass = 0;
      for (const { total, p } of DICE_DIST) {
        const pr = predictWalk(this.board, st, seat, total, 1, passive);
        if (pr.path.slice(1).includes(node)) pPass += p;
      }
      const t = st.tiles[node];
      let v = 30;
      if (t && t.owner === this.seat) v += rentFor(st, this.board, this.data, node, seat).amount;
      else if (t && t.owner !== null) v += rentFor(st, this.board, this.data, node, seat).amount * 0.3;
      return pPass * v;
    }
    return 0;
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

  // Fork rule (normal): breakthrough ready → toward the altar; heavy rent in the next 6
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
      case 'adjust': return this.bestBy(c.options, (o) => this.scoreMove(o.value, this.st.turn.reverse ? -1 : 1));
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
      case 'exitRoad': return this.bestBy(c.options, (o) => this.exitScore(o.value, c.ctx.remaining ?? 7));
      case 'buy': return this.buy(c);
      case 'rentReact': {
        const rent = c.ctx.rent ?? 0;
        const use = rent >= this.me.stones || (rent >= 150 && rent >= this.me.stones * this.persona.evadeRatio);
        return use ? 'evade' : 'pay';
      }
      case 'guardReact': return this.me.pills >= 2 ? 'goldlight' : 'no';
      case 'altar': {
        if (c.options.some((o) => o.value === 'break')) return 'break';
        return this.me.pills < 2 ? 'calm' : 'leave';
      }
      case 'auction': return this.me.stones - 300 >= Math.min(300, this.persona.buyReserve) ? 'yes' : 'no';
      case 'market': {
        const reserve = this.persona.buyReserve;
        const roomy = this.me.hand.length <= 3;
        const want = this.me.stones >= reserve + 1200 && roomy ? 2 : this.me.stones >= reserve + 400 ? 1 : 0;
        const opt = c.options.find((o) => o.value === want) ?? c.options.find((o) => o.value === 1) ?? c.options[c.options.length - 1];
        return this.me.stones >= reserve + 400 ? opt.id : 'no';
      }
      case 'node': return this.arrayTarget(c);
      case 'target': return this.targetChoice(c);
      case 'duel': return this.duelChoice(c);
      case 'duelBet': return this.duelBet(c);
      case 'miniGame': {
        const odds = ALCHEMY_ODDS[this.difficulty];
        const x = this.rng.float();
        return x < odds.perfect ? 'perfect' : x < odds.perfect + odds.ok ? 'ok' : 'fail';
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

  // ---------------------------------------------------------- pre-roll ---

  private preRoll(c: PendingChoiceOf<'preRoll'>): string {
    const has = (pred: (v: PreRollAct) => boolean) => c.options.find((o) => pred(o.value));
    if (this.difficulty === 'easy') return 'roll';
    const spare = this.sparePills();
    const base = this.expectedRoll(1);
    const skill = has((v) => v.t === 'skill');
    if (skill) {
      const sk = this.bestSkill();
      if (sk && sk.value > (this.difficulty === 'hard' ? 40 : 80)) return skill.id;
    }
    const swift = has((v) => v.t === 'cast' && v.card === 'swiftstep');
    if (swift && spare >= 1 && this.expectedRoll(1, [1, 2, 3]) - base > 120) return swift.id;
    const dice = has((v) => v.t === 'cast' && v.card === 'dice');
    if (dice) {
      const r = this.data.config.rules;
      let best = -Infinity;
      for (let v = r.diceCardMin; v <= r.diceCardMax; v++) best = Math.max(best, this.scoreMove(v, 1));
      if (best - base > (this.difficulty === 'hard' ? 80 : 120)) return dice.id;
    }
    const back = has((v) => v.t === 'cast' && v.card === 'reverse');
    if (back && spare >= 1 && this.expectedRoll(-1) - base > 150) return back.id;
    return 'roll';
  }

  // ------------------------------------------------------------ action ---

  private action(c: PendingChoiceOf<'action'>): string {
    const find = (pred: (v: ActionAct) => boolean) => c.options.find((o) => pred(o.value));
    const spare = this.sparePills();
    const ups = c.options.filter((o) => o.value.t === 'upgrade');
    const bestUp = this.bestUpgrade(ups.map((o) => (o.value as { node: NodeId }).node));
    if (bestUp) return `upgrade:${bestUp}`;
    if (this.difficulty !== 'easy') {
      const leader = this.leaderOpponent();
      const bind = find((v) => v.t === 'cast' && v.card === 'bind');
      if (bind && spare >= 2 && leader !== null && this.cult(leader) >= 5 && this.cult(leader) >= this.cult()) return bind.id;
      const drain = find((v) => v.t === 'cast' && v.card === 'drain');
      if (drain && spare >= 1 && leader !== null && this.st.players[leader].pills >= 3) return drain.id;
    }
    const skill = find((v) => v.t === 'skill');
    if (skill && (this.difficulty !== 'easy' || this.rng.float() < 0.5)) {
      const sk = this.bestSkill();
      if (sk && sk.value > 20) return skill.id;
    }
    return 'end';
  }

  private bestUpgrade(nodes: NodeId[]): NodeId | null {
    let best: { node: NodeId; score: number } | null = null;
    for (const id of nodes) {
      const t = this.st.tiles[id];
      const price = this.board.node(id).price!;
      const lv = t.level + 1;
      const c = upgradeCost(this.data, price, lv);
      if (this.me.stones < c.stones + this.persona.upgradeReserve) continue;
      if (c.pills > 0 && this.me.pills - c.pills < this.pillReserve()) continue;
      let score = nominalRent(this.data, price, lv) - nominalRent(this.data, price, t.level);
      if (this.data.config.cultivationOnBuild[String(lv)] && !this.me.milestones.includes(`${id}:${lv}`)) score += VALUE.cult / 2;
      if (!best || score > best.score) best = { node: id, score };
    }
    return best?.node ?? null;
  }

  private buy(c: PendingChoiceOf<'buy'>): string {
    const price = c.ctx.price ?? 0;
    const node = c.ctx.node!;
    const after = this.me.stones - price;
    if (this.difficulty === 'easy') return this.rng.float() < 0.5 && after >= 0 ? 'yes' : 'no';
    let reserve = this.persona.buyReserve;
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

  private arrayTarget(c: PendingChoiceOf<'node'>): string | undefined {
    return this.bestBy(c.options, (o) => {
      const n = this.board.node(o.value);
      if (this.st.tiles[o.value].owner === this.seat) return 0;
      const price = buyPrice(this.data, this.me, n.price!);
      if (this.me.stones - price < this.persona.buyReserve * 0.5) return -1;
      return n.price! + 150 * countOwned(this.st, this.board, this.seat);
    });
  }

  private targetChoice(c: PendingChoiceOf<'target'>): string | undefined {
    const purpose = c.ctx.purpose;
    const real = c.options.filter((o) => o.value.t !== 'cancel');
    if (real.length === 0) return 'cancel';
    if (purpose === 'bind') {
      const leader = this.leaderOpponent();
      return real.find((x) => x.value.t === 'player' && x.value.seat === leader)?.id ?? real[0].id;
    }
    if (purpose === 'sworddash' || purpose === 'swap' || purpose === 'daze' || purpose === 'roadblock') {
      return this.bestSkill()?.id ?? 'cancel';
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
