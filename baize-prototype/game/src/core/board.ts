// Board graph built from data/board.json.
//
//   Ring  R0..R31, clockwise = increasing index (wraps).
//   Roads gate(Rx) -> X1 (trial) -> X2 (spring) -> ALTAR   (inward)
//         ALTAR -> X2 -> X1 -> gate -> ring                 (outward)
//   Altar a single logical node 'ALTAR' occupying a 3×3 rect.
import type { BoardData, NodeId, RegionId, RoadId, TileType } from './types';

export interface BoardNode {
  id: NodeId;
  type: TileType;
  /** Grid cell (col,row). For the altar this is the centre cell. */
  pos: [number, number];
  name: string;
  region?: RegionId;
  price?: number;
  /** For gates: the road that starts here. For road nodes: the road they belong to. */
  road?: RoadId;
  /** Ring index (0..31) or -1 for road/altar nodes. */
  ringIndex: number;
  /** Road nodes: 1 = first (outer) node, 2 = second (inner) node. */
  roadStep?: 1 | 2;
}

export const ALTAR: NodeId = 'ALTAR';
export const ROAD_IDS: RoadId[] = ['S', 'W', 'N', 'E'];
export const REGION_IDS: RegionId[] = ['wood', 'fire', 'water', 'earth'];

export class Board {
  readonly nodes = new Map<NodeId, BoardNode>();
  readonly ring: NodeId[] = [];
  readonly roads: Record<RoadId, { gate: NodeId; nodes: [NodeId, NodeId] }>;
  readonly lands: NodeId[] = [];
  readonly startId: NodeId;
  readonly cliffId: NodeId;

  constructor(readonly data: BoardData) {
    for (const t of data.ring) {
      const idx = this.ring.length;
      this.ring.push(t.id);
      const name = t.name ?? data.tileTypes[t.type].name;
      this.nodes.set(t.id, {
        id: t.id, type: t.type, pos: t.pos, name, region: t.region, price: t.price, road: t.road, ringIndex: idx,
      });
      if (t.type === 'land') this.lands.push(t.id);
    }
    const roads = {} as Record<RoadId, { gate: NodeId; nodes: [NodeId, NodeId] }>;
    for (const rid of Object.keys(data.roads) as RoadId[]) {
      const r = data.roads[rid];
      r.nodes.forEach((n, i) => {
        this.nodes.set(n.id, {
          id: n.id, type: n.type, pos: n.pos, name: data.tileTypes[n.type].name, road: rid, ringIndex: -1,
          roadStep: (i + 1) as 1 | 2,
        });
      });
      roads[rid] = { gate: r.gate, nodes: [r.nodes[0].id, r.nodes[1].id] };
    }
    this.roads = roads;
    const [c0, r0, c1, r1] = data.altar.rect;
    this.nodes.set(ALTAR, {
      id: ALTAR, type: 'altar', pos: [Math.floor((c0 + c1) / 2), Math.floor((r0 + r1) / 2)],
      name: data.tileTypes.altar.name, ringIndex: -1,
    });
    this.startId = this.ring.find((id) => this.node(id).type === 'start')!;
    this.cliffId = this.ring.find((id) => this.node(id).type === 'cliff')!;
  }

  node(id: NodeId): BoardNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  allNodeIds(): NodeId[] {
    return [...this.nodes.keys()];
  }

  isRing(id: NodeId): boolean {
    return this.node(id).ringIndex >= 0;
  }

  isRoadNode(id: NodeId): boolean {
    const n = this.node(id);
    return n.ringIndex < 0 && n.type !== 'altar';
  }

  /** Next ring node in direction dir (+1 clockwise / -1 counter-clockwise). */
  ringStep(id: NodeId, dir: 1 | -1): NodeId {
    const i = this.node(id).ringIndex;
    if (i < 0) throw new Error(`${id} is not on the ring`);
    const n = this.ring.length;
    return this.ring[(((i + dir) % n) + n) % n];
  }

  gateOf(road: RoadId): NodeId {
    return this.roads[road].gate;
  }

  /** Inward successor on a road: gate->X1, X1->X2, X2->ALTAR. */
  roadInward(id: NodeId, road: RoadId): NodeId {
    const [x1, x2] = this.roads[road].nodes;
    if (id === this.roads[road].gate) return x1;
    if (id === x1) return x2;
    if (id === x2) return ALTAR;
    throw new Error(`${id} not on road ${road}`);
  }

  /** Outward successor on a road: ALTAR->X2, X2->X1, X1->gate. */
  roadOutward(id: NodeId, road: RoadId): NodeId {
    const [x1, x2] = this.roads[road].nodes;
    if (id === ALTAR) return x2;
    if (id === x2) return x1;
    if (id === x1) return this.roads[road].gate;
    throw new Error(`${id} not on road ${road}`);
  }

  landsInRegion(region: RegionId): NodeId[] {
    return this.lands.filter((id) => this.node(id).region === region);
  }

  /**
   * The "灵域 side" of a ring node, used by 缩地成寸 (move within the current region).
   * Each side of 8 cells (corner + 7 edge cells) maps to the region of its land tiles:
   * R0–R7 wood, R8–R15 fire, R16–R23 water, R24–R31 earth.
   */
  sideRegion(id: NodeId): RegionId | null {
    const i = this.node(id).ringIndex;
    if (i < 0) return null;
    const side = Math.floor(i / 8);
    for (let k = side * 8; k < side * 8 + 8; k++) {
      const r = this.node(this.ring[k]).region;
      if (r) return r;
    }
    return null;
  }

  sideNodes(region: RegionId): NodeId[] {
    return this.ring.filter((id) => this.sideRegion(id) === region);
  }

  /** Nearest gate strictly ahead on the ring in direction dir. */
  nearestGateAhead(id: NodeId, dir: 1 | -1): { gate: NodeId; path: NodeId[] } {
    const path: NodeId[] = [];
    let cur = id;
    for (let k = 0; k < this.ring.length; k++) {
      cur = this.ringStep(cur, dir);
      path.push(cur);
      if (this.node(cur).type === 'gate') return { gate: cur, path };
    }
    throw new Error('no gate on ring');
  }
}
