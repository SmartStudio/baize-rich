// What the result screen says: the ranking rule, why each seat placed where it did, and a few plain lines
// about how one seat's game went (the human's, else the winner's), picked from the event log.
import { PERSONALITY_LABEL } from '../ai/ai';
import type { Game } from '../core/engine';
import type { GameEvent, GameEventType } from '../core/events';
import type { SeatControl } from '../core/record';
import { closurePlaces, realmName, totalAssets, winRealm } from '../core/rules';
import { decidingStat, leadReason, standings, STAT_LABEL, type StandingStat } from './raceReadout';

export interface ResultStat {
  text: string;
  deciding: boolean;
}

export interface ResultRow {
  seat: number;
  hero: string;
  name: string;
  label: string;
  /** 境界, 修为, 总资产: the tie-break chain, with the one that settled this place marked. */
  stats: ResultStat[];
  /** Why this seat sits above the next one, or below the one above for last place. */
  note: string;
  extra: string;
}

export interface Recap {
  title: string;
  lines: string[];
}

export interface ResultView {
  title: string;
  sub: string;
  rule: string;
  rows: ResultRow[];
  recap: Recap;
  footer: string;
}

const RECAP_MIN = 3;
const RECAP_MAX = 5;

const SHOWN: { stat: Exclude<StandingStat, 'seat'>; text: (g: Game, seat: number) => string }[] = [
  { stat: 'realm', text: (g, i) => `境界 ${realmName(g.data, g.state.players[i].realm)}` },
  { stat: 'cult', text: (g, i) => `修为 ${g.state.players[i].cult}` },
  { stat: 'assets', text: (g, i) => `总资产 ${totalAssets(g.state, g.board, g.data, i)}` },
];

export function resultView(game: Game, seats: SeatControl[]): ResultView {
  const order = standings(game.state, game.board, game.data);
  const human = order.find((seat) => seats[seat].human);
  return {
    ...ending(game, order),
    rule: rankRule(game),
    rows: order.map((_, k) => resultRow(game, seats, order, k)),
    recap: recap(game, human ?? order[0], human !== undefined),
  };
}

function heroName(game: Game, seat: number): string {
  return game.data.heroes.find((h) => h.id === game.state.players[seat].hero)!.name;
}

function ending(game: Game, order: number[]): Pick<ResultView, 'title' | 'sub' | 'footer'> {
  const winner = heroName(game, order[0]);
  if (game.state.endReason === 'ascend') {
    return { title: '渡劫化神', sub: `${winner}渡劫化神。凡人，也能成仙。`, footer: '余下的人记住了这一天。' };
  }
  const why = order.length > 1 ? leadReason(game.state, game.board, game.data, order[0], order[1]) : '';
  return {
    title: '秘境关闭',
    sub: `${game.data.config.rounds} 轮已尽，无人化神。${winner}${why || '与人同分，按座次'}，夺得魁首。`,
    footer: '下一个甲子，秘境还会再开。',
  };
}

function rankRule(game: Game): string {
  const goal = realmName(game.data, winRealm(game.data));
  const chain = '比境界，境界相同比修为，再相同比总资产';
  return game.state.endReason === 'ascend'
    ? `排名：先到${goal}者第一，其余人${chain}。`
    : `排名：${game.data.config.rounds} 轮内无人${goal}，${chain}。`;
}

function resultRow(game: Game, seats: SeatControl[], order: number[], k: number): ResultRow {
  const seat = order[k];
  const p = game.state.players[seat];
  const s = seats[seat];
  const place = placeNote(game, order, k);
  const won = p.stats.breakthroughs - p.stats.breakthroughFails;
  return {
    seat,
    hero: p.hero,
    name: heroName(game, seat),
    label: s.human ? '玩家' : `AI·${PERSONALITY_LABEL[s.personality]}`,
    stats: SHOWN.map(({ stat, text }) => ({ text: text(game, seat), deciding: stat === place.stat })),
    note: place.note,
    extra: `灵石 ${p.stones} · 丹药 ${p.pills} · 突破 ${won} 成 / ${p.stats.breakthroughFails} 走火 · 炼丹 ${p.stats.pillsMade} · 斗法胜 ${p.stats.duelWins}`,
  };
}

