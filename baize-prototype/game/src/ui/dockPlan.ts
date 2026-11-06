// What the action dock shows for the current human choice.
// The engine still decides which options exist. This module only names them.
import type { PendingChoice, PendingChoiceOf } from '../core/choices';
import type { Game } from '../core/engine';
import { maxLevel, nominalRent, realmName, realmOf, upgradeCost } from '../core/rules';
import type { NodeId } from '../core/types';

/** Upgrade rows kept inline. The rest stay on the board and behind B. */
const OFFER_CAP = 3;

export interface DockClick {
  id: string;
  node: NodeId;
}

export type DockOffer =
  | { t: 'upgrade'; id: string; key: string; node: NodeId; title: string; detail: string }
  | { t: 'eat'; id: 'eat'; key: string; title: string; detail: string }
  | { t: 'closure'; id: 'closure'; key: string; title: string; detail: string };

export interface DockPlan {
  hint: string;
  offers: DockOffer[];
  /** Affordable upgrades that did not fit inline. */
  more: number;
  /** Every upgrade the engine offered, including ones past the inline cap. */
  clicks: DockClick[];
  roll: boolean;
  end: boolean;
  /** Red 结束 only when the action phase has nothing else worth doing. */
  endLoud: boolean;
  cast: boolean;
  nodes: NodeId[];
}

export const IDLE_PLAN: DockPlan = {
  hint: '',
  offers: [],
  more: 0,
  clicks: [],
  roll: false,
  end: false,
  endLoud: false,
  cast: false,
  nodes: [],
};

interface LandStep {
  node: NodeId;
  land: string;
  from: string;
  to: string;
  cost: number;
  rent: number;
  next: number;
  short: number;
  affordable: boolean;
}

export function dockPlan(game: Game, choice: PendingChoice | null): DockPlan {
  if (!choice) return IDLE_PLAN;
  if (choice.kind === 'preRoll') return preRollPlan(game, choice);
  if (choice.kind === 'action') return actionPlan(game, choice);
  return IDLE_PLAN;
}

function preRollPlan(game: Game, choice: PendingChoiceOf<'preRoll'>): DockPlan {
  const offers: DockOffer[] = [];
  if (choice.options.some((o) => o.id === 'closure')) offers.push(closeOffer(game, choice.player, '1'));
  return {
    hint: preRollHint(game, choice.player, offers.length > 0),
    offers,
    more: 0,
    clicks: [],
    roll: true,
    end: false,
    endLoud: false,
    cast: choice.options.some((o) => isCastId(o.id)),
    nodes: [],
  };
}

function actionPlan(game: Game, choice: PendingChoiceOf<'action'>): DockPlan {
  const steps = landSteps(game, choice.player);
  const upgrades = choice.options.filter((o) => o.node && o.id.startsWith('upgrade:'));
  const shown = upgrades.slice(0, OFFER_CAP);
  let n = 1;
  const offers: DockOffer[] = [];
  for (const option of shown) {
    const step = steps.find((s) => s.node === option.node);
    if (!step || !option.node) continue;
    offers.push(upgradeOffer(step, String(n++)));
  }
  if (choice.options.some((o) => o.id === 'eat')) offers.push(eatOffer(game, choice.player, String(n++)));
  if (choice.options.some((o) => o.id === 'closure')) offers.push(closeOffer(game, choice.player, String(n++)));
  const clicks = upgrades.flatMap((o) => (o.node ? [{ id: o.id, node: o.node }] : []));
  const more = upgrades.length - shown.length;
  return {
    hint: actionHint(offers, more, choice.options.some((o) => isCastId(o.id))),
    offers,
    more,
    clicks,
    roll: false,
    end: true,
    endLoud: offers.length === 0 && more === 0 && !choice.options.some((o) => isCastId(o.id)),
    cast: choice.options.some((o) => isCastId(o.id)),
    nodes: clicks.map((c) => c.node),
  };
}

