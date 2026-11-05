// §18 经典玩法：地段连锁、附身灵体、百宝阁与道具、功能建筑、小游戏格。
// These run on the shipped board (data/board.json): streets, spawns and the new tile types only exist there.
import { describe, expect, it } from 'vitest';
import { AIController } from '../src/ai/ai';
import type { PendingChoice } from '../src/core/choices';
import { Game } from '../src/core/engine';
import { nextFloat } from '../src/core/rng';
import { buyPrice, nominalRent, rentFor } from '../src/core/rules';
import type { SpiritState } from '../src/core/types';
import { newGame, script } from './helpers';

// Seats in newGame: 0 A 体修(body), 1 B 法修(magic), 2 C 剑修(sword), 3 D 丹师(alch).

/** An rng state whose next d6 rolls are exactly `rolls`. */
function rngFor(rolls: number[]): number {
  for (let s = 1; ; s++) {
    const h = { rng: s };
    if (rolls.every((r) => 1 + Math.floor(nextFloat(h) * 6) === r)) return s;
  }
}

/** Round 1, players parked on quiet cells, plenty of stones, no pills, no spirits on the board. */
function quiet(g: Game): void {
  const st = g.state;
  st.round = 1;
  ['S3', 'S8', 'E3', 'E8'].forEach((n, i) => {
    const p = st.players[i];
    p.pos = n;
    p.cameFrom = null;
    p.stones = 2000;
    p.pills = 0;
    p.hand = [];
  });
  for (const sp of st.spirits) { sp.node = null; sp.holder = null; }
}

function spirit(g: Game, kind: SpiritState['kind']): SpiritState {
  return g.state.spirits.find((s) => s.kind === kind)!;
}

const rules = newGame().data.config.rules;

describe('§18.1 地段连锁', () => {
  it('owning a whole street doubles its rent, and buying the last land emits street', () => {
    const g = newGame();
    quiet(g);
    g.state.tiles.W3.owner = 0;
    g.state.tiles.W4.owner = 0;
    const before = rentFor(g.state, g.board, g.data, 'W3', 1).amount;
    g.state.players[0].pos = 'W5';
    g.runFlow(g.testSettle(0, 'W5'), script({ buy: 'yes' }));
    expect(g.state.tiles.W5.owner).toBe(0);
    const e = g.log.find((x) => x.type === 'street')!;
    expect(e.street).toBe('qingzhu');
    expect(g.state.players[0].stats.streets).toBe(1);
    const r = rentFor(g.state, g.board, g.data, 'W3', 1);
    expect(r.amount).toBe(before * rules.streetRentMult);
    expect(r.mults.some((m) => m.label.startsWith('整街'))).toBe(true);
  });

  it('a street with one rival land gives no bonus', () => {
    const g = newGame();
    quiet(g);
    g.state.tiles.W3.owner = 0;
    g.state.tiles.W4.owner = 0;
    g.state.tiles.W5.owner = 2;
    expect(rentFor(g.state, g.board, g.data, 'W3', 1).amount).toBe(nominalRent(g.data, 100, 0));
  });
});

