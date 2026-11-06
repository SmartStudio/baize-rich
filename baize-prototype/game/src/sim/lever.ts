// Does land move the outcome? One seat (rotating) plays the normal AI but never develops land past a cap;
// its win rate against three normal AIs is the price of ignoring land (fair share is 25%).
//   npm run lever -- [--games 2000] [--seed 1]
import { HERO_IDS } from '../core/heroes';
import { Rng } from '../core/rng';
import { Game } from '../core/engine';
import type { PendingChoice } from '../core/choices';
import { defaultData } from '../core/data';
import type { GameData } from '../core/types';
import { AIController, randomPersonality } from '../ai/ai';

/** Highest level the capped seat may own; -1 means it never buys. */
export type LandCap = -1 | 0 | 1 | 2;

function capped(game: Game, c: PendingChoice, cap: LandCap): PendingChoice {
  if (c.kind === 'buy' && cap < 0) return { ...c, options: c.options.filter((o) => o.id === 'no') };
  if (c.kind !== 'action') return c;
  return { ...c, options: c.options.filter((o) => o.value.t !== 'upgrade' || game.state.tiles[o.value.node].level < cap) };
}

/** Win rate of a seat held to `cap`, rotating through every seat. */
export function landLever(cap: LandCap, games: number, seed = 1, data: GameData = defaultData): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const gs = seed * 100003 + g;
    const rng = new Rng(gs);
    const heroes = rng.shuffle([...HERO_IDS]);
    const game = new Game({ seed: gs, players: heroes.map((h, i) => ({ name: `P${i + 1}`, hero: h })) }, data);
    const ais = heroes.map((_, i) => new AIController(game, i, { personality: randomPersonality(rng), seed: gs }));
    const held = g % ais.length;
    game.start();
    while (!game.over) {
      const c = game.pending!;
      game.answer(ais[c.player].decide(c.player === held ? capped(game, c, cap) : c));
    }
    if (game.state.winner === held) wins++;
  }
  return wins / games;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

if (process.argv[1]?.endsWith('lever.ts')) {
  const games = Number(arg('games', '2000'));
  const seed = Number(arg('seed', '1'));
  const se = 100 * 1.96 * Math.sqrt(0.25 * 0.75 / games);
  const names = defaultData.board.buildings.map((b) => b.name);
  console.log(`灵田杠杆：一个座位只守着上限，其余三人照常（${games} 局，公平值 25%，±${se.toFixed(1)}% 为 95% 噪声）`);
  const rows: [LandCap, string][] = [[-1, '从不买地'], [0, `只买不升（${names[0]}）`], [1, `最多升到${names[1]}`], [2, `最多升到${names[2]}`]];
  for (const [cap, label] of rows) console.log(`  ${label.padEnd(10, '　')} 胜率 ${(100 * landLever(cap, games, seed)).toFixed(1)}%`);
}
