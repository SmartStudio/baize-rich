// Lightweight movement predictor for AI look-ahead. Mirrors engine.walk() rules
// (forks, altar stop/toll, mire, 镇山 roadblock, slide, start salary) without mutating
// state or asking anybody; fork / altar decisions come from a policy callback.
import { ALTAR, type Board } from '../core/board';
import type { GameState, NodeId } from '../core/types';

export interface WalkPolicy {
  /** Which of `options` to step to at a fork on `node` with `remaining` steps left. */
  fork(node: NodeId, remaining: number, options: NodeId[]): NodeId;
  /** At the altar with steps left: 'stop' or the neighbour to leave through. */
  altar(remaining: number): 'stop' | NodeId;
  /** Neighbour to leave the altar by when starting on it (default: the altar's first next). */
  exit?: NodeId;
  canPayToll: boolean;
}

export interface Prediction {
  node: NodeId;
  passStart: number;
  path: NodeId[];
  stoppedAtAltar: boolean;
}

export function predictWalk(
  board: Board, state: GameState, seat: number, steps: number, dir: 1 | -1, policy: WalkPolicy, from?: NodeId,
): Prediction {
  const p = state.players[seat];
  let node = from ?? p.pos;
  let cameFrom = !from && board.isTwoWay(node) ? p.cameFrom : null;
  let forced = node === ALTAR ? policy.exit ?? board.node(ALTAR).next[0] : null;
  let remaining = steps;
  let mireUsed = state.turn.seat === seat ? state.turn.mireUsed : false;
  let passStart = 0;
  let stoppedAtAltar = false;
  let blocked = false;
  const rb = state.roadblock;
  const path = [node];
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    let next = forced;
    forced = null;
    if (next === null) {
      const exits = board.exits(node, cameFrom, dir);
      next = exits.length > 1 ? policy.fork(node, remaining, exits) : exits[0];
    }
    remaining--;
    cameFrom = node;
    node = next;
    path.push(next);
    if (rb && rb.node === next && rb.seat !== seat) { blocked = true; break; }
    const n = board.node(next);
    if (n.type === 'start' && remaining > 0) passStart++;
    if (n.type === 'land' && n.region === 'earth' && !mireUsed) {
      mireUsed = true;
      if (remaining > 0) remaining--;
    }
    if (next === ALTAR) {
      if (remaining > 0 && policy.canPayToll) {
        const ch = policy.altar(remaining);
        if (ch === 'stop') { remaining = 0; stoppedAtAltar = true; }
        else forced = ch;
      } else { remaining = 0; stoppedAtAltar = true; }
    }
  }
  const fin = board.node(node);
  if (!blocked && fin.type === 'land' && fin.region === 'water') {
    node = board.exits(node, cameFrom, dir)[0];
    path.push(node);
  }
  return { node, passStart, path, stoppedAtAltar };
}

/** Probability of each 2d6 total. */
export const DICE_DIST: { total: number; p: number }[] = (() => {
  const out: { total: number; p: number }[] = [];
  for (let t = 2; t <= 12; t++) out.push({ total: t, p: (6 - Math.abs(t - 7)) / 36 });
  return out;
})();
