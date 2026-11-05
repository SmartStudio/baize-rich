// Board graph built from data/board.json: nodes linked by directed `next` edges.
//
//   Forward moves follow `next`; more than one entry is a fork, next[0] is the main line.
//   Reverse moves follow `prev`, derived from `next` in data order.
//   A node whose next and prev hold the same nodes is two-way (the 神道 and the altar):
//   walks never turn back on it, so the node a walker came from fixes its heading.
//   The altar is the single node 'ALTAR'; its `rect` is only for drawing.
import type { BoardData, NodeId, RegionId, RoadId, TileType } from './types';

export interface BoardNode {
  id: NodeId;
  type: TileType;
  /** Grid cell (col,row). For the altar this is the centre cell. */
  pos: [number, number];
  name: string;
  region?: RegionId;
  price?: number;
  road?: RoadId;
  outer: boolean;
  next: NodeId[];
  prev: NodeId[];
}

export const ALTAR: NodeId = 'ALTAR';
export const REGION_IDS: RegionId[] = ['wood', 'fire', 'water', 'earth'];

export class Board {
  readonly nodes = new Map<NodeId, BoardNode>();
  readonly lands: NodeId[] = [];
  readonly startId: NodeId;
  readonly cliffId: NodeId;
  private readonly toAltar = new Map<NodeId, number>();

  constructor(readonly data: BoardData) {
    for (const t of data.nodes) {
      this.nodes.set(t.id, {
        id: t.id, type: t.type, pos: t.pos, name: t.name ?? data.tileTypes[t.type].name,
        region: t.region, price: t.price, road: t.road, outer: t.outer ?? false, next: t.next, prev: [],
      });
      if (t.type === 'land') this.lands.push(t.id);
    }
    for (const n of this.nodes.values()) {
      if (n.next.length === 0) throw new Error(`board node ${n.id} has no next`);
      for (const x of n.next) this.node(x).prev.push(n.id);
    }
    if (this.node(ALTAR).type !== 'altar') throw new Error(`${ALTAR} must be the altar`);
    this.startId = this.firstOfType('start');
    this.cliffId = this.firstOfType('cliff');
    const queue = [ALTAR];
    this.toAltar.set(ALTAR, 0);
    for (let i = 0; i < queue.length; i++) {
      const d = this.toAltar.get(queue[i])! + 1;
      for (const p of this.node(queue[i]).prev) {
        if (!this.toAltar.has(p)) { this.toAltar.set(p, d); queue.push(p); }
      }
    }
  }

  private firstOfType(type: TileType): NodeId {
    const id = this.allNodeIds().find((x) => this.node(x).type === type);
    if (!id) throw new Error(`board has no ${type} node`);
    return id;
  }

  node(id: NodeId): BoardNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  allNodeIds(): NodeId[] {
    return [...this.nodes.keys()];
  }

  isTwoWay(id: NodeId): boolean {
    const n = this.node(id);
    return n.next.length === n.prev.length && n.next.every((x) => n.prev.includes(x));
  }

  /**
   * Where a walker on `id` may step next in direction dir, never straight back to `cameFrom`.
   * Without `cameFrom` a two-way node heads along its main line.
   */
  exits(id: NodeId, cameFrom: NodeId | null, dir: 1 | -1): NodeId[] {
    const n = this.node(id);
    if (cameFrom === null) return this.isTwoWay(id) ? [n.next[0]] : dir === 1 ? n.next : n.prev;
    return (dir === 1 ? n.next : n.prev).filter((x) => x !== cameFrom);
  }

  /** One step along the main line (first next / first prev). */
  mainStep(id: NodeId, dir: 1 | -1): NodeId {
    const n = this.node(id);
    return (dir === 1 ? n.next : n.prev)[0];
  }

  /** Main-line nodes after `id` up to and including the first gate. */
  pathToGate(id: NodeId): NodeId[] {
    const path: NodeId[] = [];
    let cur = id;
    for (let k = 0; k < this.nodes.size; k++) {
      cur = this.mainStep(cur, 1);
      path.push(cur);
      if (this.node(cur).type === 'gate') return path;
    }
    throw new Error(`no gate ahead of ${id}`);
  }

  /** Fewest steps between two outer nodes over outer nodes in either direction (-1 if either is off the outer ring). */
  outerDistance(a: NodeId, b: NodeId): number {
    if (!this.node(a).outer || !this.node(b).outer) return -1;
    const dist = new Map([[a, 0]]);
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (cur === b) return dist.get(cur)!;
      const n = this.node(cur);
      for (const x of [...n.next, ...n.prev]) {
        if (this.node(x).outer && !dist.has(x)) { dist.set(x, dist.get(cur)! + 1); queue.push(x); }
      }
    }
    return -1;
  }

  /** Fewest steps between two nodes along edges in either direction (Infinity if unconnected). */
  distance(a: NodeId, b: NodeId): number {
    const dist = new Map([[a, 0]]);
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (cur === b) return dist.get(cur)!;
      const n = this.node(cur);
      for (const x of [...n.next, ...n.prev]) if (!dist.has(x)) { dist.set(x, dist.get(cur)! + 1); queue.push(x); }
    }
    return Infinity;
  }

  /** Steps forward to the altar along the shortest route (Infinity if it cannot be reached). */
  altarDistance(id: NodeId): number {
    return this.toAltar.get(id) ?? Infinity;
  }

  /** The node that leads to the altar fastest; ties keep the earlier one. */
  altarward(options: NodeId[]): NodeId {
    return options.reduce((best, x) => (this.altarDistance(x) < this.altarDistance(best) ? x : best));
  }

  /** Follows two-way nodes from `from` through `to` and returns the first node that is not two-way. */
  corridorEnd(from: NodeId, to: NodeId): NodeId {
    let prev = from;
    let cur = to;
    for (let k = 0; k < this.nodes.size && this.isTwoWay(cur); k++) [prev, cur] = [cur, this.exits(cur, prev, 1)[0]];
    return cur;
  }

  roadName(road: RoadId): string {
    return this.data.roads[road].name;
  }

  regionNodes(region: RegionId): NodeId[] {
    return this.allNodeIds().filter((id) => this.node(id).region === region);
  }

  landsInRegion(region: RegionId): NodeId[] {
    return this.lands.filter((id) => this.node(id).region === region);
  }
}
