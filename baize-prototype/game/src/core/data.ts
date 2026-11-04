// Loads the design data from ../../../data/*.json (single source of numbers).
// Pure TS: usable from Phaser, node (tsx) and vitest alike.
import config from '../../../data/config.json';
import board from '../../../data/board.json';
import heroes from '../../../data/heroes.json';
import spells from '../../../data/spells.json';
import events from '../../../data/events.json';
import blessings from '../../../data/blessings.json';
import type { GameData } from './types';

export const defaultData: GameData = {
  config: config as GameData['config'],
  board: board as unknown as GameData['board'],
  heroes: heroes as GameData['heroes'],
  spells: spells as GameData['spells'],
  events: events as GameData['events'],
  blessings: blessings as GameData['blessings'],
};

/** Deep copy so tests can tweak numbers without affecting other games. */
export function cloneData(d: GameData = defaultData): GameData {
  return JSON.parse(JSON.stringify(d)) as GameData;
}
