// Which screen asks which engine choice. A kind without an entry gets the engine's options as a plain list.
// preRoll / action (the dock buttons), miniGame (火候 overlay) and the board picks (ui/pickPlan) never reach here.
import type { ChoiceKind, ChoiceOption, PendingChoice, PendingChoiceOf } from '../../core/choices';
import { percent } from '../../core/closureOdds';
import { duelBonus, duelWinChance } from '../../core/rules';
import { fortunePick, manifestPick } from './cards';
import { brew, market } from './goods';
import { buy, guardReact as basicGuardReact, listSpec, rentReact } from './prompts';
import type { ChoiceEnv, ModalSpec, Presenter } from './spec';
import { stake } from './stake';

const PRESENTERS: { [K in ChoiceKind]?: Presenter<K> } = {
  stake,
  brew,
  market,
  fortunePick,
  manifestPick,
  buy,
  rentReact,
  duel,
  guardReact,
};

function presenterFor<K extends ChoiceKind>(c: PendingChoiceOf<K>): Presenter<K> {
  return PRESENTERS[c.kind] ?? (listSpec as Presenter<K>);
}

/** The answer to an ask whose options all mean the same (the last 白泽 gift, two copies of one 机缘): no screen needed. */
export function onlyAnswer(c: PendingChoice): string | null {
  const values = new Set((c.options as ChoiceOption<unknown>[]).map((o) => JSON.stringify(o.value)));
  return values.size === 1 ? c.options[0].id : null;
}

export function presentChoice(c: PendingChoice, env: ChoiceEnv): ModalSpec {
  const spec = presenterFor(c)(c, env);
  return env.who ? { ...spec, title: `${env.who} · ${spec.title}` } : spec;
}

function duel(choice: PendingChoiceOf<'duel'>, { game }: ChoiceEnv): ModalSpec {
  return listSpec(choice, {
    options: choice.options.map((option) => {
      const defender = option.value;
      if (defender === null) return { id: option.id, label: option.label, hint: option.hint };
      const bonus = duelBonus(game.state, game.data, choice.player, defender);
      const win = duelWinChance(bonus[0] - bonus[1]);
      return {
        id: option.id,
        label: option.label,
        hint: `胜 ${percent(win)} · 加成 ${bonus[0]} 对 ${bonus[1]} · 赢 ${loot(game.duelLoot(defender))} · 输 ${loot(game.duelLoot(choice.player))} · 平局守方胜`,
      };
    }),
  });
}

function guardReact(choice: PendingChoiceOf<'guardReact'>, env: ChoiceEnv): ModalSpec {
  const spec = basicGuardReact(choice, env);
  if (choice.ctx.threat !== 'duel' || choice.ctx.attacker === undefined) return spec;
  const { game } = env;
  const attacker = choice.ctx.attacker;
  const bonus = duelBonus(game.state, game.data, attacker, choice.player);
  const defend = 1 - duelWinChance(bonus[0] - bonus[1]);
  const stakes = `守住 ${percent(defend)} · 加成 ${bonus[1]} 对 ${bonus[0]} · 胜可夺 ${loot(game.duelLoot(attacker))} · 输掉 ${loot(game.duelLoot(choice.player))} · 平局你胜`;
  return { ...spec, desc: [spec.desc, stakes].filter(Boolean).join('\n') };
}

function loot(value: { pills: number; stones: number }): string {
  return value.pills > 0 ? `${value.pills} 颗丹药` : `${value.stones} 灵石`;
}
