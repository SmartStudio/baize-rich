import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { nextFloat } from '../src/core/rng';
import { ringGame, script } from './helpers';

// Seats in newGame: 0 A 体修(body), 1 B 法修(magic), 2 C 剑修(sword), 3 D 丹师(alch).

/** An rng state whose next d6 rolls are exactly `rolls`. */
function rngFor(rolls: number[]): number {
  for (let s = 1; ; s++) {
    const h = { rng: s };
    if (rolls.every((r) => 1 + Math.floor(nextFloat(h) * 6) === r)) return s;
  }
}

/** Round 1, everyone far apart on the ring, plenty of stones, no pills. */
function spread(g: Game): void {
  g.state.round = 1;
  ['R20', 'R24', 'R28', 'R16'].forEach((n, i) => {
    const p = g.state.players[i];
    p.pos = n;
    p.stones = 1000;
    p.pills = 0;
  });
}

const rules = ringGame().data.config.rules;

describe('§17 斗法', () => {
  it('higher total wins and takes duelStealPct of the loser stones; bets are spent either way', () => {
    const g = ringGame();
    spread(g);
    const [a, b] = [g.state.players[3], g.state.players[1]]; // 丹师 attacks 法修: no hero bonus
    a.pills = 2;
    b.pills = 1;
    g.state.rng = rngFor([2, 5]);
    // attacker 2 + 2 pills = 4, defender 5 + 1 pill = 6
    g.runFlow(g.testDuel(3, 1), script({ duelBet: (c) => (c.player === 3 ? 'b2' : 'b1') }));
    const e = g.log.find((x) => x.type === 'duel')!;
    expect(e.duel).toMatchObject({ rolls: [2, 5], bets: [2, 1], totals: [4, 6], winner: 1, loser: 3, amount: 200 });
    expect(a.stones).toBe(800);
    expect(b.stones).toBe(1200);
    expect(a.pills).toBe(0);
    expect(b.pills).toBe(0);
  });

  it('a tie goes to the defender', () => {
    const g = ringGame();
    spread(g);
    g.state.rng = rngFor([4, 4]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(g.log.find((x) => x.type === 'duel')!.duel!.winner).toBe(1);
  });

  it('剑修 attacks with +1 and 体修 defends with +1', () => {
    const g = ringGame();
    spread(g);
    g.state.rng = rngFor([3, 3]);
    g.runFlow(g.testDuel(2, 0), script({}));
    const d = g.log.find((x) => x.type === 'duel')!.duel!;
    expect(d.bonus).toEqual([rules.swordDuelAttack, rules.bodyDuelDefense]);
    expect(d.winner).toBe(0); // 4 vs 4, tie to the defender
  });

  it('the stake is capped at duelStealMax', () => {
    const g = ringGame();
    spread(g);
    g.state.players[1].stones = 5000;
    g.state.rng = rngFor([6, 1]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(g.log.find((x) => x.type === 'duel')!.amount).toBe(rules.duelStealMax);
    expect(g.state.players[3].stones).toBe(1000 + rules.duelStealMax);
  });

  it('after a walk, offers a duel to players passed on the way or on the landing tile, at most once per turn', () => {
    const g = ringGame();
    spread(g);
    g.state.players[3].pos = 'R1';
    g.state.players[1].pos = 'R3'; // passed
    g.state.players[2].pos = 'R5'; // landing tile (land, price 130)
    const seen: PendingChoice[] = [];
    g.state.rng = rngFor([1, 6]);
    g.runFlow(g.testMove(3, 4), script({ duel: 'p2', buy: 'no' }, seen));
    const offer = seen.find((c) => c.kind === 'duel')!;
    expect(offer.options.map((o) => o.id)).toEqual(['p1', 'p2', 'none']);
    expect(g.log.filter((x) => x.type === 'duel')).toHaveLength(1);
    expect(g.state.turn.duelDone).toBe(true);
    // the defender is shielded for the rest of the round
    expect(g.duelEligible(2)).toBe(false);
  });

  it('players in 面壁 cannot be challenged', () => {
    const g = ringGame();
    spread(g);
    g.state.players[3].pos = 'R1';
    g.state.players[1].pos = 'R3';
    g.state.players[1].jailed = true;
    const seen: PendingChoice[] = [];
    g.runFlow(g.testMove(3, 4), script({ buy: 'no' }, seen));
    expect(seen.some((c) => c.kind === 'duel')).toBe(false);
  });
});

describe('§17 悬赏令', () => {
  it('goes to the unique 修为 leader at or above bountyMinCult, and is withdrawn on a tie', () => {
    const g = ringGame();
    g.state.players[1].cultBase = rules.bountyMinCult - 1;
    g.testUpdateBounty();
    expect(g.state.bountySeat).toBeNull();
    g.state.players[1].cultBase = rules.bountyMinCult;
    g.testUpdateBounty();
    expect(g.state.bountySeat).toBe(1);
    g.state.players[2].cultBase = rules.bountyMinCult;
    g.testUpdateBounty();
    expect(g.state.bountySeat).toBeNull();
    expect(g.log.filter((e) => e.type === 'bounty')).toHaveLength(2);
  });

  it('beating the holder in a duel pays bountyDuelCultivation 修为 and clears the bounty', () => {
    const g = ringGame();
    spread(g);
    g.state.players[1].cultBase = 3;
    g.testUpdateBounty();
    g.state.rng = rngFor([6, 1]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(g.state.players[3].cultBase).toBe(rules.bountyDuelCultivation);
    expect(g.state.players[3].stats.bountyClaims).toBe(1);
    expect(g.state.bountySeat).toBeNull();
    expect(g.log.find((e) => e.type === 'duel')!.duel!.bounty).toBe(true);
  });

  it('the holder winning keeps the bounty', () => {
    const g = ringGame();
    spread(g);
    g.state.players[1].cultBase = 3;
    g.testUpdateBounty();
    g.state.rng = rngFor([1, 6]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(g.state.bountySeat).toBe(1);
    expect(g.state.players[3].cultBase).toBe(0);
  });
});

describe('§17 禁制', () => {
  function ownR5(g: Game): void {
    g.state.tiles.R5.owner = 0;
    g.state.tiles.R5.level = 1;
  }

  it('is placed from the action phase for trapPillCost 灵丹, at most trapMaxPerPlayer at a time', () => {
    const g = ringGame();
    spread(g);
    for (const n of ['R1', 'R2', 'R3']) g.state.tiles[n].owner = 0;
    g.state.players[0].pills = 5;
    expect(g.trapSpots(0)).toEqual(['R1', 'R2', 'R3']);
    g.state.tiles.R1.trap = true;
    g.state.tiles.R2.trap = true;
    expect(g.trapSpots(0)).toEqual([]);
  });

  it('an opponent stopping there pays rent, then trapStones, is bound next turn, and the trap is used up', () => {
    const g = ringGame();
    spread(g);
    ownR5(g);
    g.state.tiles.R5.trap = true;
    const v = g.state.players[3];
    v.pos = 'R1';
    g.runFlow(g.testMove(3, 4), script({}));
    expect(v.pos).toBe('R5');
    const rent = v.stats.rentPaid;
    expect(rent).toBeGreaterThan(0);
    expect(v.stones).toBe(1000 - rent - rules.trapStones);
    expect(v.bound).toBe(true);
    expect(g.state.tiles.R5.trap).toBe(false);
    expect(g.state.players[0].stats.trapTriggers).toBe(1);
  });

  it('does not fire on the owner or on the bound stay-settle', () => {
    const g = ringGame();
    spread(g);
    ownR5(g);
    g.state.tiles.R5.trap = true;
    g.state.players[0].pos = 'R1';
    g.runFlow(g.testMove(0, 4), script({}));
    expect(g.state.tiles.R5.trap).toBe(true);
    // a bound opponent standing on it settles in place without triggering it
    const v = g.state.players[3];
    v.pos = 'R5';
    v.bound = true;
    g.runFlow(g.testPlayTurn(3), script({}));
    expect(g.state.tiles.R5.trap).toBe(true);
  });

  it('is cleared when the land changes hands', () => {
    const g = ringGame();
    spread(g);
    ownR5(g);
    g.state.tiles.R5.trap = true;
    g.state.players[0].stones = 10;
    g.state.tiles.R9 = { owner: 1, level: 1, trap: false };
    g.runFlow(g.testPayRent(0, 'R9'), script({})); // 破产重整: lands go back to the bank
    expect(g.state.tiles.R5).toEqual({ owner: null, level: 0, trap: false });
  });
});

describe('§12 主动技能', () => {
  it('剑遁 teleports onto the target, duels at once, settles the tile and replaces the roll', () => {
    const g = ringGame();
    spread(g);
    const c = g.state.players[2];
    g.state.players[1].pos = 'R5';
    g.state.rng = rngFor([6, 1]);
    let r: string | undefined;
    const flow = g.testUseSkill(2);
    const seen: PendingChoice[] = [];
    g.runFlow((function* () { r = yield* flow; })(), script({ target: 'p1', buy: 'no' }, seen));
    expect(r).toBe('moved');
    expect(c.pos).toBe('R5');
    expect(g.log.find((e) => e.type === 'duel')!.duel).toMatchObject({ attacker: 2, defender: 1, winner: 2 });
    expect(seen.map((x) => x.kind)).toEqual(['target', 'buy']); // settles the unowned land it landed on
  });

  it('乾坤挪移 swaps with a nearby ring player without settling', () => {
    const g = ringGame();
    spread(g);
    const b = g.state.players[1];
    const d = g.state.players[3];
    b.pos = 'R5';
    d.pos = 'R8'; // 3 steps away
    g.state.players[0].pos = 'R20'; // far: not offered
    expect(g.skillTargets(1)).toEqual([3]);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testUseSkill(1), script({ target: 'p3' }, seen));
    expect([b.pos, d.pos]).toEqual(['R8', 'R5']);
    expect(seen.map((x) => x.kind)).toEqual(['target']);
  });

  it(`乾坤挪移 only reaches players within swapRange`, () => {
    const g = ringGame();
    spread(g);
    g.state.players[1].pos = 'R0';
    g.state.players[3].pos = `R${rules.swapRange + 1}`;
    g.state.players[0].pos = `R${32 - rules.swapRange}`;
    g.state.players[2].pos = 'R16';
    expect(g.skillTargets(1)).toEqual([0]);
  });

  it('剑遁 only reaches players within swordDashRange steps along the roads', () => {
    const g = ringGame();
    spread(g);
    g.data.config.rules.swordDashRange = 8;
    g.state.players[2].pos = 'R0';
    g.state.players[0].pos = 'R8'; // 8 steps clockwise
    g.state.players[1].pos = 'R23'; // 9 steps counter-clockwise
    g.state.players[3].pos = 'S2'; // R0 → R4 → S1 → S2: 6 steps
    expect(g.board.distance('R0', 'R23')).toBe(9);
    expect(g.skillTargets(2)).toEqual([0, 3]);
  });

  it('镇山 stops the next other player entering the mountain, and fades at the owner next turn', () => {
    const g = ringGame();
    spread(g);
    const a = g.state.players[0];
    a.pos = 'R1';
    g.runFlow(g.testUseSkill(0), script({ target: 'node:R3' }));
    expect(g.state.roadblock).toEqual({ node: 'R3', seat: 0 });
    const d = g.state.players[3];
    d.pos = 'R0';
    g.runFlow(g.testMove(3, 6), script({ buy: 'no' }));
    expect(d.pos).toBe('R3');
    expect(g.state.roadblock).toBeNull();
    expect(g.log.some((e) => e.type === 'roadblockHit')).toBe(true);

    a.skillReadyTurn = 0;
    g.runFlow(g.testUseSkill(0), script({ target: 'node:R2' }));
    g.runFlow(g.testPlayTurn(0), script({ buy: 'no', action: 'end', preRoll: 'roll' }));
    expect(g.state.roadblock).toBeNull();
    expect(g.log.some((e) => e.type === 'roadblockGone')).toBe(true);
  });

  it('迷魂丹 halves the target next move (rounded down, at least 1)', () => {
    const g = ringGame();
    spread(g);
    g.runFlow(g.testUseSkill(3), script({ target: 'p1' }));
    const b = g.state.players[1];
    expect(b.dazed).toBe(true);
    b.pos = 'R0';
    g.runFlow(g.testMove(1, 7), script({ buy: 'no' }));
    expect(b.pos).toBe('R3');
    expect(b.dazed).toBe(false);
    b.dazed = true;
    g.runFlow(g.testMove(1, 1), script({ buy: 'no' }));
    expect(b.pos).toBe('R4');
  });

  it(`goes on cooldown for skillCooldownTurns of the user's own turns and is ready from turn 1`, () => {
    const g = ringGame();
    spread(g);
    const d = g.state.players[3];
    d.turnsTaken = 1;
    expect(g.skillReady(3)).toBe(true);
    g.runFlow(g.testUseSkill(3), script({ target: 'p1' }));
    expect(d.stats.skillUses).toBe(1);
    for (let k = 1; k < rules.skillCooldownTurns; k++) {
      d.turnsTaken++;
      expect(g.skillReady(3)).toBe(false);
    }
    d.turnsTaken++;
    expect(g.skillReady(3)).toBe(true);
  });

  it('the action menu offers the skill only when ready', () => {
    const g = ringGame();
    spread(g);
    const seen: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(3), script({ buy: 'no', action: 'end', duel: 'none' }, seen));
    const acts = seen.filter((c) => c.kind === 'action').flatMap((c) => c.options.map((o) => o.id));
    expect(acts).toContain('skill');
    g.state.players[3].skillReadyTurn = 99;
    const seen2: PendingChoice[] = [];
    g.runFlow(g.testPlayTurn(3), script({ buy: 'no', action: 'end', duel: 'none' }, seen2));
    expect(seen2.filter((c) => c.kind === 'action').flatMap((c) => c.options.map((o) => o.id))).not.toContain('skill');
  });
});
