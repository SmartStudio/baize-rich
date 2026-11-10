// 押丹: one tile per pill count with the success chance it buys, the realm climb and every bonus on top.
import { closureOdds, percent, type ClosureOdds } from '../../core/closureOdds';
import { realmName } from '../../core/rules';
import { BONUS_LABEL } from '../breakthroughView';
import { signed, type Fact, type ModalOption, type Presenter, type Tone } from './spec';

export const stake: Presenter<'stake'> = (c, { game }) => {
  const { data, state } = game;
  const b = data.config.breakthrough;
  const p = state.players[c.player];
  const odds = closureOdds(state, data, c.player, c.ctx.site!);
  const options: ModalOption[] = c.options.flatMap((o) => {
    if (o.value === null) return [];
    const { need, chance } = odds.stakes[o.value];
    return [{
      id: o.id,
      key: String(o.value),
      label: o.value === 0 ? '不押丹' : `押 ${o.value} 颗 +${o.value * b.pillBonus}`,
      icon: 'ic_pill',
      count: o.value,
      big: percent(chance),
      tone: oddsTone(chance),
      meter: chance,
      hint: need <= 2 ? '稳成' : need > 12 ? '无望' : `2D6 ≥ ${need}`,
    }];
  });
  return {
    title: c.title,
    headline: `${realmName(data, p.realm)} → ${realmName(data, p.realm + 1)} · 目标 ${odds.target}`,
    desc: `押几颗丹药？每颗 +${b.pillBonus}。押上的丹药无论成败都会消耗（持有 ${p.pills} 颗）。`,
    facts: bonusFacts(odds),
    options,
    defaultId: c.defaultId,
    cancelId: c.cancelId,
    closable: c.cancelId !== undefined,
    layout: 'tiles',
  };
};

function bonusFacts(odds: ClosureOdds): Fact[] {
  const { fixed } = odds;
  const keys = Object.keys(fixed) as (keyof typeof fixed)[];
  const facts = keys
    .filter((k) => k === 'site' || fixed[k] !== 0)
    .map((k): Fact => ({ label: BONUS_LABEL[k], value: signed(fixed[k]), tone: fixed[k] > 0 ? 'good' : fixed[k] < 0 ? 'bad' : 'dim' }));
  return odds.calm ? [...facts, { label: '清心符', value: signed(odds.calm), tone: 'gold' }] : facts;
}

function oddsTone(odds: number): Tone {
  return odds >= 0.7 ? 'good' : odds >= 0.4 ? 'gold' : 'bad';
}
