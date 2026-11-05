import type { PendingChoice } from '../src/core/choices';
import { Game } from '../src/core/engine';
import type { GameData } from '../src/core/types';
import { cloneData, defaultData } from '../src/core/data';
import ringBoard from './fixtures/ring-board.json';

/**
 * The v0.4 32-cell ring map (R0–R31, 神道 S/W/N/E, ALTAR) frozen as a fixture.
 * Rule tests that need fixed coordinates run on it, so they keep passing when data/board.json changes.
 */
export function ringData(): GameData {
  const d = cloneData();
  d.board = JSON.parse(JSON.stringify(ringBoard)) as GameData['board'];
  return d;
}

export function newGame(seed = 1, data: GameData = defaultData): Game {
  return new Game({
    seed,
    players: [
      { name: 'A', hero: 'body' },
      { name: 'B', hero: 'magic' },
      { name: 'C', hero: 'sword' },
      { name: 'D', hero: 'alch' },
    ],
  }, data);
}

/** newGame on the ring fixture. */
export function ringGame(seed = 1, data: GameData = ringData()): Game {
  return newGame(seed, data);
}

/** Scripted answerer: map choice kind -> option id (or function). Unlisted kinds take the default/first option. */
export function script(
  answers: Partial<Record<PendingChoice['kind'], string | string[] | ((c: PendingChoice) => string)>>,
  seen: PendingChoice[] = [],
) {
  const queues = new Map<string, string[]>();
  for (const [k, v] of Object.entries(answers)) if (Array.isArray(v)) queues.set(k, [...v]);
  return (c: PendingChoice): string => {
    seen.push(c);
    const a = answers[c.kind];
    if (typeof a === 'function') return a(c);
    if (Array.isArray(a)) {
      const q = queues.get(c.kind)!;
      if (q.length) return q.shift()!;
    } else if (typeof a === 'string') return a;
    return c.defaultId ?? c.options[0].id;
  };
}

/** Makes every land empty and places all players far away from the test area. */
export function placeAll(g: Game, node = 'R0'): void {
  for (const p of g.state.players) p.pos = node;
}
