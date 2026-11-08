// Choices that only decide where a token goes or a 镇山 mountain falls, asked on the board instead of in a modal: the cells each
// answer leads to, their number keys and labels, and the dock line. Pure, so GameScene and the tests share it.
// The walk projection mirrors Game.walk: forks branch, the altar stops a walk unless its pill is paid,
// a 镇山 mountain stops it, 迷魂丹 halves the steps, every rival land walked past takes its 过路费.
import { ALTAR } from '../core/board';
import type { ChoiceKind, PendingChoice, PendingChoiceOf } from '../core/choices';
import type { Game } from '../core/engine';
import { passToll } from '../core/rules';
import type { NodeId } from '../core/types';

export const PICK_KINDS = ['fork', 'exitRoad', 'altarPass', 'adjust', 'rollValue', 'node', 'target'] as const;
export type PickKind = (typeof PICK_KINDS)[number];

/** The asks a walk can still raise after this one; a picked cell's route answers them in order. */
export const ROUTE_KINDS: readonly ChoiceKind[] = ['fork', 'exitRoad', 'altarPass'];

export interface PickCell {
  node: NodeId;
  /** The option this cell answers. */
  id: string;
  /** Option ids for the fork / exit / altar asks later in the same walk, so the landing picked is the landing reached. */
  route: string[];
  /** Digit that picks this cell, null past the ninth. */
  key: string | null;
  label: string;
  /** Stones of 过路费 the way to this cell pays. */
  toll: number;
  /** A cost the label alone hides: 神行符 spent, the altar pill, the 过路费. */
  sub?: string;
  /** Space picks it. Exactly one cell is primary. */
  primary: boolean;
}

export interface PickPlan {
  /** The dock line saying what the lit cells mean. */
  hint: string;
  cells: PickCell[];
  /** Too many landings to light: cells show each option's default way and later forks are still asked. */
  asksLater: boolean;
  /** The engine's back-out answer (Esc), when the ask has one. */
  cancelId?: string;
}

interface Landing {
  node: NodeId;
  route: string[];
  /** Paid the altar's pill to walk on through it. */
  borrowed: boolean;
  toll: number;
}

interface Candidate {
  id: string;
  landing: Landing;
  label: string;
  sub?: string;
  /** Lower wins when two answers reach the same cell. */
  rank: number;
  /** Its own digit (御骰符: the value itself), instead of its place in the list. */
  key?: string | null;
}

interface Ask {
  lead: string;
  candidates: Candidate[];
  defaultId?: string;
}

/** Null when this ask of the kind is not about cells (a target ask naming players). */
type Planner<K extends PickKind> = (g: Game, c: PendingChoiceOf<K>) => Ask | null;

const KEYS = 9;

const PLANNERS: { [K in PickKind]: Planner<K> } = {
  fork: (g, c) => ({
    lead: `岔路口，还剩 ${c.ctx.remaining} 步。`,
    candidates: c.options.flatMap((o) => byLanding(g, o.id, stepInto(g, c.player, c.ctx.node!, o.value, c.ctx.remaining!))),
    defaultId: c.defaultId,
  }),
  exitRoad: (g, c) => ({
    lead: `离开白泽灵台，走 ${c.ctx.remaining} 步。`,
    candidates: c.options.flatMap((o) => byLanding(g, o.id, stepInto(g, c.player, ALTAR, o.value, c.ctx.remaining!))),
  }),
  altarPass: (g, c) => ({
    lead: `停在白泽灵台，或付 ${g.data.config.altarToll} 颗丹药借道再走 ${c.ctx.remaining} 步。`,
    candidates: c.options.flatMap((o) => (o.value === 'stop'
      ? [landed(o.id, { node: ALTAR, route: [], borrowed: false, toll: 0 }, '停留')]
      : byLanding(g, o.id, stepInto(g, c.player, ALTAR, o.value, c.ctx.remaining!, true)))),
    defaultId: c.defaultId,
  }),
  adjust: (g, c) => ({
    lead: `掷出 ${c.ctx.base}，选最终步数。`,
    candidates: c.options.flatMap((o) => walkFrom(g, c.player, o.value.steps).map((l) => ({
      id: o.id,
      landing: l,
      label: `${o.value.steps} 步`,
      sub: costLine(o.value.card || o.value.steer !== 0 ? o.hint : undefined, l),
      rank: o.id === c.defaultId ? 0 : o.value.card ? 2 : 1,
    }))),
    defaultId: c.defaultId,
  }),
  rollValue: (g, c) => ({
    lead: '御骰符：选本次点数。',
    candidates: c.options.flatMap((o) => walkFrom(g, c.player, o.value).map((l) => ({
      id: o.id, landing: l, label: `${o.value} 点`, sub: costLine(undefined, l), rank: 0, key: valueKey(o.value),
    }))),
  }),
  node: (g, c) => ({
    lead: `${c.title}：${c.desc ?? ''}。`,
    candidates: c.options.map((o) => landed(o.id, { node: o.value, route: [], borrowed: false, toll: 0 }, g.nodeName(o.value))),
  }),
  target: (g, c) => {
    const cells = c.options.filter((o) => o.id !== c.cancelId);
    if (!cells.every((o) => o.node)) return null;
    return {
      lead: `${c.title}：${c.desc ?? ''}。`,
      candidates: cells.map((o) => landed(o.id, { node: o.node!, route: [], borrowed: false, toll: 0 }, g.nodeName(o.node!))),
    };
  },
};

