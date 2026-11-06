// Who is winning and how the game ends, in words for the realm race panel, the round line and the result screen.
// The order itself is core/rules compareStanding; this file only explains it.
import type { Board } from '../core/board';
import { compareStanding, totalAssets, winRealm } from '../core/rules';
import type { GameData, GameState } from '../core/types';

export type StandingStat = 'realm' | 'cult' | 'assets' | 'seat';

type StatValue = (state: GameState, board: Board, data: GameData, seat: number) => number;

/** The round-cap tie-break chain, in compareStanding's order. */
const STANDING: { stat: Exclude<StandingStat, 'seat'>; of: StatValue }[] = [
  { stat: 'realm', of: (s, _b, _d, i) => s.players[i].realm },
  { stat: 'cult', of: (s, _b, _d, i) => s.players[i].cult },
  { stat: 'assets', of: totalAssets },
];

export const STAT_LABEL: Record<StandingStat, string> = { realm: '境界', cult: '修为', assets: '总资产', seat: '座次' };

export type ChipTone = 'gold' | 'text' | 'dim';

export interface RoundChip {
  text: string;
  tone: ChipTone;
  detail: string;
}

export interface RaceRow {
  seat: number;
  /** 修为 per realm below 化神: realms already passed are full, the current one holds the seat's 修为. */
  cells: number[];
  ascended: boolean;
}

export interface RaceView {
  realms: { name: string; bar: number }[];
  goal: string;
  /** Best standing first. */
  rows: RaceRow[];
  lead: string;
}

/** Seats from first to last place. */
export function standings(state: GameState, board: Board, data: GameData): number[] {
  return state.players.map((p) => p.seat).sort((a, b) => compareStanding(state, board, data, a, b));
}

/** The first stat in the tie-break chain on which seats a and b differ. */
export function decidingStat(state: GameState, board: Board, data: GameData, a: number, b: number): StandingStat {
  return STANDING.find((s) => s.of(state, board, data, a) !== s.of(state, board, data, b))?.stat ?? 'seat';
}

export function winRule(data: GameData): string[] {
  const goal = data.config.realms[winRealm(data)].name;
  return [`先到${goal}者立即获胜。`, `${data.config.rounds} 轮后比境界，再比修为，再比总资产。`];
}

export function raceView(state: GameState, board: Board, data: GameData): RaceView {
  const top = winRealm(data);
  const realms = data.config.realms.slice(0, top).map((r) => ({ name: r.name, bar: r.bar }));
  const rows = standings(state, board, data).map((seat) => {
    const p = state.players[seat];
    const cells = realms.map((r, k) => (k < p.realm ? r.bar : k === p.realm ? Math.min(p.cult, r.bar) : 0));
    return { seat, cells, ascended: p.realm >= top };
  });
  return { realms, goal: data.config.realms[top].name, rows, lead: leadLine(state, board, data, rows) };
}

function leadLine(state: GameState, board: Board, data: GameData, rows: RaceRow[]): string {
  const [first, second] = rows.map((r) => r.seat);
  const why = { realm: '境界最高', cult: '同境界中修为最多', assets: '境界修为相同，资产最多', seat: '' }[
    decidingStat(state, board, data, first, second)
  ];
  return why ? `${state.players[first].name} 领先：${why}` : '众人并肩，尚无人领先';
}

/** The 白泽 chip on the round line: what the next milestone is and when. */
export function roundChip(state: GameState, data: GameData): RoundChip {
  const { manifest, rounds } = data.config;
  const r = Math.max(1, state.round);
  if (!state.manifested) {
    const left = manifest.round - r;
    return {
      text: left > 0 ? `${left}轮后白泽现世` : '本轮白泽现世',
      tone: 'text',
      detail: `白泽将于第 ${manifest.round} 轮现世：落后者先挑一份机缘。`,
    };
  }
  if (state.round === manifest.round) {
    return { text: '白泽现世·落后先挑', tone: 'gold', detail: '白泽现世：落后者先挑一份机缘。' };
  }
  const left = rounds - r;
  return {
    text: left > 0 ? `${left}轮后秘境关闭` : '本轮结束秘境关闭',
    tone: left > 0 ? 'dim' : 'gold',
    detail: `第 ${rounds} 轮结束时秘境关闭，无人化神就按境界、修为、总资产排名。`,
  };
}
