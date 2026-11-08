import { describe, expect, it } from 'vitest';
import { cloneData, defaultData } from '../src/core/data';
import {
  coachCopy, dismiss, emptyBook, nudge, observe,
  type CoachMoment,
} from '../src/ui/coachTriggers';
import { parseCoachSave } from '../src/ui/saves';

const copy = coachCopy(defaultData);

function choice(partial: Partial<Extract<CoachMoment, { t: 'choice' }>> & Pick<Extract<CoachMoment, { t: 'choice' }>, 'kind'>): CoachMoment {
  return { t: 'choice', human: true, seat: 0, closure: false, ...partial };
}

describe('first-game coach', () => {
  it('shows the roll sentence before the win sentence, then neither again', () => {
    const first = observe(emptyBook(), choice({ kind: 'preRoll' }), copy);
    expect(first.cue?.step).toBe('roll');
    expect(first.cue?.text).toContain('按空格掷骰');
    expect(first.cue?.at).toEqual({ t: 'roll' });
    const afterRoll = nudge(dismiss(first.book, 'roll'));
    expect(afterRoll.cue?.step).toBe('win');
    expect(afterRoll.cue?.text).toBe('先渡劫化神的人赢。秘境第十二年关闭，到时看谁境界最高。');
    expect(afterRoll.cue?.at).toEqual({ t: 'round' });
    const quiet = observe(dismiss(afterRoll.book, 'win'), choice({ kind: 'preRoll' }), copy);
    expect(quiet.cue).toBeNull();
  });

  it('points the buy sentence at the land being offered', () => {
    const next = observe(emptyBook(), choice({ kind: 'buy', node: 'R1', nodeType: 'land' }), copy);
    expect(next.cue).toMatchObject({ step: 'buy', at: { t: 'tile', node: 'R1' } });
    expect(next.cue?.text).toContain('买下它');
  });

  it('queues cultivation before herbs when both just happened', () => {
    const cult = observe(emptyBook(), {
      t: 'event', human: true, seat: 1, type: 'cult', cultGained: 1, glowing: false,
    }, copy);
    expect(cult.cue).toMatchObject({ step: 'cult', seat: 1, at: { t: 'cult' } });
    const both = observe(cult.book, {
      t: 'event', human: true, seat: 1, type: 'herbs', node: 'R6', nodeType: 'alchemy', cultGained: 0, glowing: false,
    }, copy);
    expect(both.cue).toBeNull();
    expect(nudge(dismiss(both.book, 'cult')).cue).toMatchObject({ step: 'herbs', at: { t: 'tile', node: 'R6' } });
  });

  it('fires closure from a choice and glow from the moment the player starts shining', () => {
    const closing = observe(emptyBook(), choice({ kind: 'action', closure: true }), copy);
    expect(closing.cue).toMatchObject({ step: 'closure', at: { t: 'closure' } });
    expect(closing.cue?.text).toContain('药圃');
    const shining = observe(emptyBook(), {
      t: 'event', human: true, seat: 0, type: 'pills', cultGained: 0, glowing: true,
    }, copy);
    expect(shining.cue).toMatchObject({ step: 'glow', at: { t: 'glow' } });
    expect(shining.cue?.text).toContain('三颗');
  });

  it('drops a tip queued behind an unread bubble once its moment has passed, unseen, so the next such moment shows it', () => {
    const reading = observe(emptyBook(), choice({ kind: 'preRoll' }), copy);
    expect(reading.cue?.step).toBe('roll');
    const offered = observe(reading.book, choice({ kind: 'buy', node: 'R1', nodeType: 'land' }), copy);
    expect(offered.book.waiting.map((c) => c.step)).toEqual(['buy', 'win']);
    const bought = observe(offered.book, { t: 'event', human: true, seat: 0, type: 'buy', node: 'R1', nodeType: 'land', cultGained: 0, glowing: false }, copy);
    expect(bought.book.waiting.map((c) => c.step)).toEqual(['win']);
    const read = nudge(dismiss(bought.book, 'roll'));
    expect(read.cue?.step).toBe('win');
    expect(read.book.seen).not.toContain('buy');
    const again = observe(dismiss(read.book, 'win'), choice({ kind: 'buy', node: 'R2', nodeType: 'land' }), copy);
    expect(again.cue).toMatchObject({ step: 'buy', at: { t: 'tile', node: 'R2' } });
  });

  it('keeps a queued tip that is still true after its moment: the 修为条 and the win rule wait their turn', () => {
    const reading = observe(emptyBook(), choice({ kind: 'action', closure: true }), copy);
    const grown = observe(reading.book, { t: 'event', human: true, seat: 0, type: 'cult', cultGained: 1, glowing: false }, copy);
    expect(grown.book.waiting.map((c) => c.step)).toEqual(['cult']);
    const later = observe(grown.book, { t: 'event', human: false, seat: 1, type: 'turnStart', cultGained: 0, glowing: false }, copy);
    expect(nudge(dismiss(later.book, 'closure')).cue?.step).toBe('cult');
  });

  it('stays quiet for an AI and when the guide is off', () => {
    const ai = observe(emptyBook(), choice({ kind: 'preRoll', human: false }), copy);
    expect(ai.cue).toBeNull();
    const off = observe(emptyBook(), choice({ kind: 'preRoll' }), copy, false);
    expect(off.cue).toBeNull();
    expect(off.book.waiting).toEqual([]);
  });

  it('reads the win year and the herb count from data', () => {
    const data = cloneData();
    data.config.rounds = 9;
    data.config.alchemy.herbsPerPill = 4;
    const lines = coachCopy(data);
    expect(lines.win).toContain('第九年');
    expect(lines.herbs).toContain('四株');
  });

  it('treats a missing or broken save as the guide being on', () => {
    expect(parseCoachSave(null)).toEqual({ armed: true, seen: [] });
    expect(parseCoachSave('nope')).toEqual({ armed: true, seen: [] });
    expect(parseCoachSave(JSON.stringify({ armed: false, seen: ['roll', 'nope', 3] }))).toEqual({ armed: false, seen: ['roll'] });
    expect(parseCoachSave(JSON.stringify({ seen: ['buy'] }))).toEqual({ armed: true, seen: ['buy'] });
  });
});
