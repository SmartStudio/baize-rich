// AI controller. Normal difficulty follows fixed thresholds;
// easy / hard are parameter tweaks plus a one-step look-ahead for hard.
// Personalities 稳健 / 激进 / 守财 shift thresholds and preferences.
import { ALTAR } from '../core/board';
import type { ActionAct, Controller, PendingChoice, PendingChoiceOf, PreRollAct } from '../core/choices';
import type { Game } from '../core/engine';
import { Rng } from '../core/rng';
import {
  closureSite, duelBonus, duelWinChance, hasTrait, landLevel, nominalRent, rentFor, upgradeCost, winRealm,
} from '../core/rules';
import type { MiniGameTier, NodeId } from '../core/types';
import {
  VALUE, barRoom, closureChance, fortuneValue, giftValue, lootValue, nearlyFull, stakeFor, tileValue, type View,
} from './evaluate';
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
  /** Attempt 闭关 away from the altar once the chance reaches this. */
  closeAt: number;
  /** Stake pills until the breakthrough chance reaches this. */
  stakeAt: number;
  /** Pills never eaten (kept for staking and as duel loot buffer). */
  keepPills: number;
}

const PERSONAS: Record<Personality, Persona> = {
  steady: { buyReserve: 300, upgradeReserve: 400, attack: 1, evadeRatio: 0.15, closeAt: 0.55, stakeAt: 0.72, keepPills: 2 },
  aggressive: { buyReserve: 150, upgradeReserve: 250, attack: 1.5, evadeRatio: 0.25, closeAt: 0.45, stakeAt: 0.6, keepPills: 1 },
  miser: { buyReserve: 600, upgradeReserve: 600, attack: 0.6, evadeRatio: 0.1, closeAt: 0.6, stakeAt: 0.8, keepPills: 2 },
};

/** 丹房火候: how often the AI hits each tier (it plays the timing game by chance). */
const ALCHEMY_ODDS: Record<Difficulty, Record<MiniGameTier, number>> = {
  easy: { perfect: 0.15, ok: 0.5, fail: 0.35 },
  normal: { perfect: 0.3, ok: 0.5, fail: 0.2 },
  hard: { perfect: 0.45, ok: 0.45, fail: 0.1 },
};

/** A failure that keeps the bar only costs the stake, so 闭关 here is worth trying at lower odds. */
const STEADY_BAR_EASE = 0.15;