export function isPickKind(kind: ChoiceKind): kind is PickKind {
  return (PICK_KINDS as readonly ChoiceKind[]).includes(kind);
}

/**
 * The board version of a spatial ask, or null when the choice is not one. Every landing gets a cell while they
 * fit on the number keys. Past that each option keeps only the landing its default way reaches, and the forks
 * after it are asked when the walk gets there.
 */
export function pickPlan(g: Game, c: PendingChoice): PickPlan | null {
  if (!isPickKind(c.kind)) return null;
  const ask = (PLANNERS[c.kind] as Planner<PickKind>)(g, c as PendingChoiceOf<PickKind>);
  if (!ask) return null;
  const every = distinct(ask.candidates);
  const asksLater = every.length > KEYS;
  const cells = toCells(asksLater ? distinct(defaultWays(ask.candidates)) : every, ask.defaultId);
  const primary = cells.find((cell) => cell.primary)!;
  const space = primary.key ? `空格选 ${primary.key}。` : '空格选金色那格。';
  const later = asksLater ? '后面的岔路到了再选。' : '';
  const esc = c.cancelId ? 'Esc 取消。' : '';
  return { hint: `${ask.lead}点击发光的格子或按数字键，${space}${later}${esc}`, cells, asksLater, cancelId: c.cancelId };
}

/** The best-ranked answer reaching each node, the one paying less 过路费 on a tie, in option order. */
function distinct(candidates: Candidate[]): Candidate[] {
  const best = new Map<NodeId, Candidate>();
  const ranked = candidates.map((c, order) => ({ c, order }))
    .sort((a, b) => a.c.rank - b.c.rank || a.c.landing.toll - b.c.landing.toll || a.order - b.order);
  for (const { c } of ranked) if (!best.has(c.landing.node)) best.set(c.landing.node, c);
  return candidates.filter((c) => best.get(c.landing.node) === c);
}

/** Each option's first landing (the walk taking every later default), with no route: those asks stay open. */
function defaultWays(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.flatMap((c) => {
    if (seen.has(c.id)) return [];
    seen.add(c.id);
    return [{ ...c, landing: { ...c.landing, route: [] } }];
  });
}

/** Keyed by the option's own digit where it has one, else 1–9 in order. */
function toCells(kept: Candidate[], defaultId: string | undefined): PickCell[] {
  const primaryAt = Math.max(0, kept.findIndex((c) => c.id === defaultId));
  const taken = new Set<string>();
  return kept.map((c, i) => {
    const want = c.key === undefined ? (i < KEYS ? String(i + 1) : null) : c.key;
    const key = want && !taken.has(want) ? want : null;
    if (key) taken.add(key);
    const { node, route, toll } = c.landing;
    return { node, id: c.id, route, key, label: c.label, toll, sub: c.sub, primary: i === primaryAt };
  });
}