function placeNote(game: Game, order: number[], k: number): { stat: StandingStat | null; note: string } {
  if (k === 0 && game.state.endReason === 'ascend') return { stat: 'realm', note: '率先化神' };
  if (order.length < 2) return { stat: null, note: '' };
  const below = k + 1 < order.length;
  const stat = decidingStat(game.state, game.board, game.data, order[k], order[below ? k + 1 : k - 1]);
  if (stat === 'seat') return { stat: null, note: '各项同分，按座次' };
  const word = stat === 'realm' ? (below ? '高' : '低') : below ? '多' : '少';
  return { stat, note: `${STAT_LABEL[stat]}比第 ${below ? k + 2 : k} 名${word}` };
}

// ---- recap ------------------------------------------------------------------

interface RecapCtx {
  game: Game;
  seat: number;
  /** 你 for the human, else the hero name. */
  who: string;
  log: GameEvent[];
}

interface Moment {
  round: number;
  weight: number;
  text: string;
}

const at = (rounds: number[]): string => `第 ${rounds.join('、')} 轮 · `;

/** Moment finders over the log, one per kind of key moment. A finder returns nothing when its moment never happened. */
const MOMENTS: ((c: RecapCtx) => Moment[])[] = [ascents, failures, noClosure, rentPaid, rentTaken, tollsTaken, duelsWon, manifestPick, bankruptcies];

export function recap(game: Game, seat: number, human: boolean): Recap {
  const ctx: RecapCtx = { game, seat, who: human ? '你' : heroName(game, seat), log: game.log };
  const picked = MOMENTS.flatMap((find) => find(ctx))
    .sort((a, b) => b.weight - a.weight || a.round - b.round)
    .slice(0, RECAP_MAX)
    .sort((a, b) => a.round - b.round)
    .map((m) => m.text);
  const lines = [...picked, ...fillers(ctx)].slice(0, Math.max(RECAP_MIN, picked.length));
  return { title: human ? '你的这一局' : `魁首${ctx.who}的这一局`, lines };
}

function mine(c: RecapCtx, type: GameEventType): GameEvent[] {
  return c.log.filter((e) => e.type === type && e.player === c.seat);
}

function ascents(c: RecapCtx): Moment[] {
  const top = winRealm(c.game.data);
  return mine(c, 'breakthrough').filter((e) => e.breakthrough!.success).map((e) => {
    const to = e.breakthrough!.from + 1;
    const text = to === top ? '闭关成功，渡劫化神。' : `闭关成功，踏入${realmName(c.game.data, to)}。`;
    return { round: e.round, weight: to === top ? 10 : 5, text: at([e.round]) + text };
  });
}

function failures(c: RecapCtx): Moment[] {
  const fails = mine(c, 'breakthrough').filter((e) => !e.breakthrough!.success);
  if (fails.length === 0) return [];
  const lost = fails.reduce((n, e) => n + e.breakthrough!.cultLost, 0);
  const next = realmName(c.game.data, fails[0].breakthrough!.from + 1);
  const times = fails.length > 1 ? ` ${fails.length} 次` : '';
  const loss = lost > 0 ? `修为${fails.length > 1 ? '共' : ''}散去 ${lost} 点` : '修为未散';
  return [{ round: fails[0].round, weight: 4, text: `${at(fails.map((e) => e.round))}冲击${next}失败${times}，走火入魔，${loss}。` }];
}

function noClosure(c: RecapCtx): Moment[] {
  if (mine(c, 'breakthrough').length > 0) return [];
  return [{ round: Infinity, weight: 3, text: `整局没有闭关。修为条满后，到${closurePlaces(c.game.data)}闭关，才能升境界。` }];
}

function biggest(events: GameEvent[]): GameEvent | null {
  return events.reduce<GameEvent | null>((best, e) => (best && best.amount! >= e.amount! ? best : e), null);
}

