// Headless driver: runs a Game to completion with one Controller per seat.
import type { Controller, PendingChoice } from '../core/choices';
import { Game } from '../core/engine';
import type { GameEvent } from '../core/events';
import type { GameData, GameSetup } from '../core/types';
import { defaultData } from '../core/data';
import { AIController, type Difficulty, type Personality } from '../ai/ai';

export interface HeadlessSeat {
  difficulty?: Difficulty;
  personality?: Personality;
}

export interface HeadlessOptions {
  maxChoices?: number;
  /** Called before the answer is applied, so it runs before the events that answer triggers. */
  onChoice?: (c: PendingChoice, answer: string) => void;
  onEvent?: (e: GameEvent, game: Game) => void;
}

export function runHeadless(
  setup: GameSetup,
  seats: HeadlessSeat[],
  data: GameData = defaultData,
  { maxChoices = 50000, onChoice, onEvent }: HeadlessOptions = {},
): { game: Game; controllers: Controller[] } {
  const game = new Game(setup, data);
  if (onEvent) game.onEvent((e) => onEvent(e, game));
  const controllers = seats.map((s, i) => new AIController(game, i, { ...s, seed: setup.seed }));
  game.start();
  let n = 0;
  while (!game.over) {
    const c = game.pending;
    if (!c) throw new Error('engine stalled without a pending choice');
    const answer = controllers[c.player].decide(c);
    onChoice?.(c, answer);
    game.answer(answer);
    if (++n > maxChoices) throw new Error(`game ${setup.seed} exceeded ${maxChoices} choices`);
  }
  return { game, controllers };
}
