// AI-vs-AI batch simulation CLI.
//   npm run sim -- --games 500 --seed 1 [--difficulty normal] [--verbose] [--json]
import { HERO_IDS } from '../core/heroes';
import type { HeroId } from '../core/types';
import { defaultData } from '../core/data';
import type { Difficulty } from '../ai/ai';
import { LEADER_CHECK_ROUND, simulate } from './simulate';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const games = Number(arg('games', '500'));
const seed = Number(arg('seed', '1'));
const difficulty = arg('difficulty', 'normal') as Difficulty;
const verbose = process.argv.includes('--verbose');
const json = process.argv.includes('--json');
const heroName = Object.fromEntries(defaultData.heroes.map((h) => [h.id, h.name])) as Record<HeroId, string>;

// The battle log goes to stderr under --json so stdout stays parseable.
const logLine = json ? console.error : console.log;

const t0 = Date.now();
const r = simulate({
  games, seed, difficulty,
  onGameEnd: (game, g) => {
    if (verbose && g === 0) for (const e of game.log) if (e.text) logLine(`[R${e.round}] ${e.text}`);
  },
});
const ms = Date.now() - t0;

if (json) {
  console.log(JSON.stringify(r, null, 2));
} else {
  // Every seat plays exactly one hero per game, so counts are rate × games; recovering them keeps the text identical to the pre-library output.
  const count = (rate: number) => Math.round(rate * games);
  const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
  const pp = r.perPlayer;
  console.log(`\n白泽秘境大富翁 · AI 自对弈  games=${games} seed=${seed} difficulty=${difficulty}  (${ms} ms, ${(ms / games).toFixed(1)} ms/game)`);
  console.log('—'.repeat(60));
  console.log('各英雄胜率 (目标 22–28%)');
  for (const h of HERO_IDS) {
    const w = count(r.heroWinRate[h]);
    console.log(`  ${heroName[h]} (${h})`.padEnd(18) + `${pct(w, games)}  (${w}/${games})`);
  }
  console.log(`先手(1号位)胜率: ${pct(count(r.seatWinRate[0]), games)}  (公平值 25%，各席位: ${r.seatWinRate.map((s) => pct(count(s), games)).join(' / ')})`);
  console.log(`平均轮数: ${r.avgRounds.toFixed(2)}  (目标 12–15)`);
  const byCult = count(r.cultivationEndRate);
  console.log(`结束方式: 修为 10 飞升 ${pct(byCult, games)} / 第 15 轮封顶 ${pct(games - byCult, games)}`);
  console.log(`平均每人突破次数: ${pp.breakthroughs.toFixed(2)}  (目标 1.5–2.5)`);
  console.log(`平均每人进入神道次数: ${pp.roadEntries.toFixed(2)}`);
  console.log(`平均每人最终修为: ${pp.finalCult.toFixed(2)}`);
  console.log(`平均每人破产重整: ${pp.bankruptcies.toFixed(2)}   平均每人完成任务: ${pp.tasksDone.toFixed(2)}`);
  console.log(`第 ${LEADER_CHECK_ROUND} 轮领先者最终获胜: ${pct(r.leaderAtR10Wins, 1)}  (n=${r.gamesReachingR10} 局到达第 ${LEADER_CHECK_ROUND} 轮)`);
  console.log(`平均每人无事可做回合: ${pp.idleTurns.toFixed(2)}  (占其回合 ${pct(pp.idleTurns, pp.turns)})`);
}
