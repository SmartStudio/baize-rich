import { describe, expect, it } from 'vitest';
import type { ChoiceKind, PendingChoice } from '../src/core/choices';
import type { Flow, Game } from '../src/core/engine';
import { chance2d6, nominalRent, passToll } from '../src/core/rules';
import type { NodeId } from '../src/core/types';
import { breakthroughView } from '../src/ui/breakthroughView';
import { onlyAnswer, presentChoice } from '../src/ui/choices/registry';
import { optionKey, type ModalSpec } from '../src/ui/choices/spec';
import { newGame, ringGame, rngFor, script } from './helpers';

/** Runs `flow`, answering with defaults, and returns the screen built for the first `kind` ask at the moment it was asked. */
function screenFor(g: Game, flow: Flow<unknown>, kind: ChoiceKind, answers: Parameters<typeof script>[0] = {}): { spec: ModalSpec; choice: PendingChoice } {
  let found: { spec: ModalSpec; choice: PendingChoice } | null = null;
  const answer = script(answers);
  g.runFlow(flow, (c) => {
    if (c.kind === kind && !found) found = { spec: presentChoice(c, { game: g }), choice: c };
    return answer(c);
  });
  expect(found, `no ${kind} asked`).not.toBeNull();
  return found!;
}

const keys = (spec: ModalSpec) => spec.options.map((o, i) => optionKey(o, i));
const nodeOfType = (g: Game, type: string): NodeId => g.board.allNodeIds().find((id) => g.board.node(id).type === type)!;

function readyAtAltar(g: Game, seat: number, pills: number): void {
  const p = g.state.players[seat];
  p.cult = g.data.config.realms[p.realm].bar;
  p.pos = 'ALTAR';
  p.pills = pills;
}

describe('押丹 screen', () => {
  it('prices each pill count with the 2D6 odds of the engine target and fixed bonus, keyed by the count', () => {
    const g = ringGame();
    readyAtAltar(g, 0, 5);
    g.state.players[0].mind = 1;
    const { spec, choice } = screenFor(g, g.testClosure(0), 'stake');
    const { target, bonus } = choice.ctx as { target: number; bonus: number };
    const per = g.data.config.breakthrough.pillBonus;
    expect(spec.layout).toBe('tiles');
    expect(keys(spec)).toEqual(['0', '1', '2', '3']);
    expect(spec.options.map((o) => o.big)).toEqual([0, 1, 2, 3].map((k) => `${Math.round(chance2d6(target - bonus - k * per) * 100)}%`));
    expect(spec.headline).toBe(`练气 → 筑基 · 目标 ${target}`);
    expect(spec.facts).toEqual(expect.arrayContaining([
      { label: '地利', value: '+1', tone: 'good' },
      { label: '心境', value: '+1', tone: 'good' },
    ]));
    expect(spec.defaultId).toBe('s0');
  });

  it('counts a held 清心符 in every tile and lists it with the bonuses', () => {
    const screen = (hand: string[]) => {
      const g = ringGame();
      readyAtAltar(g, 0, 1);
      g.state.players[0].hand = hand;
      return screenFor(g, g.testClosure(0), 'stake', { calm: 'no' });
    };
    const { calmBonus, pillBonus } = ringGame().data.config.breakthrough;
    const { target, bonus } = screen([]).choice.ctx as { target: number; bonus: number };
    const held = screen(['calm']).spec;
    expect(held.facts!.find((f) => f.label === '清心符')?.value).toBe(`+${calmBonus}`);
    expect(held.options.map((o) => o.big)).toEqual([0, 1].map((k) => `${Math.round(chance2d6(target - bonus - calmBonus - k * pillBonus) * 100)}%`));
  });

  it('offers 返回 as its Esc and its button, outside the pill tiles', () => {
    const g = ringGame();
    readyAtAltar(g, 0, 2);
    const { spec } = screenFor(g, g.testClosure(0), 'stake', { stake: 'back' });
    expect(spec.options.map((o) => o.id)).toEqual(['s0', 's1', 's2']);
    expect(spec).toMatchObject({ cancelId: 'back', closable: true });
  });
});

describe('炼丹 screen', () => {
  it('offers 炼满 as the one-tap default, fewer on the stepper, herbs before → after; Esc brews nothing', () => {
    const g = newGame();
    const p = g.state.players[3];
    p.herbs = 9;
    const { spec } = screenFor(g, g.testSettle(3, nodeOfType(g, 'alchemy')), 'brew');
    expect(spec.layout).toBe('stepper');
    expect(spec.options.map((o) => o.label)).toEqual(['不炼', '炼 1 炉', '炼 2 炉', '炼 3 炉', '炼满 4 炉']);
    expect(spec.defaultId).toBe('b4');
    expect(keys(spec)).toEqual(['0', '1', '2', '3', '4']);
    expect(spec.options.map((o) => o.hint)).toEqual(['灵草 9 → 9', '灵草 9 → 7', '灵草 9 → 5', '灵草 9 → 3', '灵草 9 → 1']);
    expect(spec.options[4].big).toBe('+4 丹药');
    expect(spec.cancelId).toBe('b0');
  });
});

