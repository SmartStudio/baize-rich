// AI-vs-AI batch simulation as a library (CLI in run.ts, parameter sweep in sweep.ts).
// Reports the GDD §12 tuning targets plus a few diagnostics.
import { HERO_IDS } from '../core/heroes';
import { Rng } from '../core/rng';
import type { PendingChoice } from '../core/choices';
import type { Game } from '../core/engine';
import type { GameEventType } from '../core/events';
import type { GameData, HeroId } from '../core/types';
import { defaultData } from '../core/data';
import { randomPersonality, type Difficulty } from '../ai/ai';
import { runHeadless } from './headless';

/** GDD §12: the round-8 realm leader should win ≤ 65%. */
export const LEADER_CHECK_ROUND = 8;

/** Events that mean the active player touched another player this turn. */
const INTERACTION_EVENTS: GameEventType[] = ['rent', 'duel', 'roadblockHit', 'skill'];

export interface SimOptions {
  games: number;
  seed: number;
  difficulty: Difficulty;
  onGameEnd?: (game: Game, index: number) => void;
}

/** Averages per player. */
export interface PerPlayerStats {
  /** 闭关 attempts (successes + failures). */
  breakthroughs: number;
  breakthroughFails: number;
  finalRealm: number;
  roadEntries: number;
  bankruptcies: number;
  pillsMade: number;
  pillsEaten: number;
  pillsLost: number;
  cultWasted: number;
  /** Completed turns in which every choice asked to the active player was its default-only preRoll / action. */
  idleTurns: number;
  turns: number;
}

/** Player-interaction counts, per game unless noted. */
export interface InteractionStats {
  duels: number;
  roadblockHits: number;
  miniGames: number;
  /** Skill uses per game by the seat playing each hero. */
  skillUsesByHero: Record<HeroId, number>;
  /** Fractions of completed turns. */
  rentTurnRate: number;
  duelTurnRate: number;
  castTurnRate: number;
  interactionTurnRate: number;
  /** Turns in which somebody lost a pill to a duel or 夺灵符. */
  pillStolenTurnRate: number;
}

export interface SimReport {
  games: number;
  seed: number;
  difficulty: Difficulty;
  /** Fractions 0..1. */
  heroWinRate: Record<HeroId, number>;
  seatWinRate: number[];
  avgRounds: number;
  /** Fraction of games ended by someone reaching 化神. */
  ascendRate: number;
  perPlayer: PerPlayerStats;
  /** Fraction of the games reaching the end of round 8 whose ranking()[0] then is the final winner. */
  leaderWins: number;
  gamesReachingCheck: number;
  interaction: InteractionStats;
}

function isDefaultOnly(c: PendingChoice): boolean {
  return (c.kind === 'preRoll' || c.kind === 'action') && c.options.length === 1 && c.options[0].id === c.defaultId;
}

const pillsLost = (game: Game) => game.state.players.reduce((a, p) => a + p.stats.pillsLost, 0);

interface Tally {
  wins: Record<string, number>;
  plays: Record<string, number>;
  seatWins: number[];
  rounds: number;
  ascended: number;
  reachedCheck: number;
  leaderWon: number;
  totals: PerPlayerStats;
  players: number;
  ix: { duels: number; roadblockHits: number; miniGames: number };
  skillUses: Record<string, number>;
  turnHits: { rent: number; duel: number; cast: number; any: number; stolen: number };
}

function newTally(): Tally {
  return {
    wins: {}, plays: {}, seatWins: [0, 0, 0, 0], rounds: 0, ascended: 0, reachedCheck: 0, leaderWon: 0, players: 0,
    totals: {
      breakthroughs: 0, breakthroughFails: 0, finalRealm: 0, roadEntries: 0, bankruptcies: 0,
      pillsMade: 0, pillsEaten: 0, pillsLost: 0, cultWasted: 0, idleTurns: 0, turns: 0,
    },
    ix: { duels: 0, roadblockHits: 0, miniGames: 0 },
    skillUses: {},
    turnHits: { rent: 0, duel: 0, cast: 0, any: 0, stolen: 0 },
  };
}

interface TurnWatch { seat: number; idle: boolean; seen: Set<GameEventType>; lost: number }

function closeTurn(t: Tally, turn: TurnWatch, game: Game): void {
  t.totals.turns++;
  if (turn.idle) t.totals.idleTurns++;
  const seen = turn.seen;
  if (seen.has('rent')) t.turnHits.rent++;
  if (seen.has('duel')) t.turnHits.duel++;
  if (seen.has('cast')) t.turnHits.cast++;
  if (INTERACTION_EVENTS.some((x) => seen.has(x))) t.turnHits.any++;
  if (pillsLost(game) > turn.lost) t.turnHits.stolen++;
}

