// Mixed-table win rates per AI difficulty or personality (library; CLI below).
//   npm run matchup -- [--by difficulty|personality] [--games 1000] [--seed 1]
import { HERO_IDS } from '../core/heroes';
import { Rng } from '../core/rng';
import { randomPersonality, type Difficulty, type Personality } from '../ai/ai';
import { runHeadless, type HeadlessSeat } from './headless';

export type MatchupAxis = 'difficulty' | 'personality';

/** Seat line-ups rotate every game so each label plays every seat equally. */
const LINEUP: Record<MatchupAxis, string[]> = {
  difficulty: ['hard', 'normal', 'easy', 'normal'],
  personality: ['steady', 'aggressive', 'miser', 'steady'],
};

function seatFor(axis: MatchupAxis, label: string, rng: Rng): HeadlessSeat {
  return axis === 'difficulty'
    ? { difficulty: label as Difficulty, personality: randomPersonality(rng) }
    : { difficulty: 'normal', personality: label as Personality };
}

/** Win rate per seat for each label (fair share is 25%). */
export function matchup(axis: MatchupAxis, games: number, seed = 1): Record<string, number> {
  const wins: Record<string, number> = {};
  const plays: Record<string, number> = {};
  for (let g = 0; g < games; g++) {
    const gs = seed * 100003 + g;
    const rng = new Rng(gs);
    const heroes = rng.shuffle([...HERO_IDS]);
    const labels = heroes.map((_, i) => LINEUP[axis][(i + g) % 4]);
    const setup = { seed: gs, players: heroes.map((h, i) => ({ name: `P${i + 1}`, hero: h })) };
    const { game } = runHeadless(setup, labels.map((l) => seatFor(axis, l, rng)));
    for (const l of labels) plays[l] = (plays[l] ?? 0) + 1;
    const w = labels[game.state.winner!];
    wins[w] = (wins[w] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(plays).map((l) => [l, (wins[l] ?? 0) / plays[l]]));
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('matchup.ts')) {
  const axis = arg('by', 'difficulty') as MatchupAxis;
  const games = Number(arg('games', '1000'));
  const r = matchup(axis, games, Number(arg('seed', '1')));
  console.log(`AI 混桌胜率（按${axis === 'difficulty' ? '难度' : '性格'}，${games} 局，公平值 25%）`);
  for (const [label, rate] of Object.entries(r)) console.log(`  ${label.padEnd(12)}${(100 * rate).toFixed(1)}%`);
}
