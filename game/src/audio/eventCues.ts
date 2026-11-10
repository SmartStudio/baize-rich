// Which cue an engine event sounds. 闭关突破 is absent on purpose: its cutscene sounds its own beats.
import type { GameEvent, GameEventType } from '../core/events';
import type { Cue } from './cues';

type Pick = (e: GameEvent, humans: ReadonlySet<number>) => Cue | null;

/** Rent and tolls ring as income only for a human being paid by someone else. */
const paid: Pick = (e, humans) => (humans.has(e.payee!) && !humans.has(e.player!) ? 'coinsIn' : 'coinsOut');

const EVENT_CUES: Partial<Record<GameEventType, Cue | Pick>> = {
  roundStart: 'round',
  turnStart: (e, humans) => (humans.has(e.player!) ? 'yourTurn' : null),
  roll: 'roll',
  step: 'step',
  teleport: 'warp',
  buy: 'buy',
  upgrade: 'upgrade',
  salary: 'coinsIn',
  rent: paid,
  passToll: paid,
  tollSum: 'coinsOut',
  toll: 'coinsOut',
  stones: (e) => ((e.amount ?? 0) >= 0 ? 'coinsIn' : 'coinsOut'),
  herbs: 'herb',
  pills: 'pill',
  miniGame: 'brew',
  cult: (e) => ((e.cult?.gained ?? 0) > 0 ? 'cult' : null),
  card: 'card',
  cast: 'cast',
  skill: 'cast',
  block: 'cast',
  roadblock: 'cast',
  event: 'fortune',
  duel: 'hit',
  beast: 'hit',
  roadblockHit: 'hit',
  manifest: 'manifest',
  bankrupt: 'deviate',
  win: (e, humans) => (humans.size === 0 || humans.has(e.player!) ? 'win' : 'lose'),
};

export function cueForEvent(e: GameEvent, humans: ReadonlySet<number>): Cue | null {
  const c = EVENT_CUES[e.type];
  return typeof c === 'function' ? c(e, humans) : c ?? null;
}
