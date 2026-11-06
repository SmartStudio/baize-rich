// Which screen asks which engine choice. A kind without an entry gets the engine's options as a plain list.
// preRoll / action (the dock buttons), miniGame (火候 overlay) and the board picks (ui/pickPlan) never reach here.
import type { ChoiceKind, PendingChoice, PendingChoiceOf } from '../../core/choices';
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

export function presentChoice(c: PendingChoice, env: ChoiceEnv): ModalSpec {
  const spec = presenterFor(c)(c, env);
  return env.who ? { ...spec, title: `${env.who} · ${spec.title}` } : spec;
}
