import { describe, expect, it } from 'vitest';
import type { ChoiceKind, PendingChoice } from '../src/core/choices';
import type { Flow, Game } from '../src/core/engine';
import { chance2d6 } from '../src/core/rules';
import type { NodeId } from '../src/core/types';
import { breakthroughView } from '../src/ui/breakthroughView';
import { presentChoice } from '../src/ui/choices/registry';
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
  it('lists brew counts ascending, keyed by the count, with herbs before → after; Esc brews nothing', () => {
    const g = newGame();
    const p = g.state.players[3];
    p.herbs = 5;
    const { spec } = screenFor(g, g.testSettle(3, nodeOfType(g, 'alchemy')), 'brew');
    expect(keys(spec)).toEqual(['0', '1', '2']);
    expect(spec.options.map((o) => o.hint)).toEqual(['灵草 5 → 5', '灵草 5 → 3', '灵草 5 → 1']);
    expect(spec.options[2].big).toBe('+2 丹药');
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

describe('御骰符 screen', () => {
  it('keys every value by its own digit, 10 by 0, and leaves 11 and 12 to the arrow keys', () => {
    const g = ringGame();
    const options = Array.from({ length: 11 }, (_, i) => ({ id: `v${i + 2}`, label: `${i + 2} 点`, value: i + 2 }));
    const choice = { player: 0, kind: 'rollValue', title: '御骰符', options } as unknown as PendingChoice;
    const spec = presentChoice(choice, { game: g });
    expect(spec.layout).toBe('tiles');
    expect(keys(spec)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '0', null, null]);
  });
});