function rentPaid(c: RecapCtx): Moment[] {
  const e = biggest(mine(c, 'rent'));
  if (!e || !e.amount) return [];
  const where = `${heroName(c.game, e.payee!)}的「${c.game.board.node(e.node!).name}」`;
  return [{ round: e.round, weight: 3, text: `${at([e.round])}停在${where}，付了 ${e.amount} 灵石租金，是最大的一笔。` }];
}

function rentTaken(c: RecapCtx): Moment[] {
  const e = biggest(c.log.filter((x) => x.type === 'rent' && x.payee === c.seat));
  if (!e || !e.amount) return [];
  const where = `${c.who}的「${c.game.board.node(e.node!).name}」`;
  return [{ round: e.round, weight: 3, text: `${at([e.round])}${heroName(c.game, e.player!)}停在${where}，交来 ${e.amount} 灵石租金。` }];
}

function tollsTaken(c: RecapCtx): Moment[] {
  const tolls = c.log.filter((e) => e.type === 'passToll' && e.payee === c.seat);
  if (tolls.length === 0) return [];
  const total = tolls.reduce((n, e) => n + e.amount!, 0);
  return [{ round: tolls[0].round, weight: 3, text: `第 ${tolls[0].round} 轮起 · 别人路过${c.who}的灵田 ${tolls.length} 次，共交来 ${total} 灵石过路费。` }];
}

function duelsWon(c: RecapCtx): Moment[] {
  const wins = c.log.filter((e) => e.type === 'duel' && e.duel!.winner === c.seat);
  if (wins.length === 0) return [];
  const pills = wins.reduce((n, e) => n + e.duel!.pills, 0);
  const stones = wins.reduce((n, e) => n + e.duel!.stones, 0);
  const prize = [pills ? `${pills} 颗丹药` : '', stones ? `${stones} 灵石` : ''].filter(Boolean).join('、');
  const rounds = wins.map((e) => e.round);
  const when = wins.length > 3 ? `第 ${rounds[0]} 轮起 · ` : at([...new Set(rounds)]);
  return [{ round: rounds[0], weight: 3, text: `${when}斗法赢了 ${wins.length} 场${prize ? `，夺得 ${prize}` : ''}。` }];
}

const GIFT_BY_EVENT: Partial<Record<GameEventType, string>> = { cult: '白泽图', salary: '灵脉馈赠', pills: '丹霞', teleport: '白泽指路' };

/** Between 白泽现世 and the next turn the log holds only the gifts, one event per seat in pick order. */
function manifestPick(c: RecapCtx): Moment[] {
  const start = c.log.findIndex((e) => e.type === 'manifest');
  if (start < 0) return [];
  const end = c.log.findIndex((e, i) => i > start && e.type === 'turnStart');
  const picks = c.log.slice(start + 1, end < 0 ? undefined : end).filter((e) => e.player !== undefined && GIFT_BY_EVENT[e.type]);
  const k = picks.findIndex((e) => e.player === c.seat);
  if (k < 0) return [];
  const round = c.log[start].round;
  return [{ round, weight: 2, text: `${at([round])}白泽现世，落后的先挑。${c.who}第 ${k + 1} 个挑，拿了${GIFT_BY_EVENT[picks[k].type]}。` }];
}

function bankruptcies(c: RecapCtx): Moment[] {
  return mine(c, 'bankrupt').map((e) => ({ round: e.round, weight: 4, text: `${at([e.round])}灵石耗尽，破产重整，灵田全部归还。` }));
}

/** Always-true lines that pad a quiet game up to RECAP_MIN. */
function fillers(c: RecapCtx): string[] {
  const p = c.game.state.players[c.seat];
  const bar = c.game.data.config.realms[p.realm].bar;
  return [
    `买下 ${mine(c, 'buy').length} 块灵田。收租 ${p.stats.rentCollected}、过路费 ${p.stats.tollCollected} 灵石，付租 ${p.stats.rentPaid}、过路费 ${p.stats.tollPaid} 灵石。`,
    `炼出 ${p.stats.pillsMade} 颗丹药。`,
    `最终停在${realmName(c.game.data, p.realm)}${bar > 0 ? `，修为 ${p.cult}/${bar}` : ''}。`,
  ];
}
