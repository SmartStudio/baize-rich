// Small prompts that stay in the list menu but add one line of context to it.
import type { ChoiceOption, PendingChoice } from '../../core/choices';
import type { Game } from '../../core/engine';
import { nominalRent } from '../../core/rules';
import type { ModalSpec, Presenter } from './spec';

/** The engine's own wording, one list button per option. */
export function listSpec(c: PendingChoice, extra: Partial<ModalSpec> = {}): ModalSpec {
  return {
    title: c.title,
    desc: c.desc,
    options: (c.options as ChoiceOption<unknown>[]).map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
    defaultId: c.defaultId,
    cancelId: c.cancelId,
    layout: 'list',
    ...extra,
  };
}

const cardsHeld = (game: Game, c: PendingChoice, card: string): number =>
  game.state.players[c.player].hand.filter((x) => x === card).length;

export const buy: Presenter<'buy'> = (c, { game }) => {
  const n = game.board.node(c.ctx.node!);
  return listSpec(c, {
    desc: [c.desc, `基础租金 ${nominalRent(game.data, n.price!, 0)} 灵石`].filter(Boolean).join('\n'),
    preview: `ft_land_${n.region!}`,
  });
};

export const rentReact: Presenter<'rentReact'> = (c, { game }) =>
  listSpec(c, { desc: `${c.desc ?? ''}（可用避劫符 ${cardsHeld(game, c, 'evade')} 张）` });

export const guardReact: Presenter<'guardReact'> = (c, { game }) =>
  listSpec(c, { desc: `${c.desc ?? ''}（可用金光符 ${cardsHeld(game, c, 'goldlight')} 张）` });
