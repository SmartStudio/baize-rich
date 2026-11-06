// Which screen asks which engine choice. A kind without an entry gets the engine's options as a plain list.
// preRoll / action (the dock buttons), miniGame (火候 overlay) and the board picks (ui/pickPlan) never reach here.
import type { ChoiceKind, ChoiceOption, PendingChoice, PendingChoiceOf } from '../../core/choices';
import { fortunePick, manifestPick } from './cards';
import { brew, market } from './goods';
import { buy, guardReact, listSpec, rentReact } from './prompts';
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
