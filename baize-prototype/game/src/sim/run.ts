// AI-vs-AI batch simulation.
//   npm run sim -- --games 500 --seed 1 [--difficulty normal] [--verbose]
import { HERO_IDS } from '../core/heroes';
import { Rng } from '../core/rng';
import type { HeroId } from '../core/types';
import { defaultData } from '../core/data';
import { randomPersonality, type Difficulty } from '../ai/ai';
import { runHeadless } from './headless';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const games = Number(arg('games', '500'));
const seed = Number(arg('seed', '1'));
const difficulty = arg('difficulty', 'normal') as Difficulty;
const verbose = process.argv.includes('--verbose');
const heroName = Object.fromEntries(defaultData.heroes.map((h) => [h.id, h.name])) as Record<HeroId, string>;

const wins: Record<string, number> = {};
const plays: Record<string, number> = {};
const seatWins = [0, 0, 0, 0];
let rounds = 0;
let byCult = 0;
let breakthroughs = 0;
let roadEntries = 0;
let finalCult = 0;
let bankrupt = 0;
let tasksDone = 0;
let playerCount = 0;
const t0 = Date.now();

for (let g = 0; g < games; g++) {
  const gs = seed * 100003 + g;
  const rng = new Rng(gs);
  const heroes = rng.shuffle([...HERO_IDS]);
  const setup = { seed: gs, players: heroes.map((h, i) => ({ name: `P${i + 1}·${heroName[h]}`, hero: h })) };
  const seats = heroes.map(() => ({ difficulty, personality: randomPersonality(rng) }));
  const { game } = runHeadless(setup, seats);
  const st = game.state;
  const w = st.winner!;
  wins[st.players[w].hero] = (wins[st.players[w].hero] ?? 0) + 1;
  for (const p of st.players) plays[p.hero] = (plays[p.hero] ?? 0) + 1;
  seatWins[w]++;
  rounds += st.round;
  if (st.endReason === 'cultivation') byCult++;
  for (const p of st.players) {
    breakthroughs += p.stats.breakthroughs;
    roadEntries += p.stats.roadEntries;
    finalCult += game.cult(p.seat);
    bankrupt += p.stats.bankruptcies;
    tasksDone += p.stats.tasksDone;
    playerCount++;
  }
  if (verbose && g === 0) for (const e of game.log) if (e.text) console.log(`[R${e.round}] ${e.text}`);
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
const ms = Date.now() - t0;
console.log(`\n白泽秘境大富翁 · AI 自对弈  games=${games} seed=${seed} difficulty=${difficulty}  (${ms} ms, ${(ms / games).toFixed(1)} ms/game)`);
console.log('—'.repeat(60));
console.log('各英雄胜率 (目标 22–28%)');
for (const h of HERO_IDS) console.log(`  ${heroName[h]} (${h})`.padEnd(18) + `${pct(wins[h] ?? 0, plays[h] ?? 1)}  (${wins[h] ?? 0}/${plays[h] ?? 0})`);
console.log(`先手(1号位)胜率: ${pct(seatWins[0], games)}  (公平值 25%，各席位: ${seatWins.map((s) => pct(s, games)).join(' / ')})`);
console.log(`平均轮数: ${(rounds / games).toFixed(2)}  (目标 12–15)`);
console.log(`结束方式: 修为 10 飞升 ${pct(byCult, games)} / 第 15 轮封顶 ${pct(games - byCult, games)}`);
console.log(`平均每人突破次数: ${(breakthroughs / playerCount).toFixed(2)}  (目标 1.5–2.5)`);
console.log(`平均每人进入神道次数: ${(roadEntries / playerCount).toFixed(2)}`);
console.log(`平均每人最终修为: ${(finalCult / playerCount).toFixed(2)}`);
console.log(`平均每人破产重整: ${(bankrupt / playerCount).toFixed(2)}   平均每人完成任务: ${(tasksDone / playerCount).toFixed(2)}`);
