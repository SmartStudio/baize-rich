import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameEventType } from '../src/core/events';
import { EVENT_NARRATION } from '../src/ui/narration';

function declaredEventTypes(): GameEventType[] {
  const source = readFileSync(new URL('../src/core/events.ts', import.meta.url), 'utf8');
  const declaration = source.match(/export type GameEventType =([\s\S]*?);/)?.[1];
  if (!declaration) throw new Error('GameEventType declaration not found');
  return [...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1] as GameEventType);
}

describe('event narration registry', () => {
  it('covers every GameEventType with narration or an explicit silent marker', () => {
    expect(Object.keys(EVENT_NARRATION).sort()).toEqual(declaredEventTypes().sort());
  });
});
