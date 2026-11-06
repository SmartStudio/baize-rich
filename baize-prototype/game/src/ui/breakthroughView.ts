// The 闭关突破 cutscene as plain data, read off the engine's `breakthrough` event (docs/script.md §4, §5).
import { ALTAR } from '../core/board';
import type { Game } from '../core/engine';
import type { BreakthroughBonuses, GameEvent } from '../core/events';
import { hasTrait, realmName, realmOf } from '../core/rules';
import { signed } from './choices/spec';

/** Names of the breakthrough bonuses, in the order the check lists them. */
export const BONUS_LABEL: Record<keyof BreakthroughBonuses, string> = {
  pills: '丹药', site: '地利', mind: '心境', guidance: '指点', insight: '感悟', momentum: '战意', calm: '清心',
};

/** Success line by the realm reached; 化神 names the winner. */
const ASCEND_LINE: Record<number, (name: string) => string> = {
  1: () => '气海成池，道基已筑。',
  2: () => '丹成一粒，自此不同凡俗。',
  3: () => '碎丹成婴，神魂不灭。',
  4: (name) => `天劫散尽，${name}，化神了。`,
};
const FAIL_LINE = '气血逆冲……这一次，没成。';
const STEADY_LINE = '皮糙肉厚，修为没散。';
const BAIZE_LINE = { success: '白泽：「不错。你比他们走得远。」', fail: '白泽：「急了。凡人总是急。」' };

export interface BonusLine {
  label: string;
  value: number;
}

export interface BreakthroughView {
  seat: number;
  who: string;
  portrait: string;
  from: string;
  to: string;
  target: number;
  dice: [number, number];
  /** Non-zero bonuses in check order; 地利 can be negative (引雷破境). */
  bonuses: BonusLine[];
  total: number;
  success: boolean;
  /** What the attempt gained (success) or cost (走火入魔). */
  outcome: string[];
  lines: string[];
}

export function breakthroughView(game: Game, e: GameEvent): BreakthroughView {
  const r = e.breakthrough!;
  const seat = e.player!;
  const st = e.snap ?? game.state;
  const p = st.players[seat];
  const to = realmOf(game.data, r.from + 1);
  const keys = Object.keys(BONUS_LABEL) as (keyof BreakthroughBonuses)[];
  const lines = [r.success ? ASCEND_LINE[r.from + 1]?.(p.name) ?? '' : hasTrait(game.data, p, 'steadyBar') ? STEADY_LINE : FAIL_LINE];
  if (p.pos === ALTAR) lines.push(r.success ? BAIZE_LINE.success : BAIZE_LINE.fail);
  return {
    seat,
    who: p.name,
    portrait: `por_${p.hero}`,
    from: realmName(game.data, r.from),
    to: to.name,
    target: r.target,
    dice: r.dice,
    bonuses: keys.filter((k) => r.bonuses[k] !== 0).map((k) => ({ label: BONUS_LABEL[k], value: r.bonuses[k] })),
    total: r.total,
    success: r.success,
    outcome: r.success ? ascendOutcome(game, to.name, to.ability, r.stake) : failOutcome(r.stake, r.cultLost),
    lines: lines.filter(Boolean),
  };
}

function ascendOutcome(game: Game, realm: string, ability: ReturnType<typeof realmOf>['ability'], stake: number): string[] {
  return [`晋入${realm}`, ...(ability ? [`领悟${game.abilityName(ability)}`] : []), ...(stake ? [`丹药 −${stake}`] : [])];
}

function failOutcome(stake: number, cultLost: number): string[] {
  return [...(stake ? [`丹药 −${stake}`] : []), cultLost ? `修为 ${signed(-cultLost)}` : '修为未损', '心境 +1'];
}