function actionHint(offers: DockOffer[], more: number, cast: boolean): string {
  const upgrade = offers.some((o) => o.t === 'upgrade') || more > 0;
  if (upgrade) return '点一行或按数字升级。亮着的灵田也能点。';
  const eat = offers.some((o) => o.t === 'eat');
  const close = offers.some((o) => o.t === 'closure');
  if (eat && close) return '可以服丹或闭关。做完再结束。';
  if (close) return '可以闭关。做完再结束。';
  if (eat) return '可以服丹。做完再结束。';
  if (cast) return '可以出符或炼丹。做完再结束。';
  return '这一回合没有能升级的灵田。';
}

function preRollHint(game: Game, seat: number, canClose: boolean): string {
  const steps = landSteps(game, seat);
  const ready = steps.filter((s) => s.affordable);
  const line = ready.length === 1
    ? oneUpgrade(ready[0])
    : ready.length > 1
      ? `掷出后可升级 ${ready.length} 块，例如${ready.slice(0, 2).map((s) => s.land).join('、')}`
      : steps.length > 0
        ? shortOf(steps)
        : '掷出停下后，可以买无主灵田';
  const pill = game.state.players[seat].pills > 0 ? `。服丹 +${game.data.config.cultivation.pill} 修为` : '';
  const close = canClose ? '现在可以闭关。' : '';
  return `${close}${line}${pill}`;
}

function oneUpgrade(step: LandStep): string {
  return `掷出后可升级${step.land}（${step.from}→${step.to}，${step.cost} 灵石，租 ${step.rent}→${step.next}）`;
}

function shortOf(steps: LandStep[]): string {
  const nearest = [...steps].sort((a, b) => a.short - b.short)[0];
  return `掷出后才能升级。${nearest.land}还差 ${nearest.short} 灵石`;
}

function landSteps(game: Game, seat: number): LandStep[] {
  const stones = game.state.players[seat].stones;
  const buildings = game.data.board.buildings;
  const out: LandStep[] = [];
  for (const id of game.board.lands) {
    const tile = game.state.tiles[id];
    if (tile.owner !== seat || tile.level >= maxLevel(game.data)) continue;
    const node = game.board.node(id);
    if (node.price === undefined) continue;
    const price = node.price;
    const to = tile.level + 1;
    const cost = upgradeCost(game.data, price, to);
    out.push({
      node: id,
      land: node.name,
      from: buildings[tile.level].name,
      to: buildings[to].name,
      cost,
      rent: nominalRent(game.data, price, tile.level),
      next: nominalRent(game.data, price, to),
      short: Math.max(0, cost - stones),
      affordable: stones >= cost,
    });
  }
  return out;
}

function upgradeOffer(step: LandStep, key: string): DockOffer {
  return {
    t: 'upgrade',
    id: `upgrade:${step.node}`,
    key,
    node: step.node,
    title: `${key}  ${step.land}  ${step.from}→${step.to}`,
    detail: `${step.cost} 灵石 · 租 ${step.rent}→${step.next}`,
  };
}

function eatOffer(game: Game, seat: number, key: string): DockOffer {
  const gain = game.data.config.cultivation.pill;
  const have = game.state.players[seat].pills;
  return { t: 'eat', id: 'eat', key, title: `${key}  服丹`, detail: `+${gain} 修为 · 丹药 ${have}→${have - 1}` };
}

function closeOffer(game: Game, seat: number, key: string): DockOffer {
  const player = game.state.players[seat];
  const from = realmName(game.data, player.realm);
  const to = realmName(game.data, player.realm + 1);
  const target = realmOf(game.data, player.realm).target;
  return { t: 'closure', id: 'closure', key, title: `${key}  闭关  ${from}→${to}`, detail: `目标 ${target}，可押丹` };
}

function isCastId(id: string): boolean {
  return id.startsWith('cast:') || id === 'skill' || id === 'brew';
}
