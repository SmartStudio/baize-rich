// Headless driver: runs a Game to completion with one Controller per seat.
import type { Controller } from '../core/choices';
import { Game } from '../core/engine';
import type { GameData, GameSetup } from '../core/types';
import { defaultData } from '../core/data';
import { AIController, type Difficulty, type Personality } from '../ai/ai';

export interface HeadlessSeat {
  difficulty?: Difficulty;
  personality?: Personality;
}

export function runHeadless(
  setup: GameSetup,
  seats: HeadlessSeat[],
  data: GameData = defaultData,
  maxChoices = 50000,
): { game: Game; controllers: Controller[] } {
  const game = new Game(setup, data);
  const controllers = seats.map((s, i) => new AIController(game, i, { ...s, seed: setup.seed }));
  game.start();
  let n = 0;
  while (!game.over) {
    const c = game.pending;
    if (!c) throw new Error('engine stalled without a pending choice');
    game.answer(controllers[c.player].decide(c));
    if (++n > maxChoices) throw new Error(`game ${setup.seed} exceeded ${maxChoices} choices`);
  }
  return { game, controllers };
}