function playOne(t: Tally, g: number, opts: SimOptions, data: GameData): Game {
  const heroName = Object.fromEntries(data.heroes.map((h) => [h.id, h.school])) as Record<HeroId, string>;
  const gs = opts.seed * 100003 + g;
  const rng = new Rng(gs);
  const heroes = rng.shuffle([...HERO_IDS]);
  const setup = { seed: gs, players: heroes.map((h, i) => ({ name: `P${i + 1}·${heroName[h]}`, hero: h })) };
  const seats = heroes.map(() => ({ difficulty: opts.difficulty, personality: randomPersonality(rng) }));
  let turn: TurnWatch | null = null;
  let leader: number | null = null;
  const { game } = runHeadless(setup, seats, data, {
    onChoice: (c) => { if (turn && c.player === turn.seat && !isDefaultOnly(c)) turn.idle = false; },
    onEvent: (e, game) => {
      if (e.type === 'duel') t.ix.duels++;
      else if (e.type === 'roadblockHit') t.ix.roadblockHits++;
      if (e.type === 'turnStart') turn = { seat: e.player!, idle: true, seen: new Set(), lost: pillsLost(game) };
      else if (e.type === 'turnEnd' && turn) { closeTurn(t, turn, game); turn = null; }
      else if (turn) turn.seen.add(e.type);
      if (e.type === 'roundEnd' && e.round === LEADER_CHECK_ROUND) leader = game.ranking()[0];
    },
  });
  recordGame(t, game, leader);
  return game;
}

function recordGame(t: Tally, game: Game, leader: number | null): void {
  const st = game.state;
  const w = st.winner!;
  t.wins[st.players[w].hero] = (t.wins[st.players[w].hero] ?? 0) + 1;
  t.seatWins[w]++;
  t.rounds += st.round;
  if (st.endReason === 'ascend') t.ascended++;
  if (leader !== null) {
    t.reachedCheck++;
    if (leader === w) t.leaderWon++;
  }
  for (const p of st.players) {
    t.plays[p.hero] = (t.plays[p.hero] ?? 0) + 1;
    const s = p.stats;
    const tt = t.totals;
    tt.breakthroughs += s.breakthroughs;
    tt.breakthroughFails += s.breakthroughFails;
    tt.finalRealm += p.realm;
    tt.roadEntries += s.roadEntries;
    tt.bankruptcies += s.bankruptcies;
    tt.pillsMade += s.pillsMade;
    tt.pillsEaten += s.pillsEaten;
    tt.pillsLost += s.pillsLost;
    tt.cultWasted += s.cultWasted;
    t.ix.miniGames += s.miniGames;
    t.skillUses[p.hero] = (t.skillUses[p.hero] ?? 0) + s.skillUses;
    t.players++;
  }
}

function report(t: Tally, { games, seed, difficulty }: SimOptions): SimReport {
  const perHero = (m: Record<string, number>) =>
    Object.fromEntries(HERO_IDS.map((h) => [h, (m[h] ?? 0) / (t.plays[h] ?? 1)])) as Record<HeroId, number>;
  const turns = Math.max(1, t.totals.turns);
  return {
    games, seed, difficulty,
    heroWinRate: perHero(t.wins),
    seatWinRate: t.seatWins.map((s) => s / games),
    avgRounds: t.rounds / games,
    ascendRate: t.ascended / games,
    perPlayer: Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, v / t.players])) as unknown as PerPlayerStats,
    leaderWins: t.reachedCheck ? t.leaderWon / t.reachedCheck : 0,
    gamesReachingCheck: t.reachedCheck,
    interaction: {
      duels: t.ix.duels / games,
      roadblockHits: t.ix.roadblockHits / games,
      miniGames: t.ix.miniGames / games,
      skillUsesByHero: perHero(t.skillUses),
      rentTurnRate: t.turnHits.rent / turns,
      duelTurnRate: t.turnHits.duel / turns,
      castTurnRate: t.turnHits.cast / turns,
      interactionTurnRate: t.turnHits.any / turns,
      pillStolenTurnRate: t.turnHits.stolen / turns,
    },
  };
}

export function simulate(opts: SimOptions, data: GameData = defaultData): SimReport {
  const t = newTally();
  for (let g = 0; g < opts.games; g++) {
    const game = playOne(t, g, opts, data);
    opts.onGameEnd?.(game, g);
  }
  return report(t, opts);
}
