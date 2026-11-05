import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/engine';
import { HERO_IDS } from '../src/core/heroes';
import { newSession, quickSeats } from '../src/ui/session';

describe('quick start from hero select', () => {
  it.each(HERO_IDS)('puts the chosen hero %s in seat 1 as the only human, with every hero once', (hero) => {
    const seats = quickSeats(hero, 'hard');
    expect(seats[0]).toMatchObject({ hero, human: true });
    expect(seats.slice(1).every((s) => !s.human && s.difficulty === 'hard')).toBe(true);
    expect(new Set(seats.map((s) => s.hero)).size).toBe(HERO_IDS.length);
  });

  it('names a lone human 你 in the game it starts, and keeps P-numbers for AI and hot-seat', () => {
    const solo = newSession(5, quickSeats('sword', 'normal'), 1);
    const g = new Game(solo.setup);
    expect(g.state.players[0]).toMatchObject({ hero: 'sword', name: '你·剑修' });
    expect(g.state.players[1].name).toBe('P2·体修');
    expect(solo.seats.map((s) => s.human)).toEqual([true, false, false, false]);

    const hotSeat = newSession(5, quickSeats('sword', 'normal').map((s, i) => ({ ...s, human: i < 2 })), 1);
    expect(hotSeat.setup.players.map((p) => p.name.split('·')[0])).toEqual(['P1', 'P2', 'P3', 'P4']);
  });
});
