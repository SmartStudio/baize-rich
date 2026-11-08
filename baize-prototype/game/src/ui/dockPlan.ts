// What the action dock shows for the current human choice.
// The engine still decides which options exist. This module only names them.
import type { PendingChoice, PendingChoiceOf } from '../core/choices';
import { closureOdds, percent } from '../core/closureOdds';
import type { Game } from '../core/engine';
import type { GameEvent } from '../core/events';
import { barFull, closureSite, maxLevel, nominalRent, realmName, upgradeCost } from '../core/rules';
import type { GameState, NodeId } from '../core/types';
import { closeDetail } from './hudReadout';

/** Upgrade rows kept inline. The rest stay on the board and behind B. */
const OFFER_CAP = 3;

export interface DockClick {
  id: string;
  node: NodeId;
}

export type DockOffer =
  | { t: 'upgrade'; id: string; key: string; node: NodeId; title: string; detail: string; enabled?: true }
  | { t: 'eat'; id: 'eat'; key: string; title: string; detail: string; enabled?: true }
  | { t: 'closure'; id: 'closure'; key: string; title: string; detail: string; enabled?: true }
  | { t: 'notice'; id: string; key: ''; title: string; detail: string; enabled: false };

export interface TurnReadout {
  title: string;
  hint: string;
  urgent: boolean;
}

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

export function turnReadout(
  state: GameState,
  pending: PendingChoice | null,
  events: readonly GameEvent[],
  currentHuman: boolean,
  pendingHuman: boolean,
): TurnReadout {
  if (state.over) return { title: '对局结束', hint: '', urgent: false };
  if (pendingHuman && pending && pending.player !== state.current) {
    return { title: '等你回应', hint: pending.desc ?? pending.title, urgent: true };
  }
  const player = state.players[state.current];
  if (currentHuman) return { title: `${player.name} 的回合`, hint: '', urgent: false };
  const total = Math.max(1, state.players.length - 1);
  const order = Math.min(total, Math.max(1, player.seat));
  const action = latestTurnAction(events, state.current, player.name);
  return {
    title: `${player.name} 的回合`,
    hint: `对手 ${order}/${total} 行动中 · ${action ?? '正在思考…'}`,
    urgent: false,
  };
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
  const offers = actionOffers(game, choice, steps, shown);
  const clicks = upgrades.flatMap((o) => (o.node ? [{ id: o.id, node: o.node }] : []));
  const more = upgrades.length - shown.length;
  const actionable = offers.some((offer) => offer.enabled !== false);
  return {
    hint: actionHint(offers, more, choice.options.some((o) => isCastId(o.id))),
    offers,
    more,
    clicks,
    roll: false,
    end: true,
    endLoud: !actionable && more === 0 && !choice.options.some((o) => isCastId(o.id)),
    cast: choice.options.some((o) => isCastId(o.id)),
    nodes: clicks.map((c) => c.node),
  };
}

function actionOffers(
  game: Game,
  choice: PendingChoiceOf<'action'>,
  steps: LandStep[],
  shown: PendingChoiceOf<'action'>['options'],
): DockOffer[] {
  let n = 1;
  const offers: DockOffer[] = [];
  for (const option of shown) {
    const step = steps.find((item) => item.node === option.node);
    if (step) offers.push(upgradeOffer(step, String(n++)));
  }
  if (choice.options.some((option) => option.id === 'eat')) offers.push(eatOffer(game, choice.player, String(n++)));
  if (choice.options.some((option) => option.id === 'closure')) offers.push(closeOffer(game, choice.player, String(n++)));
  else if (closureUnavailable(game, choice.player)) offers.push(closureNotice(game, choice.player));
  if (game.state.turn.upgraded) offers.unshift(upgradeNotice());
  return offers;
}

function closureUnavailable(game: Game, seat: number): boolean {
  const player = game.state.players[seat];
  return barFull(game.data, player) && closureSite(game.state, game.data, seat, player.pos) === null;
}

function closureNotice(game: Game, seat: number): DockOffer {
  return {
    t: 'notice', id: 'closure-unavailable', key: '', title: '闭关 · 暂不可用',
    detail: closeDetail(game.state, game.data, seat), enabled: false,
  };
}

function upgradeNotice(): DockOffer {
  return {
    t: 'notice', id: 'upgrade-used', key: '', title: '本回合已升级',
    detail: '每回合限 1 块', enabled: false,
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

/** 「成功 28%，押 3 颗 97%」: the unstaked chance, then the most the pills on hand can buy. */
function closeOffer(game: Game, seat: number, key: string): DockOffer {
  const { state, data } = game;
  const player = state.players[seat];
  const from = realmName(data, player.realm);
  const to = realmName(data, player.realm + 1);
  const [bare, ...staked] = closureOdds(state, data, seat, closureSite(state, data, seat, player.pos)!).stakes;
  const most = staked.at(-1);
  const detail = most && most.chance > bare.chance
    ? `成功 ${percent(bare.chance)}，押 ${most.pills} 颗 ${percent(most.chance)}`
    : `成功 ${percent(bare.chance)}`;
  return { t: 'closure', id: 'closure', key, title: `${key}  闭关  ${from}→${to}`, detail };
}

function isCastId(id: string): boolean {
  return id.startsWith('cast:') || id === 'skill' || id === 'brew';
}

function latestTurnAction(events: readonly GameEvent[], seat: number, name: string): string | null {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== 'turnStart' || events[i].player !== seat) continue;
    start = i;
    break;
  }
  if (start < 0) return null;
  let event: GameEvent | undefined;
  for (let i = events.length - 1; i > start; i--) {
    if (events[i].text === '' || events[i].type === 'turnEnd') continue;
    event = events[i];
    break;
  }
  if (!event) return null;
  const own = event.text.startsWith(name) ? event.text.slice(name.length).trimStart() : event.text;
  const text = own.replace(/[。！]$/, '');
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}
