// Replays a downloaded 对局记录 headlessly and prints a summary.
//   npm run replay -- <record.json> [--log]
import { readFileSync } from 'node:fs';
import { DIFFICULTY_LABEL, PERSONALITY_LABEL } from '../ai/ai';
import { parseRecord, replayRecord } from '../core/record';
import { realmName, totalAssets } from '../core/rules';

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) die('用法：npm run replay -- <对局记录.json> [--log]');

let json: unknown;
try {
  json = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  die(`无法读取 ${file}：${e instanceof Error ? e.message : String(e)}`);
}
const parsed = parseRecord(json);
if (!parsed.ok) die(`无效的对局记录 ${file}：${parsed.error}`);
const rec = parsed.record;

let game;
try {
  game = replayRecord(rec);
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}

if (process.argv.includes('--log')) for (const e of game.log) if (e.text) console.log(`[R${e.round}] ${e.text}`);

const st = game.state;
console.log(`\n凡人问道 · 对局复盘  ${file}`);
console.log(`种子 ${rec.setup.seed} · 数据版本 ${rec.dataVersion} · 保存于 ${rec.savedAt} · 共 ${rec.history.length} 次决定`);
if (st.over) {
  const reason = st.endReason === 'ascend' ? '渡劫化神' : `第 ${game.data.config.rounds} 轮秘境关闭，境界最高`;
  console.log(`结果：${st.players[st.winner!].name} 获胜（${reason}），共 ${st.round} 轮`);
} else {
  const c = game.pending!;
  console.log(`未结束：停在第 ${st.round} 轮，等待 ${st.players[c.player].name} 决定「${c.title}」`);
}
console.log('');
for (const seat of game.ranking()) {
  const p = st.players[seat];
  const s = rec.seats[seat];
  const who = s.human ? '玩家' : `AI·${DIFFICULTY_LABEL[s.difficulty]}·${PERSONALITY_LABEL[s.personality]}`;
  console.log(`  ${p.name}（${who}）${realmName(game.data, p.realm)} 修为 ${p.cult} · 灵石 ${p.stones} · 丹药 ${p.pills} · 灵草 ${p.herbs} · 突破 ${p.stats.breakthroughs} 次 · 总资产 ${totalAssets(st, game.board, game.data, seat)}`);
}
