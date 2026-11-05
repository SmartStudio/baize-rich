// Lightweight movement predictor for AI look-ahead. Mirrors engine.walk() rules
// (forks, roads, altar stop/toll, mire, 镇山 roadblock, slide, start salary) without mutating
// state or asking anybody; fork / altar decisions come from a policy callback.
import { ALTAR, type Board } from '../core/board';
import type { GameState, NodeId, RoadId } from '../core/types';

export interface WalkPolicy {
  /** Take the road at this gate with `remaining` steps left? */
  fork(gate: NodeId, remaining: number): boolean;
  /** At the altar with steps left: 'stop' or a road to borrow through. */
  altar(remaining: number): 'stop' | RoadId;
  /** Road to leave the altar by (when starting on it). */
  exitRoad: RoadId;
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
  let remaining = steps;
  let mode: 'ring' | 'in' | 'out';
  let road: RoadId | null = null;
  let noForkAt: NodeId | null = null;
  let mireUsed = state.turn.seat === seat ? state.turn.mireUsed : false;
  let passStart = 0;
  let stoppedAtAltar = false;
  let blocked = false;
  const rb = state.roadblock;
  const path = [node];
  if (node === ALTAR) { road = policy.exitRoad; mode = 'out'; }
  else if (board.isRoadNode(node)) { road = board.node(node).road!; mode = (from ? 'in' : p.roadDir); }
  else mode = 'ring';
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    if (mode === 'ring' && board.node(node).type === 'gate' && node !== noForkAt && policy.fork(node, remaining)) {
      mode = 'in';
      road = board.node(node).road!;
    }
    let next: NodeId;
    if (mode === 'ring') next = board.ringStep(node, dir);
    else if (mode === 'in') next = board.roadInward(node, road!);
    else {
      next = board.roadOutward(node, road!);
      if (board.node(next).type === 'gate') { mode = 'ring'; noForkAt = next; }
    }
    remaining--;
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
        else { mode = 'out'; road = ch; }
      } else { remaining = 0; stoppedAtAltar = true; }
    }
  }
  const fin = board.node(node);
  if (mode === 'ring' && !blocked && fin.type === 'land' && fin.region === 'water') {
    node = board.ringStep(node, dir);
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
