// Saved games that stop on a human (seat 0) choice, for screenshots of the dedicated choice screens.
//   npx tsx scripts/choice-scenarios.ts  → JSON on stdout
// Every seat plays as the AI until seat 0 is asked the wanted kind; the record replays to exactly that ask.
import { AIController } from '../src/ai/ai';
import type { ChoiceKind, PendingChoice } from '../src/core/choices';
import { defaultData } from '../src/core/data';
import { Game } from '../src/core/engine';
import { toRecord, type GameRecord } from '../src/core/record';
import type { HeroId } from '../src/core/types';
import { newSession, quickSeats } from '../src/ui/session';

const MAX_SEED = 400;

function findAsk(hero: HeroId, kind: ChoiceKind, accept: (g: Game, c: PendingChoice) => boolean = () => true): GameRecord {
  for (let seed = 1; seed <= MAX_SEED; seed++) {
    const s = newSession(seed, quickSeats(hero, 'normal'), 1);
    const g = new Game(s.setup, defaultData);
    const ais = s.seats.map((seat, i) => new AIController(g, i, { difficulty: seat.difficulty, personality: seat.personality, seed }));
    g.start();
    while (!g.over) {
      const c = g.pending!;
      if (c.player === 0 && c.kind === kind && accept(g, c)) return toRecord(g, s.seats);
      g.answer(ais[c.player].decide(c));
    }
  }
  throw new Error(`no seed up to ${MAX_SEED} asks seat 0 for ${kind}`);
}

function breakthroughAfter(g: Game, answer: string): boolean {
  const next = Game.replay(g.setup, [...g.history, answer], g.data);
  return next.log.findLast((e) => e.type === 'breakthrough')!.breakthrough!.success;
}

/** A stake of 2+ pills where the most pills break through and none fails, with no 清心符 prompt in between. */
const stakeIds = (c: PendingChoice): string[] => c.options.map((o) => o.id).filter((id) => id !== c.cancelId);
const stakeDecides = (g: Game, c: PendingChoice): boolean => {
  const most = stakeIds(c).at(-1)!;
  return stakeIds(c).length >= 3 && !g.state.players[0].hand.includes('calm') && breakthroughAfter(g, most) && !breakthroughAfter(g, 's0');
};

const stake = findAsk('body', 'stake', stakeDecides);
const stakeAsk = Game.replay(stake.setup, stake.history).pending!;
console.log(JSON.stringify({
  stake: { record: stake, win: stakeIds(stakeAsk).at(-1)!.slice(1), lose: '0' },
  brew: { record: findAsk('alch', 'brew', (_g, c) => c.options.length >= 4) },
  market: { record: findAsk('magic', 'market') },
  fortune: { record: findAsk('sword', 'fortunePick') },
  manifest: { record: findAsk('body', 'manifestPick', (_g, c) => c.options.length >= 3) },
}));
