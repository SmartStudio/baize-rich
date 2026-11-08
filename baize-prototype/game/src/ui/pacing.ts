// How long the board playback lingers on each beat. An AI turn plays every beat a little shorter than the
// human's and slows to the human pace for what touches a human seat; GameScene just waits the numbers given here.
import type { GameEvent, GameEventType } from '../core/events';
import type { GameState } from '../core/types';

/** watch: a human's own turn, or an AI beat that touches a human or the whole table. skim: an AI's own business. */
export type Tempo = 'watch' | 'skim';

/**
 * Beat lengths in ms at 1×. `pause` follows a slow event; `banner` is a full-width cutscene; `fly` is 灵石
 * hopping from payer to payee, then `grow` is the bought or upgraded building rising.
 */
export interface Pace {
  step: number;
  teleport: number;
  roll: number;
  rollHold: number;
  pause: number;
  banner: number;
  fly: number;
  grow: number;
}

export const PACE: Record<Tempo, Pace> = {
  watch: { step: 300, teleport: 640, roll: 900, rollHold: 800, pause: 850, banner: 1700, fly: 460, grow: 380 },
  skim: { step: 200, teleport: 440, roll: 700, rollHold: 450, pause: 520, banner: 1200, fly: 340, grow: 280 },
};

/** An AI seat's turn: how long its turn ribbon holds and how long it seems to think before each answer. */
export const AI_TURN = { intro: 650, think: 350, thinkModal: 480 };
/** A human seat's "轮到你了" banner; not awaited, the roll is live under it. */
export const HUMAN_INTRO = 1100;

/** Events that hold the board for a `pause` after they show. */
export const PAUSE_EVENTS = new Set<GameEventType>([
  'buy', 'rent', 'upgrade', 'cult', 'event', 'cast', 'block', 'skill', 'roadblock', 'roadblockHit', 'roadblockGone',
]);

const TABLE_WIDE = new Set<GameEventType>(['manifest', 'win']);

/**
 * `prev` is the state before `e` (null at the start). A beat is the human's business when it is their turn,
 * names them (bound, dazed, their 金光符), puts them in a duel, or moves their 灵石 / 丹药 / 灵草 / 修为
 * (rent paid to them, pills robbed from them).
 */
export function tempoOf(e: GameEvent, prev: GameState | null, humans: ReadonlySet<number>): Tempo {
  const st = e.snap;
  if (!st || TABLE_WIDE.has(e.type) || humans.has(st.current)) return 'watch';
  if (e.player !== undefined && humans.has(e.player)) return 'watch';
  if (e.duel && (humans.has(e.duel.attacker) || humans.has(e.duel.defender))) return 'watch';
  return prev && [...humans].some((seat) => holdingsMoved(prev, st, seat)) ? 'watch' : 'skim';
}

function holdingsMoved(a: GameState, b: GameState, seat: number): boolean {
  const p = a.players[seat];
  const q = b.players[seat];
  return p.stones !== q.stones || p.pills !== q.pills || p.herbs !== q.herbs || p.cult !== q.cult;
}

/** 闭关 cutscene beats in ms at 1×. Every one plays for any seat; an AI's are shorter than the human's. */
export interface BreakthroughBeats {
  in: number;
  tumble: number;
  settle: number;
  bonus: number;
  verdict: number;
  flash: number;
  drop: number;
  shakeStep: number;
  result: number;
  out: number;
}

const BREAKTHROUGH: Record<'human' | 'ai', BreakthroughBeats> = {
  human: { in: 220, tumble: 700, settle: 260, bonus: 240, verdict: 420, flash: 560, drop: 360, shakeStep: 40, result: 1700, out: 260 },
  ai: { in: 150, tumble: 420, settle: 140, bonus: 120, verdict: 220, flash: 400, drop: 240, shakeStep: 28, result: 800, out: 180 },
};

export function breakthroughBeats(human: boolean, speed: number): BreakthroughBeats {
  const base = BREAKTHROUGH[human ? 'human' : 'ai'];
  const scaled = { ...base };
  for (const k of Object.keys(base) as (keyof BreakthroughBeats)[]) scaled[k] = base[k] / speed;
  return scaled;
}

/** The 倍速 (F) cycle, each with what it does at the table. */
export const SPEEDS: readonly { speed: number; note: string }[] = [
  { speed: 0.5, note: '全部慢一倍：每一拍都细看' },
  { speed: 1, note: 'AI 每一步都看得清，与你有关的事放得更慢' },
  { speed: 2, note: '全部快一倍：AI 回合一闪而过' },
  { speed: 4, note: '全部快四倍：只看结果' },
];

export function nextSpeed(speed: number): number {
  const i = SPEEDS.findIndex((s) => s.speed === speed);
  return SPEEDS[(i + 1) % SPEEDS.length].speed;
}

export function speedNote(speed: number): string {
  return SPEEDS.find((s) => s.speed === speed)?.note ?? `全部按 ×${speed}`;
}
