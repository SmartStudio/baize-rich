// Choices that only decide where a token goes, asked on the board instead of in a modal: the cells each
// answer leads to, their number keys and labels, and the dock line. Pure, so GameScene and the tests share it.
// The walk projection mirrors Game.walk: forks branch, the altar stops a walk unless its toll is paid,
// a 镇山 mountain stops it, 迷魂丹 halves the steps.
import { ALTAR } from '../core/board';
import type { ChoiceKind, PendingChoice, PendingChoiceOf } from '../core/choices';
import type { Game } from '../core/engine';
import type { NodeId } from '../core/types';

export const PICK_KINDS = ['fork', 'exitRoad', 'altarPass', 'adjust', 'rollValue', 'node'] as const;
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
  /** A cost the label alone hides: 神行符 spent, the altar toll. */
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
}

interface Landing {
  node: NodeId;
  route: string[];
  toll: boolean;
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

type Planner<K extends PickKind> = (g: Game, c: PendingChoiceOf<K>) => Ask;

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
      ? [landed(o.id, { node: ALTAR, route: [], toll: false }, '停留')]
      : byLanding(g, o.id, stepInto(g, c.player, ALTAR, o.value, c.ctx.remaining!, true)))),
    defaultId: c.defaultId,
  }),
  adjust: (g, c) => ({
    lead: `掷出 ${c.ctx.base}，选最终步数。`,
    candidates: c.options.flatMap((o) => walkFrom(g, c.player, o.value.steps).map((l) => ({
      id: o.id,
      landing: l,
      label: `${o.value.steps} 步`,
      sub: costLine(o.value.card || o.value.steer !== 0 ? o.hint : undefined, l.toll),
      rank: o.id === c.defaultId ? 0 : o.value.card ? 2 : 1,
    }))),
    defaultId: c.defaultId,
  }),
  rollValue: (g, c) => ({
    lead: '御骰符：选本次点数。',
    candidates: c.options.flatMap((o) => walkFrom(g, c.player, o.value).map((l) => ({
      id: o.id, landing: l, label: `${o.value} 点`, sub: costLine(undefined, l.toll), rank: 0, key: valueKey(o.value),
    }))),
  }),
  node: (g, c) => ({
    lead: `${c.title}：${c.desc ?? ''}。`,
    candidates: c.options.map((o) => landed(o.id, { node: o.value, route: [], toll: false }, g.nodeName(o.value))),
  }),
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
  const every = distinct(ask.candidates);
  const asksLater = every.length > KEYS;
  const cells = toCells(asksLater ? distinct(defaultWays(ask.candidates)) : every, ask.defaultId);
  const primary = cells.find((cell) => cell.primary)!;
  const space = primary.key ? `空格选 ${primary.key}。` : '空格选金色那格。';
  const later = asksLater ? '后面的岔路到了再选。' : '';
  return { hint: `${ask.lead}点击发光的格子或按数字键，${space}${later}`, cells, asksLater };
}

/** The best-ranked answer reaching each node, in option order. */
function distinct(candidates: Candidate[]): Candidate[] {
  const best = new Map<NodeId, Candidate>();
  const ranked = candidates.map((c, order) => ({ c, order })).sort((a, b) => a.c.rank - b.c.rank || a.order - b.order);
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
    return { node: c.landing.node, id: c.id, route: c.landing.route, key, label: c.label, sub: c.sub, primary: i === primaryAt };
  });
}

function byLanding(g: Game, id: string, landings: Landing[]): Candidate[] {
  return landings.map((l) => landed(id, l, g.nodeName(l.node)));
}

function landed(id: string, landing: Landing, label: string): Candidate {
  return { id, landing, label, sub: costLine(undefined, landing.toll), rank: landing.toll ? 1 : 0 };
}

/** 2–9 by their digit, 10 by 0; 11 and 12 are click-only. */
function valueKey(v: number): string | null {
  return v <= 9 ? String(v) : v === 10 ? '0' : null;
}

function costLine(how: string | undefined, toll: boolean): string | undefined {
  return [how, toll ? '借道' : ''].filter(Boolean).join(' · ') || undefined;
}

/** Every place a move of `steps` from the seat's cell can end, one entry per way through the forks. */
export function walkFrom(g: Game, seat: number, steps: number): Landing[] {
  const p = g.state.players[seat];
  const total = p.dazed ? Math.max(1, Math.floor(steps / 2)) : steps;
  const at = p.pos;
  const exits = at === ALTAR ? g.board.node(ALTAR).next : g.board.exits(at, g.board.isTwoWay(at) ? p.cameFrom : null, dir(g));
  return branch(g, seat, at, exits, total, [], p.pills, false);
}

/** The walk after stepping from `from` into `to` with `remaining` steps left before that step. */
function stepInto(g: Game, seat: number, from: NodeId, to: NodeId, remaining: number, toll = false): Landing[] {
  const pills = g.state.players[seat].pills - (toll ? g.data.config.altarToll : 0);
  return walk(g, seat, from, to, remaining, [], pills, toll);
}

function branch(g: Game, seat: number, from: NodeId, exits: NodeId[], remaining: number, route: string[], pills: number, toll: boolean): Landing[] {
  if (exits.length === 1) return walk(g, seat, from, exits[0], remaining, route, pills, toll);
  return exits.flatMap((x) => walk(g, seat, from, x, remaining, [...route, x], pills, toll));
}

function walk(g: Game, seat: number, from: NodeId, to: NodeId, remaining: number, route: string[], pills: number, toll: boolean): Landing[] {
  const left = remaining - 1;
  const rb = g.state.roadblock;
  if (left === 0 || (rb && rb.node === to && rb.seat !== seat)) return [{ node: to, route, toll }];
  if (to === ALTAR) return altar(g, seat, left, route, pills, toll);
  return branch(g, seat, to, g.board.exits(to, from, dir(g)), left, route, pills, toll);
}

/** Reaching the altar with steps left: stop there, or pay the toll and leave by any road. */
function altar(g: Game, seat: number, left: number, route: string[], pills: number, toll: boolean): Landing[] {
  const fee = g.data.config.altarToll;
  if (pills < fee) return [{ node: ALTAR, route, toll }];
  const stop = { node: ALTAR, route: [...route, 'stop'], toll };
  const roads = g.board.node(ALTAR).next.flatMap((x) => walk(g, seat, ALTAR, x, left, [...route, x], pills - fee, true));
  return [stop, ...roads];
}

function dir(g: Game): 1 | -1 {
  return g.state.turn.reverse ? -1 : 1;
}