describe('§18.2 附身灵体', () => {
  it('spawns the fox and the heart on two distinct spawn cells at the start', () => {
    const g = newGame(5);
    const spawns = g.data.board.spiritSpawns!;
    const nodes = g.state.spirits.map((s) => s.node);
    expect(g.state.spirits.map((s) => s.kind).sort()).toEqual(['fox', 'heart']);
    expect(nodes.every((n) => n !== null && spawns.includes(n))).toBe(true);
    expect(nodes[0]).not.toBe(nodes[1]);
  });

  it('passing the fox possesses: rent ×foxRentMult as owner, land at foxLandDiscount', () => {
    const g = newGame();
    quiet(g);
    const fox = spirit(g, 'fox');
    fox.node = 'S5';
    g.runFlow(g.testMove(0, 3), script({ buy: 'no', duel: 'none' })); // S3 → S4 → S5 → S6
    expect(fox.holder).toBe(0);
    expect(fox.node).toBeNull();
    expect(fox.turnsLeft).toBe(rules.spiritTurns);
    expect(g.state.players[0].stats.possessions).toBe(1);
    g.state.tiles.S3.owner = 0;
    expect(rentFor(g.state, g.board, g.data, 'S3', 1).amount).toBe(Math.floor(nominalRent(g.data, 190, 0) * rules.foxRentMult));
    expect(buyPrice(g.state, g.data, g.state.players[0], 200, false)).toBe(200 * rules.foxLandDiscount);
    // 丹师 keeps the lower of the two discounts instead of multiplying them
    fox.holder = 3;
    expect(buyPrice(g.state, g.data, g.state.players[3], 200, false)).toBe(Math.floor(200 * Math.min(rules.alchBuyDiscount, rules.foxLandDiscount)));
  });

  it('the heart holder hands it to the first player walked into, keeping the turns left', () => {
    const g = newGame();
    quiet(g);
    const heart = spirit(g, 'heart');
    Object.assign(heart, { node: null, holder: 0, turnsLeft: 2 });
    g.state.players[1].pos = 'S4';
    g.runFlow(g.testMove(0, 3), script({ buy: 'no', duel: 'none' }));
    expect(heart.holder).toBe(1);
    expect(heart.turnsLeft).toBe(2);
    expect(g.state.players[0].stats.heartPasses).toBe(1);
    const e = g.log.find((x) => x.type === 'spirit' && x.spirit?.action === 'transfer')!;
    expect(e.spirit).toMatchObject({ kind: 'heart', seat: 1, giver: 0 });
    // the payer's rent goes up while holding it
    g.state.tiles.S3.owner = 2;
    expect(rentFor(g.state, g.board, g.data, 'S3', 1).amount).toBe(Math.floor(nominalRent(g.data, 190, 0) * rules.heartRentMult));
  });

  it('the heart costs heartPills each own turn and leaves after its last turn, respawning on a free spawn', () => {
    const g = newGame();
    quiet(g);
    const heart = spirit(g, 'heart');
    Object.assign(heart, { node: null, holder: 0, turnsLeft: 1 });
    g.state.players[0].pills = 2;
    g.state.rng = rngFor([1, 2]); // S3 → S6, nobody on the way
    g.runFlow(g.testPlayTurn(0), script({ buy: 'no', duel: 'none', preRoll: 'roll', action: 'end' }));
    expect(g.state.players[0].pills).toBe(2 - rules.heartPills);
    expect(heart.holder).toBeNull();
    expect(g.data.board.spiritSpawns).toContain(heart.node);
    expect(g.log.some((x) => x.type === 'spirit' && x.spirit?.action === 'expire')).toBe(true);
  });

  it('a new spirit displaces the one already held', () => {
    const g = newGame();
    quiet(g);
    const fox = spirit(g, 'fox');
    const heart = spirit(g, 'heart');
    Object.assign(fox, { node: null, holder: 0, turnsLeft: 3 });
    heart.node = 'S5';
    g.runFlow(g.testMove(0, 3), script({ buy: 'no', duel: 'none' }));
    expect(heart.holder).toBe(0);
    expect(fox.holder).toBeNull();
    expect(fox.node).not.toBeNull();
  });

  it('wandering moves each spirit 1..spiritMoveMax steps and never possesses', () => {
    const g = newGame();
    quiet(g);
    const fox = spirit(g, 'fox');
    fox.node = 'S2';
    g.state.players[0].pos = 'S3';
    g.state.players[1].pos = 'S4';
    g.state.players[2].pos = 'S5';
    g.testSpiritsWander();
    expect(['S3', 'S4', 'S5', 'S10', 'S11', 'S12']).toContain(fox.node);
    expect(fox.holder).toBeNull();
  });
});

