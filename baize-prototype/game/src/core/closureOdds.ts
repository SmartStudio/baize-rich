// 闭关 odds before the roll, for every screen that shows them and for the engine's own stake hints.
import type { BreakthroughBonuses } from './events';
import { chance2d6, fixedBonuses, realmOf } from './rules';
import type { GameData, GameState } from './types';

export interface StakeOdds {
  pills: number;
  /** Smallest 2D6 sum that breaks through with this stake. */
  need: number;
  chance: number;
}

export interface ClosureOdds {
  target: number;
  fixed: Omit<BreakthroughBonuses, 'pills' | 'calm'>;
  /** 清心符's bonus when the hand is seen and holds one, else 0. Counted in every chance: the 清心符 ask defaults to using it. */
  calm: number;
  /** Every bonus but the stake: `fixed` plus `calm`. */
  bonus: number;
  /** One entry per stake from 0 up to maxPills or the pills that may be staked, whichever is lower. */
  stakes: StakeOdds[];
}

/** `pills` that may be staked (default: all held); `seesHand` false for a readout shown to other players. */
export interface OddsView {
  pills?: number;
  seesHand?: boolean;
}

export function closureOdds(state: GameState, data: GameData, seat: number, site: number, view: OddsView = {}): ClosureOdds {
  const p = state.players[seat];
  const { pills = p.pills, seesHand = true } = view;
  const b = data.config.breakthrough;
  const target = realmOf(data, p.realm).target;
  const fixed = fixedBonuses(state, data, seat, site);
  const calm = seesHand && p.hand.includes('calm') ? b.calmBonus : 0;
  const bonus = Object.values(fixed).reduce((a, v) => a + v, calm);
  const stakes: StakeOdds[] = [];
  for (let k = 0; k <= Math.min(b.maxPills, pills); k++) {
    const need = target - bonus - k * b.pillBonus;
    stakes.push({ pills: k, need, chance: chance2d6(need) });
  }
  return { target, fixed, calm, bonus, stakes };
}

export function percent(chance: number): string {
  return `${Math.round(chance * 100)}%`;
}
