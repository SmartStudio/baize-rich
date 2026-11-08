// What the result screen tells the human seat beyond the ranking: how far behind the winner it finished, on the
// stat that decided it, and one thing to try next game, picked from how this game went.
import type { Game } from '../core/engine';
import { closurePlaces, landLevel, totalAssets } from '../core/rules';
import { decidingStat, type StandingStat } from './raceReadout';

export interface Verdict {
  /** "你位列第 3，境界落后冠军 2 阶。" */
  standing: string;
  /** "下局试试：…" */
  tip: string;
}

interface Ctx {
  game: Game;
  seat: number;
}

const GAP: Record<StandingStat, (c: Ctx, winner: number) => string> = {
  realm: (c, w) => `境界落后冠军 ${realmOf(c, w) - realmOf(c, c.seat)} 阶`,
  cult: (c, w) => `境界相同，修为落后冠军 ${c.game.state.players[w].cult - c.game.state.players[c.seat].cult} 点`,
  assets: (c, w) => `境界修为相同，总资产落后冠军 ${assetsOf(c, w) - assetsOf(c, c.seat)} 灵石`,
  seat: () => '各项同分，按座次排在后面',
};

/** Tried in order; the first that fits this game is the tip. The last always fits. */
const TIPS: { fits: (c: Ctx) => boolean; text: (c: Ctx) => string }[] = [
  {
    fits: (c) => stats(c).breakthroughs === 0,
    text: (c) => `修为条一满就去${closurePlaces(c.game.data)}闭关，境界只靠闭关升。${wasted(c)}`,
  },
  {
    fits: (c) => stats(c).breakthroughFails > 0,
    text: (c) => `这局走火入魔 ${stats(c).breakthroughFails} 次。闭关前多攒几颗丹药押上，成功率更高。`,
  },
  {
    fits: (c) => !ownsClosureLand(c),
    text: (c) => `把一块自家灵田升到${closureLandName(c)}，就能就地闭关，不必赶回白泽灵台。`,
  },
  {
    fits: (c) => stats(c).pillsMade === 0,
    text: (c) => `这局一颗丹药没炼。带 ${c.game.data.config.alchemy.herbsPerPill} 株灵草去丹房，丹药押在闭关上最值。`,
  },
  {
    fits: (c) => duelsLost(c) >= 2,
    text: (c) => `这局斗法输了 ${duelsLost(c)} 场。身上丹药一多会冒宝光招人来抢，先押进闭关或吃掉。`,
  },
  {
    fits: () => true,
    text: () => '多停在自家灵田打坐，修为长得更快，闭关也更早。',
  },
];

/** Null when no seat is human. */
export function verdict(game: Game, order: number[], human: number | undefined): Verdict | null {
  if (human === undefined) return null;
  const c: Ctx = { game, seat: human };
  const k = order.indexOf(human);
  const standing = k === 0 ? '你位列第 1，夺得魁首。' : `你位列第 ${k + 1}，${GAP[decidingStat(game.state, game.board, game.data, human, order[0])](c, order[0])}。`;
  return { standing, tip: TIPS.find((t) => t.fits(c))!.text(c) };
}

function stats(c: Ctx) {
  return c.game.state.players[c.seat].stats;
}

function realmOf(c: Ctx, seat: number): number {
  return c.game.state.players[seat].realm;
}

function assetsOf(c: Ctx, seat: number): number {
  return totalAssets(c.game.state, c.game.board, c.game.data, seat);
}

function wasted(c: Ctx): string {
  const n = stats(c).cultWasted;
  return n > 0 ? `这局修为条满后白白溢出 ${n} 点。` : '';
}

function ownsClosureLand(c: Ctx): boolean {
  const { state, board, data } = c.game;
  return board.lands.some((id) => state.tiles[id].owner === c.seat && landLevel(data, state.tiles[id].level).closureBonus !== null);
}

function closureLandName(c: Ctx): string {
  const { data } = c.game;
  return data.board.buildings[data.config.landLevels.findIndex((l) => l.closureBonus !== null)].name;
}

function duelsLost(c: Ctx): number {
  return c.game.log.filter((e) => e.type === 'duel' && e.duel!.loser === c.seat).length;
}
