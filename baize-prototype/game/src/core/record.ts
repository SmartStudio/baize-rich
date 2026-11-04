// 对局记录 (playtest record): everything needed to rebuild a game exactly.
// (setup, history) reproduces the engine state; `seats` rebuilds who answers
// each seat's choices. Used for the browser autosave, the downloadable record
// and `npm run replay`.
import type { Difficulty, Personality } from '../ai/ai';
import { defaultData } from './data';
import { Game, type GameOptions } from './engine';
import { HERO_IDS } from './heroes';
import type { GameData, GameSetup } from './types';

export interface SeatControl {
  human: boolean;
  difficulty: Difficulty;
  personality: Personality;
}

export interface GameRecord {
  format: 'baize-record';
  version: 1;
  /** `config.version` of the data the game was played with. */
  dataVersion: string;
  setup: GameSetup;
  seats: SeatControl[];
  history: string[];
  savedAt: string;
  finished: boolean;
}

export type ParseResult = { ok: true; record: GameRecord } | { ok: false; error: string };

export function toRecord(game: Game, seats: SeatControl[], now: Date = new Date()): GameRecord {
  return {
    format: 'baize-record',
    version: 1,
    dataVersion: game.data.config.version,
    setup: structuredClone(game.setup),
    seats: seats.map(({ human, difficulty, personality }) => ({ human, difficulty, personality })),
    history: [...game.history],
    savedAt: now.toISOString(),
    finished: game.over,
  };
}

const DIFFICULTIES: Record<Difficulty, true> = { easy: true, normal: true, hard: true };
const PERSONALITIES: Record<Personality, true> = { steady: true, aggressive: true, miser: true };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRecord(json: unknown, data: GameData = defaultData): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!isObj(json) || json.format !== 'baize-record') return fail('不是白泽秘境的对局记录文件');
  if (json.version !== 1) return fail(`不支持的记录版本 ${String(json.version)}（当前只支持 1）`);
  if (json.dataVersion !== data.config.version) {
    return fail(`数据版本不符：记录为 ${String(json.dataVersion)}，当前为 ${data.config.version}，无法复现`);
  }
  const { setup, seats, history, savedAt, finished } = json;
  if (!isObj(setup) || typeof setup.seed !== 'number' || !Number.isFinite(setup.seed) || !Array.isArray(setup.players)) {
    return fail('记录缺少有效的开局设置（setup）');
  }
  const players = setup.players as unknown[];
  if (players.length === 0) return fail('记录中没有玩家');
  for (const p of players) {
    if (!isObj(p) || typeof p.name !== 'string' || !(HERO_IDS as readonly unknown[]).includes(p.hero)) {
      return fail('记录中的玩家设置无效');
    }
  }
  if (!Array.isArray(seats) || seats.length !== players.length) return fail('席位数与玩家数不一致');
  for (const s of seats as unknown[]) {
    if (!isObj(s) || typeof s.human !== 'boolean'
      || !Object.hasOwn(DIFFICULTIES, String(s.difficulty)) || !Object.hasOwn(PERSONALITIES, String(s.personality))) {
      return fail('记录中的席位设置无效');
    }
  }
  if (!Array.isArray(history) || !history.every((a) => typeof a === 'string')) return fail('记录中的回答历史无效');
  if (typeof savedAt !== 'string' || typeof finished !== 'boolean') return fail('记录缺少保存时间或结束标记');
  return { ok: true, record: json as unknown as GameRecord };
}

/** Rebuilds the game from a parsed record. Throws a Chinese message if the history no longer replays. */
export function replayRecord(record: GameRecord, data: GameData = defaultData, opts: GameOptions = {}): Game {
  try {
    return Game.replay(record.setup, record.history, data, opts);
  } catch (e) {
    throw new Error(`对局记录无法复现：${e instanceof Error ? e.message : String(e)}`);
  }
}