function byLanding(g: Game, id: string, landings: Landing[]): Candidate[] {
  return landings.map((l) => landed(id, l, g.nodeName(l.node)));
}

function landed(id: string, landing: Landing, label: string): Candidate {
  return { id, landing, label, sub: costLine(undefined, landing), rank: landing.borrowed ? 1 : 0 };
}

/** 2–9 by their digit, 10 by 0; 11 and 12 are click-only. */
function valueKey(v: number): string | null {
  return v <= 9 ? String(v) : v === 10 ? '0' : null;
}

function costLine(how: string | undefined, l: Landing): string | undefined {
  return [how, l.borrowed ? '借道' : '', l.toll ? `过路费 ${l.toll}` : ''].filter(Boolean).join(' · ') || undefined;
}

/** Every place a move of `steps` from the seat's cell can end, one entry per way through the forks. */
function walkFrom(g: Game, seat: number, steps: number): Landing[] {
  const p = g.state.players[seat];
  const w = new Walker(g, seat);
  const total = p.dazed ? Math.max(1, Math.floor(steps / 2)) : steps;
  const exits = p.pos === ALTAR ? g.board.node(ALTAR).next : g.board.exits(p.pos, g.board.isTwoWay(p.pos) ? p.cameFrom : null, w.dir);
  return w.branch(p.pos, exits, total, { route: [], pills: p.pills, stones: p.stones, borrowed: false, toll: 0 });
}

/** The walk after stepping from `from` into `to` with `remaining` steps left before that step. */
function stepInto(g: Game, seat: number, from: NodeId, to: NodeId, remaining: number, borrowed = false): Landing[] {
  const w = new Walker(g, seat);
  const p = g.state.players[seat];
  return w.walk(from, to, remaining, { route: [], pills: p.pills - (borrowed ? w.fee : 0), stones: p.stones, borrowed, toll: 0 });
}

/** One way through the forks so far: the answers it took, the pills and stones it has left, what it paid on the way. */
interface Trail {
  route: string[];
  pills: number;
  stones: number;
  borrowed: boolean;
  toll: number;
}

/** Game.walk for one seat, every branch at once. */
class Walker {
  readonly dir: 1 | -1;
  readonly fee: number;

  constructor(private g: Game, private seat: number) {
    this.dir = g.state.turn.reverse ? -1 : 1;
    this.fee = g.data.config.altarToll;
  }

  branch(from: NodeId, exits: NodeId[], remaining: number, t: Trail): Landing[] {
    if (exits.length === 1) return this.walk(from, exits[0], remaining, t);
    return exits.flatMap((x) => this.walk(from, x, remaining, { ...t, route: [...t.route, x] }));
  }

  walk(from: NodeId, to: NodeId, remaining: number, t: Trail): Landing[] {
    const g = this.g;
    const left = remaining - 1;
    const rb = g.state.roadblock;
    const stones = t.stones + (g.board.node(to).type === 'start' && left > 0 ? g.data.config.salaryPass : 0);
    if (left === 0 || (rb && rb.node === to && rb.seat !== this.seat)) return [landing(to, t)];
    const fee = Math.min(stones, passToll(g.state, g.board, g.data, to, this.seat));
    const paid = { ...t, stones: stones - fee, toll: t.toll + fee };
    if (to === ALTAR) return this.altar(left, paid);
    return this.branch(to, g.board.exits(to, from, this.dir), left, paid);
  }

  /** Reaching the altar with steps left: stop there, or pay the pill and leave by any road. */
  private altar(left: number, t: Trail): Landing[] {
    if (t.pills < this.fee) return [landing(ALTAR, t)];
    const stop = landing(ALTAR, { ...t, route: [...t.route, 'stop'] });
    const roads = this.g.board.node(ALTAR).next.flatMap((x) => this.walk(ALTAR, x, left, { ...t, route: [...t.route, x], pills: t.pills - this.fee, borrowed: true }));
    return [stop, ...roads];
  }
}

function landing(node: NodeId, t: Trail): Landing {
  return { node, route: t.route, borrowed: t.borrowed, toll: t.toll };
}
