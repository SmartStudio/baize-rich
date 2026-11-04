import type { PendingChoice } from '../src/core/choices';
import { Game } from '../src/core/engine';

export function newGame(seed = 1): Game {
  return new Game({
    seed,
    players: [
      { name: 'A', hero: 'body' },
      { name: 'B', hero: 'magic' },
      { name: 'C', hero: 'sword' },
      { name: 'D', hero: 'alch' },
    ],
  });
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
