import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../src/core/choices';
import type { Game } from '../src/core/engine';
import { ringGame, rngFor, script } from './helpers';

// Seats in newGame: 0 A 体修(body), 1 B 法修(magic), 2 C 剑修(sword), 3 D 丹师(alch).

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
const duel = ringGame().data.config.duel;

describe('斗法', () => {
  const lastDuel = (g: Game) => g.log.filter((x) => x.type === 'duel').pop()!.duel!;

  it('higher 1D6 total wins and takes one pill', () => {
    const g = ringGame();
    spread(g);
    const [d, b] = [g.state.players[3], g.state.players[1]]; // 丹师 vs 法修: no hero bonus
    b.pills = 2;
    g.state.rng = rngFor([5, 2]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g)).toMatchObject({ rolls: [5, 2], bonus: [0, 0], winner: 3, loser: 1, pills: duel.steal });
    expect([d.pills, b.pills]).toEqual([duel.steal, 2 - duel.steal]);
  });

  it('a loser without pills hands over lossStones; a tie goes to the defender', () => {
    const g = ringGame();
    spread(g);
    g.state.rng = rngFor([6, 1]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(g.state.players[3].stones).toBe(1000 + duel.lossStones);
    g.state.rng = rngFor([4, 4]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g).winner).toBe(1);
  });

  it('剑修 attacks +1, 体修 defends +1, and the higher realm adds the gap', () => {
    const g = ringGame();
    spread(g);
    g.state.rng = rngFor([3, 3]);
    g.runFlow(g.testDuel(2, 0), script({}));
    expect(lastDuel(g).bonus).toEqual([duel.swordAttack, duel.bodyDefense]);
    g.state.players[3].realm = 2;
    g.state.rng = rngFor([3, 3]);
    g.runFlow(g.testDuel(1, 3), script({}));
    expect(lastDuel(g).bonus).toEqual([0, 2 + duel.senseBonus]); // 结丹 has 神识
  });

  it('宝光: a defender holding glowAt+ pills gives the attacker +1 and loses two pills', () => {
    const g = ringGame();
    spread(g);
    const b = g.state.players[1];
    b.pills = duel.glowAt;
    g.state.rng = rngFor([4, 4]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g)).toMatchObject({ bonus: [duel.glowBonus, 0], winner: 3, pills: duel.glowSteal });
    expect(b.pills).toBe(duel.glowAt - duel.glowSteal);
  });

  it('宝光外泄 makes a player glow for the round even without pills', () => {
    const g = ringGame();
    spread(g);
    g.runFlow(g.testFortune(1, 'leak'), script({}));
    g.state.rng = rngFor([4, 4]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g).bonus).toEqual([duel.glowBonus, 0]);
  });

  it('元婴遁: a 元婴 loser keeps the loot once per round', () => {
    const g = ringGame();
    spread(g);
    const b = g.state.players[1];
    b.realm = 3;
    b.pills = 1;
    g.state.players[3].realm = 3;
    g.state.rng = rngFor([6, 1, 6, 1]);
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g)).toMatchObject({ winner: 3, escaped: true, pills: 0 });
    g.runFlow(g.testDuel(3, 1), script({}));
    expect(lastDuel(g)).toMatchObject({ winner: 3, escaped: false, pills: 1 });
    expect(b.pills).toBe(0);
  });

  it('金光符 blocks the duel before any dice are rolled', () => {
    const g = ringGame();
    spread(g);
    const b = g.state.players[1];
    b.hand = ['goldlight'];
    b.pills = 2;
    g.runFlow(g.testDuel(3, 1), script({ guardReact: 'goldlight' }));
    expect(g.log.some((x) => x.type === 'duel')).toBe(false);
    expect(b.pills).toBe(2);
    expect(b.hand).toEqual([]);
  });

  it('夺灵符 takes one pill unless 金光符 answers', () => {
    const g = ringGame();
    spread(g);
    const [d, b] = [g.state.players[3], g.state.players[1]];
    d.hand = ['drain', 'drain'];
    b.pills = 2;
    g.runFlow(g.testActionPhase(3), script({ action: ['cast:drain', 'end'], target: 'p1' }));
    expect([d.pills, b.pills]).toEqual([1, 1]);
    b.hand = ['goldlight'];
    g.runFlow(g.testActionPhase(3), script({ action: ['cast:drain', 'end'], target: 'p1', guardReact: 'goldlight' }));
    expect([d.pills, b.pills]).toEqual([1, 1]);
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
    expect(g.duelCandidates(3)).toEqual([]);
  });
});

describe('§12 主动技能', () => {
  it('剑遁 teleports onto the target, duels at once, settles the tile and replaces the roll', () => {
    const g = ringGame();
    spread(g);
    const c = g.state.players[2];
    c.pos = 'R1';
    g.state.players[1].pos = 'R5'; // 4 steps, inside swordDashRange
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
