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
const heroName = Object.fromEntries(defaultData.heroes.map((h) => [h.id, h.school])) as Record<HeroId, string>;

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
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const pp = r.perPlayer;
  const ix = r.interaction;
  const cfg = defaultData.config;
  const seatSpread = Math.max(...r.seatWinRate) - Math.min(...r.seatWinRate);
  console.log(`\n凡人问道 · AI 自对弈  games=${games} seed=${seed} difficulty=${difficulty}  (${ms} ms, ${(ms / games).toFixed(1)} ms/game)`);
  console.log('—'.repeat(60));
  console.log('§12 调参目标');
  console.log(`  平均轮数 ${r.avgRounds.toFixed(2)}  (目标 10–12，上限 ${cfg.rounds})`);
  console.log(`  化神结束 ${pct(r.ascendRate)}  (目标 50–70%)`);
  console.log(`  修士胜率 ${HERO_IDS.map((h) => `${heroName[h]} ${pct(r.heroWinRate[h])}`).join(' / ')}  (目标 22–28%)`);
  console.log(`  座位胜率 ${r.seatWinRate.map(pct).join(' / ')}，差 ${pct(seatSpread)}  (目标 < 3%)`);
  console.log(`  每人突破 ${pp.breakthroughs.toFixed(2)} 次，走火入魔 ${pp.breakthroughFails.toFixed(2)} 次  (目标 2.5–3.5 / 约 1)`);
  console.log(`  每局斗法 ${ix.duels.toFixed(2)}  (目标 ≥ 6)；被夺丹药回合 ${pct(ix.pillStolenTurnRate)}  (目标 ≥ 5%)`);
  console.log(`  第 ${LEADER_CHECK_ROUND} 轮领先者获胜 ${pct(r.leaderWins)}  (目标 ≤ 65%，n=${r.gamesReachingCheck})`);
  console.log('—'.repeat(60));
  console.log('诊断（每人平均）');
  console.log(`  最终境界 ${pp.finalRealm.toFixed(2)} · 炼丹 ${pp.pillsMade.toFixed(2)} · 服丹 ${pp.pillsEaten.toFixed(2)} · 被夺 ${pp.pillsLost.toFixed(2)} · 溢出修为 ${pp.cultWasted.toFixed(2)}`);
  console.log(`  进神道 ${pp.roadEntries.toFixed(2)} · 破产 ${pp.bankruptcies.toFixed(2)} · 无事可做回合 ${pct(pp.idleTurns / Math.max(1, pp.turns))}`);
  console.log(`  每局 山岳拦人 ${ix.roadblockHits.toFixed(2)} · 火候小游戏 ${ix.miniGames.toFixed(2)}`);
  console.log(`  技能使用 ${HERO_IDS.map((h) => `${heroName[h]} ${ix.skillUsesByHero[h].toFixed(2)}`).join(' / ')}`);
  console.log(`  回合占比 有互动 ${pct(ix.interactionTurnRate)} · 付租 ${pct(ix.rentTurnRate)} · 斗法 ${pct(ix.duelTurnRate)} · 用符 ${pct(ix.castTurnRate)}`);
}