describe('§18.3 百宝阁与道具', () => {
  it('道具 never enter the deck', () => {
    const g = newGame();
    const items = g.data.spells.cards.filter((c) => c.shopOnly).map((c) => c.id);
    expect(items.sort()).toEqual(['barrier', 'blast', 'dice', 'turnback']);
    expect(g.state.spellDeck.some((c) => items.includes(c))).toBe(false);
  });

  it('stopping at the shop sells one priced card', () => {
    const g = newGame();
    quiet(g);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'F6'), script({ shop: 'dice' }, seen));
    const ask = seen.find((c) => c.kind === 'shop')!;
    expect(ask.options.map((o) => o.id)).toContain('leave');
    expect(ask.options.every((o) => o.id === 'leave' || g.data.spells.cards.find((c) => c.id === o.id)?.price !== undefined)).toBe(true);
    expect(g.state.players[0].hand).toEqual(['dice']);
    expect(g.state.players[0].stones).toBe(2000 - 150);
    expect(g.state.players[0].stats.shopBuys).toBe(1);
  });

  it('a full hand only browses', () => {
    const g = newGame();
    quiet(g);
    g.state.players[0].hand = ['thunder', 'thunder', 'drain', 'drain', 'bind'];
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'F6'), script({}, seen));
    expect(seen.some((c) => c.kind === 'shop')).toBe(false);
  });

  it('御骰符 replaces the roll with a chosen 2–12 total and costs no pills', () => {
    const g = newGame();
    quiet(g);
    g.state.players[0].hand = ['dice'];
    const seen: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(0), script({ preRoll: ['cast:dice', 'roll'], rollValue: 'v12', buy: 'no', duel: 'none', action: 'end' }, seen));
    const ask = seen.find((c) => c.kind === 'rollValue')!;
    expect(ask.options.map((o) => o.value)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(g.state.players[0].hand).toEqual([]);
    expect(g.state.spellDiscard).not.toContain('dice');
    expect(g.log.find((x) => x.type === 'roll' && x.player === 0)!.amount).toBe(12);
  });

  it('倒行符 walks backwards for free', () => {
    const g = newGame();
    quiet(g);
    g.state.players[0].hand = ['turnback'];
    g.state.players[0].pos = 'S5';
    g.state.rng = rngFor([1, 2]);
    g.runFlow(g.testPlayTurn(0), script({ preRoll: ['cast:turnback', 'roll'], buy: 'no', duel: 'none', action: 'end' }));
    expect(g.state.players[0].pos).toBe('S2');
    expect(g.state.players[0].pills).toBe(0);
  });

  it('路障符 stops the next other walker on that cell', () => {
    const g = newGame();
    quiet(g);
    g.state.players[0].hand = ['barrier'];
    g.state.players[0].pos = 'S3';
    g.runFlow(g.testActionPhase(0), script({ action: ['cast:barrier', 'end'], target: 'node:S6' }));
    expect(g.state.barriers).toEqual([{ node: 'S6', seat: 0 }]);
    g.state.players[1].pos = 'S4';
    g.runFlow(g.testMove(1, 6), script({ buy: 'no', duel: 'none', shop: 'leave' }));
    expect(g.state.players[1].pos).toBe('S6');
    expect(g.state.barriers).toEqual([]);
    expect(g.log.some((x) => x.type === 'barrierHit')).toBe(true);
  });

  it('爆炎阵 sends the next other player to stop there to the 医馆 for hospitalTurns turns', () => {
    const g = newGame();
    quiet(g);
    g.state.players[0].hand = ['blast'];
    g.runFlow(g.testActionPhase(0), script({ action: ['cast:blast', 'end'], target: 'node:W4' }));
    expect(g.state.blasts).toEqual([{ node: 'W4', seat: 0 }]);
    g.state.players[1].pos = 'W3'; // the 水 side would slide on ice, so use 木
    g.runFlow(g.testMove(1, 1), script({ buy: 'no', duel: 'none' }));
    const hosp = g.board.allNodeIds().find((id) => g.board.node(id).type === 'hospital')!;
    expect(g.state.players[1].pos).toBe(hosp);
    expect(g.state.players[1].hospitalTurns).toBe(rules.hospitalTurns);
    expect(g.state.blasts).toEqual([]);
    // the next turn is spent resting
    const pos = g.state.players[1].pos;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(1), script({}, seen));
    expect(seen.some((c) => c.player === 1 && c.kind === 'preRoll')).toBe(false);
    expect(g.state.players[1].pos).toBe(pos);
    expect(g.state.players[1].hospitalTurns).toBe(0);
  });
});

