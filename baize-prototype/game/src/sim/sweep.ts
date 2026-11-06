// Parameter sweep: one config number, several values, simulate() per seed, spread across seeds.
//   npm run sweep -- --param breakthrough.pillBonus --values 1,2,3 [--seeds 1,2,3,4] [--games 500] [--difficulty normal] [--json]
import { HERO_IDS } from '../core/heroes';
import type { GameData, HeroId } from '../core/types';
import { cloneData, defaultData } from '../core/data';
import type { Difficulty } from '../ai/ai';
import { simulate, LEADER_CHECK_ROUND, type SimReport } from './simulate';

interface Metric {
  key: string;
  label: string;
  get: (r: SimReport) => number;
  fmt: (n: number) => string;
}

const pct = (n: number) => `${(100 * n).toFixed(1)}%`;
const fixed2 = (n: number) => n.toFixed(2);
const heroName = Object.fromEntries(defaultData.heroes.map((h) => [h.id, h.name])) as Record<HeroId, string>;

const METRICS: Metric[] = [
  ...HERO_IDS.map((h): Metric => ({ key: `win.${h}`, label: `${heroName[h]}胜率`, get: (r) => r.heroWinRate[h], fmt: pct })),
  { key: 'seatSpread', label: '座位胜率差', get: (r) => Math.max(...r.seatWinRate) - Math.min(...r.seatWinRate), fmt: pct },
  { key: 'avgRounds', label: '平均轮数', get: (r) => r.avgRounds, fmt: fixed2 },
  { key: 'ascend', label: '化神结束', get: (r) => r.ascendRate, fmt: pct },
  { key: 'breakthroughs', label: '人均突破', get: (r) => r.perPlayer.breakthroughs, fmt: fixed2 },
  { key: 'fails', label: '人均走火', get: (r) => r.perPlayer.breakthroughFails, fmt: fixed2 },
  { key: 'duels', label: '每局斗法', get: (r) => r.interaction.duels, fmt: fixed2 },
  { key: 'stolen', label: '被夺丹回合', get: (r) => r.interaction.pillStolenTurnRate, fmt: pct },
  { key: 'leaderWins', label: `R${LEADER_CHECK_ROUND}领先者胜`, get: (r) => r.leaderWins, fmt: pct },
  { key: 'idleShare', label: '无事回合占比', get: (r) => r.perPlayer.idleTurns / r.perPlayer.turns, fmt: pct },
];

interface Spread { mean: number; min: number; max: number }

interface Param {
  path: string;
  keys: string[];
  current: number;
}

interface SweepArgs {
  param: Param;
  values: number[];
  seeds: number[];
  games: number;
  difficulty: Difficulty;
  json: boolean;
}

type Json = Record<string, unknown>;

function fail(msg: string): never {
  console.error(`错误：${msg}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseNumbers(name: string, raw: string): number[] {
  return raw.split(',').map((s) => {
    const n = Number(s);
    if (s.trim() === '' || !Number.isFinite(n)) fail(`--${name} 中的「${s}」不是有限数字（应为逗号分隔的数字，如 1,2,3）`);
    return n;
  });
}

function parseParam(path: string): Param {
  const keys = path.split('.');
  let node: unknown = defaultData.config;
  for (const k of keys) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, k)) fail(`config.json 中没有参数「${path}」`);
    node = (node as Json)[k];
  }
  if (typeof node !== 'number') fail(`参数「${path}」不是数字（当前值：${JSON.stringify(node)}）`);
  return { path, keys, current: node };
}

function parseArgs(): SweepArgs {
  const param = arg('param');
  const values = arg('values');
  if (!param || !values) fail('用法：npm run sweep -- --param <config 路径> --values a,b,c [--seeds 1,2,3,4] [--games 500] [--difficulty normal] [--json]');
  const seeds = parseNumbers('seeds', arg('seeds') ?? '1,2,3,4');
  if (!seeds.every(Number.isInteger)) fail('--seeds 必须是整数');
  const games = Number(arg('games') ?? '500');
  if (!Number.isInteger(games) || games < 1) fail(`--games 必须是正整数（收到「${arg('games')}」）`);
  const difficulty = arg('difficulty') ?? 'normal';
  if (!['easy', 'normal', 'hard'].includes(difficulty)) fail(`--difficulty 只能是 easy / normal / hard（收到「${difficulty}」）`);
  return {
    param: parseParam(param), values: parseNumbers('values', values), seeds, games,
    difficulty: difficulty as Difficulty, json: process.argv.includes('--json'),
  };
}

function withParam(param: Param, value: number): GameData {
  const data = cloneData();
  let owner = data.config as unknown as Json;
  for (const k of param.keys.slice(0, -1)) owner = owner[k] as Json;
  owner[param.keys[param.keys.length - 1]] = value;
  return data;
}

function spread(xs: number[]): Spread {
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
}

/** Terminal columns: CJK and full-width characters take two. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0)! >= 0x2e80 ? 2 : 1;
  return w;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

const a = parseArgs();
const t0 = Date.now();
const rows = a.values.map((value) => {
  const data = withParam(a.param, value);
  const reports = a.seeds.map((seed) => simulate({ games: a.games, seed, difficulty: a.difficulty }, data));
  const metrics = Object.fromEntries(METRICS.map((m) => [m.key, spread(reports.map(m.get))]));
  return { value, current: value === a.param.current, metrics, reports };
});

if (a.json) {
  const { param, seeds, games, difficulty } = a;
  console.log(JSON.stringify({ param: param.path, currentValue: param.current, seeds, games, difficulty, rows }, null, 2));
} else {
  const cell = (m: Metric, s: Spread) => `${m.fmt(s.mean)} (${m.fmt(s.min)}–${m.fmt(s.max)})`;
  const table = [
    ['值', ...METRICS.map((m) => m.label)],
    ...rows.map((r) => [`${r.current ? '*' : ' '}${r.value}`, ...METRICS.map((m) => cell(m, r.metrics[m.key]))]),
  ];
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => displayWidth(row[i]))));
  console.log(`\n参数扫描 ${a.param.path}（当前值 ${a.param.current}）  games=${a.games} × seeds ${a.seeds.join(',')}  difficulty=${a.difficulty}  (${Date.now() - t0} ms)`);
  console.log('每格：均值 (各种子最小–最大)；* 为当前配置值');
  for (const row of table) console.log(row.map((c, i) => pad(c, widths[i])).join('  ').trimEnd());
}
