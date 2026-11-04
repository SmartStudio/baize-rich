// AI-vs-AI batch simulation as a library (CLI in run.ts, parameter sweep in sweep.ts).
import { HERO_IDS } from '../core/heroes';
import { Rng } from '../core/rng';
import type { PendingChoice } from '../core/choices';
import type { Game } from '../core/engine';
import type { GameData, HeroId } from '../core/types';
import { defaultData } from '../core/data';
import { randomPersonality, type Difficulty } from '../ai/ai';
import { runHeadless } from './headless';

export const LEADER_CHECK_ROUND = 10;

export interface SimOptions {
  games: number;
  seed: number;
  difficulty: Difficulty;
  onGameEnd?: (game: Game, index: number) => void;
}

/** Averages per player. */
export interface PerPlayerStats {
  breakthroughs: number;
  roadEntries: number;
  finalCult: number;
  bankruptcies: number;
  tasksDone: number;
  /**
   * Completed turns (turnStart..turnEnd, doubles re-rolls included) in which every choice
   * asked to the active player was `preRoll` or `action` offering only its default option
   * (`roll` / `end`). Any other choice kind asked to that player makes the turn non-idle;
   * choices asked to other players during the turn do not count.
   */
  idleTurns: number;
  /** Completed turns: a turn cut short by a win has no turnEnd and is not counted here or in idleTurns. */
  turns: number;
}

export interface SimReport {
  games: number;
  seed: number;
  difficulty: Difficulty;
  /** Fractions 0..1. */
  heroWinRate: Record<HeroId, number>;
  seatWinRate: number[];
  avgRounds: number;
  /** Fraction of games ended by reaching winCultivation. */
  cultivationEndRate: number;
  perPlayer: PerPlayerStats;
  /** Fraction of the games reaching the end of round 10 whose ranking()[0] at that moment is the final winner (0 when none reach it). */
  leaderAtR10Wins: number;
  gamesReachingR10: number;
}

function isDefaultOnly(c: PendingChoice): boolean {
  return (c.kind === 'preRoll' || c.kind === 'action') && c.options.length === 1 && c.options[0].id === c.defaultId;
}

export function simulate({ games, seed, difficulty, onGameEnd }: SimOptions, data: GameData = defaultData): SimReport {
  const heroName = Object.fromEntries(data.heroes.map((h) => [h.id, h.name])) as Record<HeroId, string>;
  const wins: Record<string, number> = {};
  const plays: Record<string, number> = {};
  const seatWins = [0, 0, 0, 0];
  let rounds = 0;
  let byCult = 0;
  const totals: PerPlayerStats = { breakthroughs: 0, roadEntries: 0, finalCult: 0, bankruptcies: 0, tasksDone: 0, idleTurns: 0, turns: 0 };
  let playerCount = 0;
  let reachedR10 = 0;
  let leaderWon = 0;

  for (let g = 0; g < games; g++) {
    const gs = seed * 100003 + g;
    const rng = new Rng(gs);
    const heroes = rng.shuffle([...HERO_IDS]);
    const setup = { seed: gs, players: heroes.map((h, i) => ({ name: `P${i + 1}·${heroName[h]}`, hero: h })) };
    const seats = heroes.map(() => ({ difficulty, personality: randomPersonality(rng) }));
    let turn: { seat: number; idle: boolean } | null = null;
    let r10Leader: number | null = null;
    const { game } = runHeadless(setup, seats, data, {
      onChoice: (c) => {
        if (turn && c.player === turn.seat && !isDefaultOnly(c)) turn.idle = false;
      },
      onEvent: (e, game) => {
        if (e.type === 'turnStart') turn = { seat: e.player!, idle: true };
        else if (e.type === 'turnEnd' && turn) {
          totals.turns++;
          if (turn.idle) totals.idleTurns++;
          turn = null;
        } else if (e.type === 'roundEnd' && e.round === LEADER_CHECK_ROUND) r10Leader = game.ranking()[0];
      },
    });
    const st = game.state;
    const w = st.winner!;
    wins[st.players[w].hero] = (wins[st.players[w].hero] ?? 0) + 1;
    for (const p of st.players) plays[p.hero] = (plays[p.hero] ?? 0) + 1;
    seatWins[w]++;
    rounds += st.round;
    if (st.endReason === 'cultivation') byCult++;
    if (r10Leader !== null) {
      reachedR10++;
      if (r10Leader === w) leaderWon++;
    }
    for (const p of st.players) {
      totals.breakthroughs += p.stats.breakthroughs;
      totals.roadEntries += p.stats.roadEntries;
      totals.finalCult += game.cult(p.seat);
      totals.bankruptcies += p.stats.bankruptcies;
      totals.tasksDone += p.stats.tasksDone;
      playerCount++;
    }
    onGameEnd?.(game, g);
  }

  const perPlayer = Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [k, v / playerCount]),
  ) as unknown as PerPlayerStats;
  return {
    games, seed, difficulty,
    heroWinRate: Object.fromEntries(HERO_IDS.map((h) => [h, (wins[h] ?? 0) / (plays[h] ?? 1)])) as Record<HeroId, number>,
    seatWinRate: seatWins.map((s) => s / games),
    avgRounds: rounds / games,
    cultivationEndRate: byCult / games,
    perPlayer,
    leaderAtR10Wins: reachedR10 ? leaderWon / reachedR10 : 0,
    gamesReachingR10: reachedR10,
  };
}
