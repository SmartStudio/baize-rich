// Board validator and ASCII render for data/board.json (pure TS, no Phaser).
//   checkBoard(data) → list of problems (empty = valid)
//   renderBoard(data) → grid picture + per-region summary for review
// CLI: npm run board
import { ALTAR, Board, REGION_IDS } from '../core/board';
import type { BoardData, NodeId, TileType } from '../core/types';

const GLYPH: Record<TileType, string> = {
  start: 'S', land: '.', gate: 'G', trial: 'T', spring: '~', market: '$', furnace: '%', cliff: 'X', array: 'A', shrine: '+', altar: '@',
};

type State = { node: NodeId; from: NodeId | null };
const key = (s: State) => `${s.node}<${s.from ?? ''}`;

/** Where a forward walker may go from a state. The altar lists every exit (exitRoad / altarPass ignore the way in). */
function forward(b: Board, s: State): NodeId[] {
  if (s.node === ALTAR) return b.node(ALTAR).next;
  return b.exits(s.node, s.from, 1);
}

function cellsOf(n: BoardData['nodes'][number]): [number, number][] {
  if (!n.rect) return [n.pos];
  const [c0, r0, c1, r1] = n.rect;
  const out: [number, number][] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push([c, r]);
  return out;
}

export function checkBoard(data: BoardData): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of data.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate id ${n.id}`);
    ids.add(n.id);
  }
  for (const n of data.nodes) {
    if (n.next.length === 0) problems.push(`${n.id} has no next`);
    for (const x of n.next) if (!ids.has(x)) problems.push(`${n.id} → unknown ${x}`);
    if (new Set(n.next).size !== n.next.length) problems.push(`${n.id} lists a next twice`);
  }
  if (problems.length) return problems; // the Board class cannot be built

  const count = (t: TileType) => data.nodes.filter((n) => n.type === t).length;
  if (count('start') !== 1) problems.push(`expected 1 start, found ${count('start')}`);
  if (count('cliff') !== 1) problems.push(`expected 1 cliff, found ${count('cliff')}`);
  if (count('altar') !== 1) problems.push(`expected 1 altar, found ${count('altar')}`);
  const altar = data.nodes.find((n) => n.id === ALTAR);
  if (!altar || altar.type !== 'altar' || !altar.rect) problems.push(`node ${ALTAR} must be the altar with a rect`);
  if (problems.length) return problems;

  const b = new Board(data);

  // Geometry: inside the grid, no overlap, edges are straight unobstructed runs.
  const { cols, rows } = data.grid;
  const at = new Map<string, NodeId>();
  for (const n of data.nodes) {
    for (const [c, r] of cellsOf(n)) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) problems.push(`${n.id} cell ${c},${r} outside ${cols}x${rows}`);
      const k = `${c},${r}`;
      if (at.has(k)) problems.push(`${n.id} overlaps ${at.get(k)} at ${k}`);
      at.set(k, n.id);
    }
    if (n.rect && (n.pos[0] < n.rect[0] || n.pos[0] > n.rect[2] || n.pos[1] < n.rect[1] || n.pos[1] > n.rect[3])) problems.push(`${n.id} pos outside its rect`);
  }
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const n of data.nodes) {
    for (const x of n.next) {
      const m = byId.get(x)!;
      if (n.rect || m.rect) {
        const box = (n.rect ?? m.rect)!;
        const [c, r] = (n.rect ? m : n).pos;
        const touches = (c >= box[0] && c <= box[2] && (r === box[1] - 1 || r === box[3] + 1)) || (r >= box[1] && r <= box[3] && (c === box[0] - 1 || c === box[2] + 1));
        if (!touches) problems.push(`edge ${n.id}→${x} does not touch the altar rect`);
        continue;
      }
      const [c0, r0] = n.pos;
      const [c1, r1] = m.pos;
      if (c0 !== c1 && r0 !== r1) { problems.push(`edge ${n.id}→${x} is diagonal`); continue; }
      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      for (let c = c0 + dc, r = r0 + dr; c !== c1 || r !== r1; c += dc, r += dr) {
        if (at.has(`${c},${r}`)) problems.push(`edge ${n.id}→${x} runs through ${at.get(`${c},${r}`)}`);
      }
    }
  }

  // Movement: explore (node, cameFrom) states from the start; no dead ends, every node reachable, every state can get home.
  const seen = new Map<string, State>();
  const succ = new Map<string, string[]>();
  const queue: State[] = [];
  const push = (s: State) => { if (!seen.has(key(s))) { seen.set(key(s), s); queue.push(s); } };
  push({ node: b.startId, from: null });
  for (const id of b.allNodeIds()) push({ node: id, from: null }); // teleports (cliff, 缩地成寸, 遁地符) land with no heading
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    const outs = forward(b, s);
    if (outs.length === 0) problems.push(`dead end at ${s.node} (came from ${s.from ?? '-'})`);
    const ks: string[] = [];
    for (const x of outs) { const t = { node: x, from: s.node }; push(t); ks.push(key(t)); }
    succ.set(key(s), ks);
  }
  const reach = new Set<NodeId>();
  const fromStart = [key({ node: b.startId, from: null })];
  const vis = new Set(fromStart);
  for (let i = 0; i < fromStart.length; i++) {
    reach.add(seen.get(fromStart[i])!.node);
    for (const k of succ.get(fromStart[i]) ?? []) if (!vis.has(k)) { vis.add(k); fromStart.push(k); }
  }
  for (const id of b.allNodeIds()) if (!reach.has(id)) problems.push(`${id} is not reachable from the start`);
  const pred = new Map<string, string[]>();
  for (const [k, ks] of succ) for (const t of ks) (pred.get(t) ?? pred.set(t, []).get(t)!).push(k);
  const home = [...seen.keys()].filter((k) => seen.get(k)!.node === b.startId);
  const back = new Set(home);
  for (let i = 0; i < home.length; i++) for (const k of pred.get(home[i]) ?? []) if (!back.has(k)) { back.add(k); home.push(k); }
  for (const k of seen.keys()) if (!back.has(k)) problems.push(`cannot return to the start from ${k}`);
  // Reverse moves (逆行符, 迷踪) follow prev and never turn back on a two-way node.
  for (const id of b.allNodeIds()) {
    const n = b.node(id);
    if (n.prev.length === 0 || (b.isTwoWay(id) && id !== ALTAR && n.prev.length < 2)) problems.push(`reverse dead end at ${id}`);
  }

  // Main line: every road-network node finds a gate ahead (遁地符), and the demon's path never stalls.
  for (const id of b.allNodeIds()) {
    if (!b.node(id).outer) continue;
    try { b.pathToGate(id); } catch { problems.push(`no gate on the main line after ${id}`); }
  }

  // Lands and streets.
  const streets = data.streets ?? {};
  const names = new Set<string>();
  for (const n of data.nodes) {
    if (n.type !== 'land') continue;
    if (!n.region || !n.name || !n.price || n.price <= 0) problems.push(`land ${n.id} needs region, name and price`);
    if (n.name && names.has(n.name)) problems.push(`land name ${n.name} used twice`);
    if (n.name) names.add(n.name);
    if (!n.street || !streets[n.street]) problems.push(`land ${n.id} has no valid street`);
    else if (streets[n.street].region !== n.region) problems.push(`land ${n.id} street ${n.street} is in another region`);
  }

  // Districts: what each region must hold. A 神道 spring counts for the region its corridor opens onto.
  const roadRegion = new Map<NodeId, string | undefined>();
  for (const x of b.node(ALTAR).next) {
    const end = b.node(b.corridorEnd(ALTAR, x)).region;
    for (const id of corridor(b, x)) roadRegion.set(id, end);
  }
  const regionOf = (id: NodeId) => b.node(id).region ?? roadRegion.get(id);
  for (const r of REGION_IDS) {
    const mine = b.allNodeIds().filter((id) => regionOf(id) === r);
    const has = (t: TileType) => mine.filter((id) => b.node(id).type === t).length;
    const forks = mine.filter((id) => b.node(id).next.length > 1).length;
    if (forks < 2) problems.push(`${r}: ${forks} forks (need ≥2)`);
    for (const t of ['spring', 'furnace', 'trial', 'market'] as TileType[]) if (has(t) < 1) problems.push(`${r}: no ${t}`);
    const st = Object.entries(streets).filter(([, s]) => s.region === r);
    if (st.length < 3) problems.push(`${r}: ${st.length} streets (need 3)`);
    for (const [sid] of st) {
      const k = data.nodes.filter((n) => n.street === sid).length;
      if (k < 3 || k > 5) problems.push(`street ${sid} has ${k} lands (need 3–5)`);
    }
  }
  return problems;
}

/** The two-way nodes of the corridor that leaves the altar through `exit`. */
function corridor(b: Board, exit: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let prev = ALTAR;
  let cur = exit;
  for (let k = 0; k < b.nodes.size && b.isTwoWay(cur); k++) {
    out.push(cur);
    [prev, cur] = [cur, b.exits(cur, prev, 1)[0]];
  }
  return out;
}

/** Steps around the main line from the start back to it. */
export function mainLap(data: BoardData): number {
  const b = new Board(data);
  let cur = b.startId;
  for (let k = 1; k <= b.nodes.size; k++) {
    cur = b.mainStep(cur, 1);
    if (cur === b.startId) return k;
  }
  return -1;
}

export function renderBoard(data: BoardData): string {
  const { cols, rows } = data.grid;
  const cell = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '     '));
  for (const n of data.nodes) {
    if (n.rect) for (const [c, r] of cellsOf(n)) cell[r][c] = ' ::: ';
    const [c, r] = n.pos;
    cell[r][c] = n.rect ? 'ALTAR' : `${GLYPH[n.type]}${n.id}`.padEnd(5);
  }
  const lines = cell.map((row, r) => `${String(r).padStart(2)} ${row.join('')}`);
  lines.unshift('   ' + Array.from({ length: cols }, (_, c) => String(c).padEnd(5)).join(''));
  const b = new Board(data);
  const out = [lines.join('\n'), '', `glyphs: ${Object.entries(GLYPH).map(([t, g]) => `${g}=${t}`).join(' ')}`];
  out.push(`nodes ${data.nodes.length}, lands ${b.lands.length}, streets ${Object.keys(data.streets ?? {}).length}, main lap ${mainLap(data)} steps`);
  out.push(`forks: ${b.allNodeIds().filter((id) => b.node(id).next.length > 1).map((id) => `${id}→${b.node(id).next.join('|')}`).join('  ')}`);
  for (const r of REGION_IDS) {
    const lands = b.landsInRegion(r).map((id) => b.node(id).price!);
    const st = Object.entries(data.streets ?? {}).filter(([, s]) => s.region === r).map(([sid, s]) => `${s.name}×${data.nodes.filter((n) => n.street === sid).length}`);
    out.push(`${r}: ${lands.length} lands, price ${Math.min(...lands)}–${Math.max(...lands)} (sum ${lands.reduce((a, x) => a + x, 0)}), streets ${st.join(' ')}`);
  }
  return out.join('\n');
}
