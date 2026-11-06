// 押丹: one tile per pill count with the success chance it buys, the realm climb and every fixed bonus on top.
import { chance2d6, fixedBonuses, realmName } from '../../core/rules';
import { BONUS_LABEL } from '../breakthroughView';
import { signed, type Fact, type ModalOption, type Presenter, type Tone } from './spec';

export const stake: Presenter<'stake'> = (c, { game }) => {
  const { data, state } = game;
  const b = data.config.breakthrough;
  const p = state.players[c.player];
  const target = c.ctx.target!;
  const options: ModalOption[] = c.options.map((o) => {
    const need = target - c.ctx.bonus! - o.value * b.pillBonus;
    const odds = chance2d6(need);
    return {
      id: o.id,
      key: String(o.value),
      label: o.value === 0 ? '不押丹' : `押 ${o.value} 颗 +${o.value * b.pillBonus}`,
      icon: 'ic_pill',
      count: o.value,
      big: `${Math.round(odds * 100)}%`,
      tone: oddsTone(odds),
      meter: odds,
      hint: need <= 2 ? '稳成' : need > 12 ? '无望' : `2D6 ≥ ${need}`,
    };
  });
  return {
    title: c.title,
    headline: `${realmName(data, p.realm)} → ${realmName(data, p.realm + 1)} · 目标 ${target}`,
    desc: `押几颗丹药？每颗 +${b.pillBonus}。押上的丹药无论成败都会消耗（持有 ${p.pills} 颗）。`,
    facts: [...bonusFacts(fixedBonuses(state, data, c.player, c.ctx.site!)), ...calmFact(p.hand.includes('calm'), b.calmBonus)],
    options,
    defaultId: c.defaultId,
    cancelId: c.cancelId,
    layout: 'tiles',
  };
};

function bonusFacts(fixed: ReturnType<typeof fixedBonuses>): Fact[] {
  const keys = Object.keys(fixed) as (keyof typeof fixed)[];
  return keys
    .filter((k) => k === 'site' || fixed[k] !== 0)
    .map((k): Fact => ({ label: BONUS_LABEL[k], value: signed(fixed[k]), tone: fixed[k] > 0 ? 'good' : fixed[k] < 0 ? 'bad' : 'dim' }));
}

/** 清心符 is asked after the stake, so the odds above leave it out. */
function calmFact(held: boolean, bonus: number): Fact[] {
  return held ? [{ label: '清心符', value: `可再 +${bonus}`, tone: 'gold' }] : [];
}

function oddsTone(odds: number): Tone {
  return odds >= 0.7 ? 'good' : odds >= 0.4 ? 'gold' : 'bad';
}
