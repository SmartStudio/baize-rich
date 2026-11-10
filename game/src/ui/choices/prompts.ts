// Small prompts that stay in the list menu but add one line of context to it.
import type { ChoiceOption, PendingChoice } from '../../core/choices';
import type { Game } from '../../core/engine';
import { nominalRent, passToll } from '../../core/rules';
import type { GameState, NodeId } from '../../core/types';
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
  const id = c.ctx.node!;
  const n = game.board.node(id);
  const rent = nominalRent(game.data, n.price!, 0);
  const toll = passToll(asBought(game.state, id, c.player), game.board, game.data, id);
  return listSpec(c, {
    desc: [c.desc, `基础租金 ${rent} 灵石 · 路过交 ${toll}`].filter(Boolean).join('\n'),
    preview: `ft_land_${n.region!}`,
  });
};

/** Unowned land owes nothing. The line quotes the toll once `owner` holds it at level 0. */
function asBought(state: GameState, node: NodeId, owner: number): GameState {
  return { ...state, tiles: { ...state.tiles, [node]: { owner, level: 0 } } };
}

export const rentReact: Presenter<'rentReact'> = (c, { game }) =>
  listSpec(c, { desc: `${c.desc ?? ''}（可用避劫符 ${cardsHeld(game, c, 'evade')} 张）` });

export const guardReact: Presenter<'guardReact'> = (c, { game }) =>
  listSpec(c, { desc: `${c.desc ?? ''}（可用金光符 ${cardsHeld(game, c, 'goldlight')} 张）` });