/** Minimum duel EV (stones) worth a challenge, by difficulty. */
const DUEL_BAR: Record<Difficulty, number> = { easy: 150, normal: 20, hard: 0 };

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
  private get view(): View { return { st: this.st, board: this.board, data: this.data, seat: this.seat }; }
  private get roundsLeft() { return this.data.config.rounds - this.st.round; }

  private wantsAltar(): boolean {
    return nearlyFull(this.view);
  }

  private policy(): WalkPolicy {
    return {
      fork: (node, _remaining, options) => this.forkRule(node, options, 1),
      altar: () => 'stop',
      canPayToll: false,
    };
  }

  /** Value (in stones) of ending a move on `node` for this AI. */
  landingScore(node: NodeId, passStart = 0): number {
    return passStart * this.data.config.salaryPass + tileValue(this.view, node);
  }

  /** Landing plus duels on the way. */
  private moveValue(pr: Prediction): number {
    return this.landingScore(pr.node, pr.passStart) + this.meetValue(pr.path);
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
      if (o.seat === this.seat || !path.slice(1).includes(o.pos)) continue;
      best = Math.max(best, this.challengeValue(o.seat));
    }
    return best;
  }

  /** Standing score used to find the player to hold back. */
  private standing(seat: number): number {
    const p = this.st.players[seat];
    return p.realm * 20 + p.cult;
  }

  private leaderOpponent(): number | null {
    let best = -1;
    let seat: number | null = null;
    for (const o of this.st.players) {
      if (o.seat === this.seat) continue;
      if (this.standing(o.seat) > best) { best = this.standing(o.seat); seat = o.seat; }
    }
    return seat;
  }

  // ------------------------------------------------------------- duels ---

  /** EV of challenging `target` now: loot won against own loot at risk. */
  challengeValue(target: number): number {
    const [a, d] = duelBonus(this.st, this.data, this.seat, target);
    const p = duelWinChance(a - d);
    const gain = lootValue(this.st, this.data, target) * this.persona.attack + this.momentumValue();
    const risk = lootValue(this.st, this.data, this.seat);
    return p * gain - (1 - p) * risk + (target === this.leaderOpponent() ? 30 : 0);
  }

  /** 战意 a win would add while none is held, priced as the pill stake that buys the same bonus. */
  private momentumValue(): number {
    if (!hasTrait(this.data, this.me, 'momentum') || this.me.momentum) return 0;
    return this.data.config.breakthrough.momentumBonus * VALUE.pill / this.data.config.breakthrough.pillBonus;
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

  /** 金光符 when the expected loss is worth a card. */
  private guardChoice(c: PendingChoiceOf<'guardReact'>): string {
    if (c.ctx.threat === 'drain') return 'goldlight';
    const atk = c.ctx.attacker!;
    const [a, d] = duelBonus(this.st, this.data, atk, this.seat);
    const loss = duelWinChance(a - d) * lootValue(this.st, this.data, this.seat);
    return loss >= VALUE.card ? 'goldlight' : 'no';
  }

  // ------------------------------------------------------------ skills ---

  /** Best target for the hero's active skill and its estimated gain over not using it. */
  private bestSkill(): { id: string; value: number } | null {
    const targets = this.game.skillTargets(this.seat);
    let best: { id: string; value: number } | null = null;
    for (const t of targets) {
      const id = typeof t === 'number' ? `p${t}` : `node:${t}`;
      const value = this.skillValue(t);
      if (!best || value > best.value) best = { id, value };
    }
    return best;
  }

  private skillValue(t: number | NodeId): number {
    const st = this.st;
    switch (this.game.heroOf(this.seat).skill.id) {
      case 'sworddash': return this.challengeValue(t as number) + this.landingScore(st.players[t as number].pos) - this.expectedRoll(1);
      case 'daze': return this.dazeValue(t as number);
      case 'roadblock': return this.roadblockValue(t as NodeId);
      default: return 0;
    }
  }

  /** 迷魂丹 pays off against a rival racing to a closure site; its pill must buy more than a stake would. */
  private dazeValue(target: number): number {
    const racing = nearlyFull({ ...this.view, seat: target }) ? 250 : 0;
    const leader = target === this.leaderOpponent() ? 60 : 0;
    return racing + leader + this.standing(target) * 2 - this.game.heroOf(this.seat).skill.pillCost * VALUE.pill;
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
        if (predictWalk(this.board, st, seat, total, 1, passive).path.slice(1).includes(node)) pPass += p;
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

  // Fork rule (normal): bar about to fill → toward the altar; heavy rent in the next 6
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

  private hardFork(node: NodeId, remaining: number, options: NodeId[]): NodeId {
    const walk = (fork: WalkPolicy['fork']) => this.moveValue(predictWalk(this.board, this.st, this.seat, remaining, 1, { ...this.policy(), fork }, node));
    const altarward = this.board.altarward(options);
    let best = options[0];
    let bestScore = walk(mainLine);
    for (const alt of options.slice(1)) {
      const score = walk((n, _r, o) => (n === node ? alt : o[0])) + (this.wantsAltar() && alt === altarward ? 200 : 0);
      if (score > bestScore) { best = alt; bestScore = score; }
    }
    return best;
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
      case 'adjust': return this.bestBy(c.options, (o) => this.scoreMove(o.value.steps, this.st.turn.reverse ? -1 : 1) - (o.value.card ? VALUE.card : 0));
      case 'fork': return this.fork(c);
      case 'altarPass': return this.altarPass(c);
      case 'exitRoad': return this.bestBy(c.options, (o) => this.exitScore(o.value, c.ctx.remaining ?? 7));
      case 'buy': return this.buy(c);
      case 'rentReact': return this.rentReact(c.ctx.rent ?? 0);
      case 'guardReact': return this.guardChoice(c);
      case 'stake': return `s${stakeFor(this.view, this.stakeTarget(), c.ctx.site!)}`;
      case 'calm': return 'calm';
      case 'brew': return c.options[0].id;
      case 'miniGame': return this.heat();
      case 'market': return this.market(c);
      case 'fortunePick': return this.bestBy(c.options, (o) => fortuneValue(this.view, this.eventEffect(o.value)));
      case 'manifestPick': return this.bestBy(c.options, (o) => giftValue(this.view, o.value));
      case 'node': return this.bestBy(c.options, (o) => tileValue(this.view, o.value));
      case 'target': return this.targetChoice(c);
      case 'duel': return this.duelChoice(c);
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

  private fork(c: PendingChoiceOf<'fork'>): string | undefined {
    const node = c.ctx.node!;
    const options = c.options.map((o) => o.value);
    const pick = this.difficulty === 'hard'
      ? this.hardFork(node, c.ctx.remaining ?? 1, options)
      : this.forkRule(node, options, this.st.turn.reverse ? -1 : 1);
    return c.options.find((o) => o.value === pick)?.id;
  }

  /** Stop at the altar unless leaving is worth more than the toll pill. */
  private altarPass(c: PendingChoiceOf<'altarPass'>): string | undefined {
    if (this.wantsAltar()) return 'stop';
    const remaining = c.ctx.remaining ?? 0;
    const stay = tileValue(this.view, ALTAR);
    const leave = c.options.filter((o) => o.value !== 'stop');
    const id = this.bestBy(leave, (o) => this.exitScore(o.value as NodeId, remaining));
    const best = leave.find((o) => o.id === id);
    if (!best) return 'stop';
    const toll = this.data.config.altarToll * VALUE.pill;
    return this.exitScore(best.value as NodeId, remaining) - toll > stay ? best.id : 'stop';
  }

  private rentReact(rent: number): string {
    const use = rent >= this.me.stones || (rent >= 150 && rent >= this.me.stones * this.persona.evadeRatio);
    return use ? 'evade' : 'pay';
  }

  private heat(): MiniGameTier {
    const odds = ALCHEMY_ODDS[this.difficulty];
    const x = this.rng.float();
    return x < odds.perfect ? 'perfect' : x < odds.perfect + odds.ok ? 'ok' : 'fail';
  }

  private eventEffect(id: string) {
    return this.data.events.events.find((e) => e.id === id)!.effect;
  }

  // -------------------------------------------------------- breakthrough ---

  /** The last breakthrough decides the game: stake for near certainty. */
  private stakeTarget(): number {
    return this.me.realm + 1 >= winRealm(this.data) ? 0.95 : this.persona.stakeAt;
  }

  /** Close here now, or walk on toward a better site (the altar). */
  private shouldClose(): boolean {
    if (this.me.pos === ALTAR || this.roundsLeft <= 1) return true;
    const site = closureSite(this.st, this.data, this.seat, this.me.pos)!;
    const chance = closureChance(this.view, site, stakeFor(this.view, this.stakeTarget(), site));
    if (this.difficulty === 'easy') return chance >= 0.4;
    const failCheap = hasTrait(this.data, this.me, 'steadyBar') ? STEADY_BAR_EASE : 0;
    return chance >= this.persona.closeAt - failCheap || this.board.distance(this.me.pos, ALTAR) > 10;
  }

  /**
   * 引雷破境 is offered only off every closure site. Waiting keeps the bar and stores the overflow
   * as 感悟, so strike only when the odds at the −1 site already clear the persona bar, or time is short.
   */
  private shouldThunder(): boolean {
    if (this.roundsLeft <= 1) return true;
    const site = this.data.config.breakthrough.thunderSite;
    const chance = closureChance(this.view, site, stakeFor(this.view, this.stakeTarget(), site));
    return chance >= (this.difficulty === 'easy' ? 0.4 : this.persona.closeAt);
  }

  // ---------------------------------------------------------- pre-roll ---

  private preRoll(c: PendingChoiceOf<'preRoll'>): string {
    const has = (pred: (v: PreRollAct) => boolean) => c.options.find((o) => pred(o.value));
    const close = has((v) => v.t === 'closure');
    if (close && this.shouldClose()) return close.id;
    if (this.difficulty === 'easy') return 'roll';
    const base = this.expectedRoll(1);
    const skill = has((v) => v.t === 'skill');
    if (skill) {
      const sk = this.bestSkill();
      if (sk && sk.value > (this.difficulty === 'hard' ? 40 : 80)) return skill.id;
    }
    const dice = has((v) => v.t === 'cast' && v.card === 'dice');
    if (dice && this.bestFixedRoll() - base > (this.difficulty === 'hard' ? 80 : 120)) return dice.id;
    const back = has((v) => v.t === 'cast' && v.card === 'reverse');
    if (back && this.expectedRoll(-1) - base > 150) return back.id;
    return 'roll';
  }

  private bestFixedRoll(): number {
    const r = this.data.config.rules;
    let best = -Infinity;
    for (let v = r.diceCardMin; v <= r.diceCardMax; v++) best = Math.max(best, this.scoreMove(v, 1));
    return best;
  }

  // ------------------------------------------------------------ action ---

  private action(c: PendingChoiceOf<'action'>): string {
    const find = (pred: (v: ActionAct) => boolean) => c.options.find((o) => pred(o.value));
    if (find((v) => v.t === 'brew')) return 'brew';
    const close = find((v) => v.t === 'closure');
    if (close && this.shouldClose()) return close.id;
    const skill = find((v) => v.t === 'skill');
    if (skill && this.game.heroOf(this.seat).skill.id === 'thunder' && this.shouldThunder()) return skill.id;
    const bestUp = this.bestUpgrade(c.options.filter((o) => o.value.t === 'upgrade').map((o) => (o.value as { node: NodeId }).node));
    if (bestUp) return `upgrade:${bestUp}`;
    if (find((v) => v.t === 'eat') && this.shouldEat()) return 'eat';
    const cast = this.castChoice(find);
    if (cast) return cast;
    if (skill && (this.difficulty !== 'easy' || this.rng.float() < 0.5)) {
      const sk = this.bestSkill();
      if (sk && sk.value > 20) return skill.id;
    }
    return 'end';
  }

  /** Eat only spare pills, and only when the bar has room for the whole gain. */
  private shouldEat(): boolean {
    const keep = this.me.realm + 1 >= winRealm(this.data) ? 3 : this.persona.keepPills;
    return this.me.pills > keep && barRoom(this.view) >= this.data.config.cultivation.pill;
  }

  private castChoice(find: (pred: (v: ActionAct) => boolean) => { id: string } | undefined): string | undefined {
    if (this.difficulty === 'easy') return undefined;
    const leader = this.leaderOpponent();
    if (leader === null) return undefined;
    const bind = find((v) => v.t === 'cast' && v.card === 'bind');
    if (bind && this.standing(leader) >= this.standing(this.seat) && nearlyFull({ ...this.view, seat: leader })) return bind.id;
    const drain = find((v) => v.t === 'cast' && v.card === 'drain');
    if (drain && this.st.players.some((o) => o.seat !== this.seat && o.pills >= 2)) return drain.id;
    return undefined;
  }

  /** Static value of raising `node` to the next level. */
  private upgradeValue(node: NodeId): number {
    const st = this.st;
    const t = st.tiles[node];
    const price = this.board.node(node).price!;
    const [from, to] = [landLevel(this.data, t.level), landLevel(this.data, t.level + 1)];
    const rounds = this.roundsLeft;
    let s = (nominalRent(this.data, price, t.level + 1) - nominalRent(this.data, price, t.level)) * Math.min(rounds, 4) * 0.4;
    s += (to.herbs - from.herbs) * VALUE.herb * rounds;
    s += (to.sit - from.sit) * VALUE.cult * 0.5;
    if (from.closureBonus === null && to.closureBonus !== null) s += 250;
    return s;
  }

  private bestUpgrade(nodes: NodeId[]): NodeId | null {
    let best: { node: NodeId; score: number } | null = null;
    for (const id of nodes) {
      const cost = upgradeCost(this.data, this.board.node(id).price!, this.st.tiles[id].level + 1);
      if (this.me.stones < cost + this.persona.upgradeReserve) continue;
      const score = this.upgradeValue(id) - cost * 0.5;
      if (score > 0 && (!best || score > best.score)) best = { node: id, score };
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

  /** 坊市: top pills up to a staking reserve, then a card if the hand is thin. */
  private market(c: PendingChoiceOf<'market'>): string {
    const m = this.data.config.market;
    const want = Math.max(0, this.persona.keepPills + 1 - this.me.pills);
    for (let k = Math.min(want, m.pillMax); k > 0; k--) {
      if (this.me.stones - k * m.pillPrice >= this.persona.buyReserve) return `pill${k}`;
    }
    const card = c.options.find((o) => o.id === 'card1');
    if (card && this.me.hand.length < 2 && this.me.stones - m.cardPrice >= this.persona.buyReserve + 300) return card.id;
    return 'none';
  }

  private targetChoice(c: PendingChoiceOf<'target'>): string | undefined {
    const real = c.options.filter((o) => o.value.t !== 'cancel');
    if (real.length === 0) return 'cancel';
    switch (c.ctx.purpose) {
      case 'bind': {
        const leader = this.leaderOpponent();
        return real.find((x) => x.value.t === 'player' && x.value.seat === leader)?.id ?? real[0].id;
      }
      case 'drain':
        return this.bestBy(real, (o) => (o.value.t === 'player' ? this.st.players[o.value.seat].pills * 10 + this.standing(o.value.seat) : 0));
      case 'sworddash': case 'daze': case 'roadblock':
        return this.bestSkill()?.id ?? 'cancel';
      default:
        return real[0].id;
    }
  }
}

/** Convenience: pick a random personality for a seat. */
export function randomPersonality(rng: Rng): Personality {
  return rng.pick(['steady', 'aggressive', 'miser'] as const);
}