describe('§18.4 功能建筑', () => {
  it('own Lv0 land underfoot offers the three specials in the upgrade slot; a special cannot be upgraded', () => {
    const g = newGame();
    quiet(g);
    g.state.tiles.S3.owner = 0;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: ['upgrade:S3:garden', 'end'] }, seen));
    const ids = seen[0].options.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(['upgrade:S3', 'upgrade:S3:garden', 'upgrade:S3:bazaar', 'upgrade:S3:portal']));
    expect(g.state.tiles.S3.special).toBe('garden');
    expect(g.state.tiles.S3.level).toBe(0);
    expect(g.state.players[0].stones).toBe(2000 - 190 * g.data.config.levelUpgradeCostP[1]);
    expect(g.cult(0)).toBe(rules.specialCultivation);
    g.state.turn.upgraded = false;
    const later: PendingChoice[] = [];
    g.runFlow(g.testActionPhase(0), script({ action: 'end' }, later));
    expect(later[0].options.some((o) => o.id.startsWith('upgrade:S3'))).toBe(false);
    expect(g.buyoutTargets(3)).not.toContain('S3');
  });

  it('药园 pays its owner gardenPills at round start', () => {
    const g = newGame();
    quiet(g);
    g.state.tiles.S3.owner = 0;
    g.state.tiles.S3.special = 'garden';
    g.runFlow(g.testRoundStart(), script({}));
    expect(g.state.players[0].pills).toBe(rules.gardenPills);
  });

  it('集市 charges a flat bazaarFee and sells the owner\'s oldest card to the visitor', () => {
    const g = newGame();
    quiet(g);
    g.state.tiles.S3.owner = 0;
    g.state.tiles.S3.special = 'bazaar';
    g.state.players[0].hand = ['goldlight', 'thunder'];
    g.runFlow(g.testSettle(1, 'S3'), script({}));
    const price = g.data.spells.cards.find((c) => c.id === 'goldlight')!.price!;
    expect(g.state.players[1].hand).toEqual(['goldlight']);
    expect(g.state.players[0].hand).toEqual(['thunder']);
    expect(g.state.players[1].stones).toBe(2000 - rules.bazaarFee - price);
    expect(g.state.players[0].stones).toBe(2000 + rules.bazaarFee + price);
  });

  it('挪移阵 lets its owner jump to another own 挪移阵', () => {
    const g = newGame();
    quiet(g);
    for (const id of ['S3', 'E9']) {
      g.state.tiles[id].owner = 0;
      g.state.tiles[id].special = 'portal';
    }
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'S3'), script({ portal: 'E9' }, seen));
    expect(seen.find((c) => c.kind === 'portal')!.options.map((o) => o.id)).toEqual(['E9', 'stay']);
    expect(g.state.players[0].pos).toBe('E9');
  });
});

describe('§18.5 小游戏格', () => {
  it('炼丹房 pays the reward of the answered tier', () => {
    const g = newGame();
    quiet(g);
    g.runFlow(g.testSettle(0, 'W17'), script({ miniGame: 'perfect' }));
    expect(g.state.players[0].pills).toBe(rules.miniGameRewards.alchemy.perfect);
    expect(g.log.find((x) => x.type === 'miniGame')!.miniGame).toMatchObject({ game: 'alchemy', tier: 'perfect' });
  });

  it('灵骰台: the engine rolls after the bet; a right guess pays stake ×diceWinMult and the event carries roll / side / stake', () => {
    const g = newGame();
    quiet(g);
    g.state.rng = rngFor([5, 6]);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testSettle(0, 'F17'), script({ diceBet: 'big100' }, seen));
    const verdict = seen.find((c) => c.kind === 'miniGame')!;
    expect(verdict.options.map((o) => o.id)).toEqual(['perfect']);
    expect(verdict.ctx.dice).toEqual([5, 6]);
    expect(g.state.players[0].stones).toBe(2000 - 100 + 100 * rules.diceWinMult);
    expect(g.state.players[0].pills).toBe(rules.miniGameRewards.dice.perfect);
    expect(g.log.find((x) => x.type === 'miniGame')!.miniGame).toMatchObject({
      game: 'dice', tier: 'perfect', roll: [5, 6], side: 'big', stake: 100, reward: { stones: 100 },
    });
  });

  it('灵骰台: 7 loses for both sides', () => {
    for (const side of ['big', 'small']) {
      const g = newGame();
      quiet(g);
      g.state.rng = rngFor([3, 4]);
      g.runFlow(g.testSettle(0, 'F17'), script({ diceBet: `${side}200` }));
      expect(g.state.players[0].stones).toBe(1800);
      expect(g.log.find((x) => x.type === 'miniGame')!.miniGame!.tier).toBe('fail');
    }
  });
});

describe('§18 AI 与重放', () => {
  it('AIs answer every new kind, and the game replays to the same state', () => {
    const kinds = new Set<string>();
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const g = newGame(seed);
      const ais = [0, 1, 2, 3].map((i) => new AIController(g, i, { seed, difficulty: i === 3 ? 'hard' : 'normal' }));
      g.start();
      while (!g.over) {
        kinds.add(g.pending!.kind);
        g.answer(ais[g.pending!.player].decide(g.pending!));
      }
      const r = Game.replay(g.setup, g.history);
      expect(r.state).toEqual(g.state);
    }
    for (const k of ['shop', 'miniGame', 'diceBet']) expect(kinds).toContain(k);
  });
});