describe('坊市 screen', () => {
  it('shows every lot with its price; affordable ones say what is left, the rest are greyed out', () => {
    const g = newGame();
    const m = g.data.config.market;
    const p = g.state.players[1];
    p.stones = m.pillPrice;
    const { spec } = screenFor(g, g.testSettle(1, nodeOfType(g, 'market')), 'market');
    const pill1 = spec.options.find((o) => o.label === '丹药 ×1')!;
    const pill2 = spec.options.find((o) => o.label === '丹药 ×2')!;
    expect(pill1).toMatchObject({ big: `−${m.pillPrice}`, hint: '余 0 灵石' });
    expect(pill2).toMatchObject({ disabled: true, hint: '灵石不足' });
    expect(optionKey(pill2, spec.options.indexOf(pill2))).toBeNull();
    expect(spec.options.at(-1)).toMatchObject({ id: 'none', key: '0' });
  });
});

describe('机缘 and 白泽现世 screens', () => {
  it('lays the two 机缘 out as cards, marking bad ones', () => {
    const g = newGame();
    const { spec, choice } = screenFor(g, g.testSettle(0, nodeOfType(g, 'ruins')), 'fortunePick');
    expect(spec.layout).toBe('cards');
    expect(spec.options.map((o) => o.label)).toEqual(choice.options.map((o) => g.eventById.get(o.value as string)!.name));
    for (const o of spec.options) expect(o.tone).toBe(g.eventById.get(choice.options.find((c) => c.id === o.id)!.value as string)!.good ? 'good' : 'bad');
  });

  it('shows the gifts still left as cards', () => {
    const g = newGame();
    g.state.round = g.data.config.manifest.round;
    const { spec } = screenFor(g, g.testRoundStart(), 'manifestPick');
    expect(spec.layout).toBe('cards');
    expect(spec.options.map((o) => o.id)).toEqual(['chart', 'stones', 'pills', 'guide']);
  });

  it('answers the last 白泽 gift without a screen, and still asks while there is a pick', () => {
    const g = newGame();
    g.state.round = g.data.config.manifest.round;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testRoundStart(), script({}, seen));
    const picks = seen.filter((c) => c.kind === 'manifestPick');
    expect(picks.map((c) => onlyAnswer(c))).toEqual([null, null, null, picks[3].options[0].id]);
  });
});

describe('购买 screen', () => {
  it('puts the passing toll on the same line as the level-0 rent', () => {
    const g = newGame();
    const node = g.board.lands.find((id) => g.board.node(id).price === 110)!;
    const { spec, choice } = screenFor(g, g.testSettle(0, node), 'buy');
    const rent = nominalRent(g.data, 110, 0);
    const toll = passToll(g.state, g.board, g.data, node);
    expect(rent).toBe(11);
    expect(toll).toBe(5);
    expect(spec.desc).toBe(`${choice.desc}\n基础租金 ${rent} 灵石 · 路过交 ${toll}`);
  });
});

describe('fallback', () => {
  it('asks a kind without its own screen as a list of the engine options', () => {
    const g = ringGame();
    readyAtAltar(g, 0, 1);
    g.state.players[0].hand = ['calm'];
    const { spec, choice } = screenFor(g, g.testClosure(0), 'calm');
    expect(spec.layout).toBe('list');
    expect(spec.options.map((o) => o.id)).toEqual(choice.options.map((o) => o.id));
    expect(spec.cancelId).toBe(choice.cancelId);
  });

  it('prefixes the title with the seat name when several humans share the screen', () => {
    const g = ringGame();
    readyAtAltar(g, 0, 1);
    let title = '';
    g.runFlow(g.testClosure(0), (c) => {
      title = presentChoice(c, { game: g, who: 'P1' }).title;
      return c.defaultId ?? c.options[0].id;
    });
    expect(title.startsWith('P1 · ')).toBe(true);
  });
});

describe('breakthrough cutscene', () => {
  it('success: realm before → after, every non-zero bonus, the realm line', () => {
    const g = ringGame();
    readyAtAltar(g, 0, 4);
    g.state.players[0].mind = 1;
    g.state.rng = rngFor([2, 1]);
    g.runFlow(g.testClosure(0), script({ stake: 's2' }));
    const v = breakthroughView(g, g.log.find((e) => e.type === 'breakthrough')!);
    expect([v.from, v.to, v.success]).toEqual(['练气', '筑基', true]);
    expect(v.dice).toEqual([2, 1]);
    expect(v.bonuses).toEqual([{ label: '丹药', value: 4 }, { label: '地利', value: 1 }, { label: '心境', value: 1 }]);
    expect(v.total).toBe(3 + 4 + 1 + 1);
    expect(v.outcome).toEqual(['晋入筑基', '领悟御器', '丹药 −2']);
    expect(v.lines).toEqual(['气海成池，道基已筑。', '白泽：「不错。你比他们走得远。」']);
  });

  it('走火入魔: lists the pills, the 修为 lost and 心境 +1', () => {
    const g = ringGame();
    const p = g.state.players[3];
    g.state.tiles.R2 = { owner: 3, level: 2 };
    p.cult = g.data.config.realms[0].bar;
    p.pos = 'R2';
    p.pills = 1;
    g.state.rng = rngFor([1, 2]);
    g.runFlow(g.testClosure(3), script({ stake: 's1' }));
    const v = breakthroughView(g, g.log.find((e) => e.type === 'breakthrough')!);
    expect(v.success).toBe(false);
    expect(v.outcome).toEqual(['丹药 −1', `修为 −${g.data.config.realms[0].bar / 2}`, '心境 +1']);
    expect(v.lines).toEqual(['气血逆冲……这一次，没成。']);
  });
});
