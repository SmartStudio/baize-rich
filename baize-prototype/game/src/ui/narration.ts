import type { Game } from '../core/engine';
import type { GameEvent, GameEventType } from '../core/events';
import type { GameData, GameState } from '../core/types';

type EventNarrator = ((game: Game, event: GameEvent) => string) | null;

const raw: EventNarrator = (_game, event) => event.text;
const silent: EventNarrator = null;

function playerName(game: Game, seat = 0): string {
  const player = game.state.players[seat];
  return game.data.heroes.find((hero) => hero.id === player?.hero)?.name ?? '无名修士';
}

function eventPlayer(game: Game, event: GameEvent): string {
  return playerName(game, event.player);
}

export function heroNameForSeat(game: Game, seat: number): string {
  return playerName(game, seat);
}

function nodeName(game: Game, event: GameEvent): string {
  return event.node ? game.board.node(event.node).name : '前路';
}

function breakthrough(game: Game, event: GameEvent): string {
  const result = event.breakthrough;
  if (!result) return event.text;
  const name = eventPlayer(game, event);
  const bonus = Object.values(result.bonuses).reduce((sum, value) => sum + value, 0);
  const check = `${result.dice[0]} + ${result.dice[1]} + 加成 ${bonus} = ${result.total}，目标 ${result.target}。`;
  if (!result.success) {
    const loss = result.cultLost > 0 ? `修为散去 ${result.cultLost} 点。` : '修为未散。';
    return `${name}闭关。${check}气血逆冲，这一次没成。${loss}心境更稳一分。`;
  }
  const realm = game.data.config.realms[result.from + 1]?.name;
  const success: Record<string, string> = {
    筑基: '气海成池，道基已筑。',
    结丹: '丹成一粒，自此不同凡俗。',
    元婴: '碎丹成婴，神魂不灭。',
    化神: `天劫散尽。${name}，化神了。`,
  };
  return `${name}闭关。${check}${success[realm] ?? `踏入${realm}。`}`;
}

function duel(game: Game, event: GameEvent): string {
  const result = event.duel;
  if (!result) return event.text;
  const attacker = playerName(game, result.attacker);
  const defender = playerName(game, result.defender);
  const winner = playerName(game, result.winner);
  const prize = result.escaped
    ? `${playerName(game, result.loser)}元婴遁走，宝物未失。`
    : result.pills > 0
      ? `${winner}夺走 ${result.pills} 颗丹药。`
      : `${winner}夺走 ${result.stones} 灵石。`;
  return `${attacker}向${defender}出手。${result.totals[0]} 对 ${result.totals[1]}，${winner}胜。${prize}`;
}

function cultivation(game: Game, event: GameEvent): string {
  const change = event.cult;
  if (!change) return event.text;
  const source: Record<typeof change.source, string> = {
    breath: '吐纳',
    sit: '打坐',
    spring: '饮下灵泉',
    eye: '参悟灵眼',
    pill: '服下丹药',
    altar: '白泽问心',
    event: '得了机缘',
    manifest: '承了白泽机缘',
  };
  const parts = [
    change.gained !== 0 ? `修为 ${change.gained > 0 ? '+' : ''}${change.gained}` : '',
    change.insight > 0 ? `感悟 +${change.insight}` : '',
    change.wasted > 0 ? `${change.wasted} 点修为散去` : '',
  ].filter(Boolean);
  return `${eventPlayer(game, event)}${source[change.source]}。${parts.join('，')}。`;
}

export const EVENT_NARRATION = {
  gameStart: () => '白泽秘境开了。四个凡人，开始问道。',
  roundStart: raw,
  roundEnd: (_game, event) => `第 ${event.round} 轮落幕。秘境又少了一轮。`,
  turnStart: (game, event) => `轮到${eventPlayer(game, event)}。`,
  turnEnd: (game, event) => `${eventPlayer(game, event)}收功，静候下一轮。`,
  roll: (game, event) => event.dice
    ? `${eventPlayer(game, event)}掷出 ${event.dice[0]} 与 ${event.dice[1]}，前行 ${event.amount} 步。`
    : event.text,
  step: silent,
  teleport: raw,
  fork: raw,
  toll: (game, event) => `${eventPlayer(game, event)}留下 ${game.data.config.altarToll} 颗丹药，从白泽灵台借道。`,
  salary: raw,
  buy: (game, event) => `${eventPlayer(game, event)}以 ${event.amount} 灵石买下「${nodeName(game, event)}」。`,
  rent: raw,
  rentFree: raw,
  upgrade: raw,
  stones: raw,
  herbs: raw,
  pills: raw,
  cult: cultivation,
  card: raw,
  cast: raw,
  block: raw,
  event: raw,
  bind: raw,
  status: raw,
  beast: raw,
  breakthrough,
  manifest: () => '秘境过半。白泽现世，让走得慢的人先挑。',
  bankrupt: (game, event) => {
    const reset = game.data.config.bankrupt.resetStones;
    return `${eventPlayer(game, event)}灵石耗尽，地契尽失。领回 ${reset} 灵石，从头再来。`;
  },
  win: (game, event) => game.state.endReason === 'ascend'
    ? `${eventPlayer(game, event)}渡劫化神。凡人，也能成仙。`
    : `${game.data.config.rounds} 轮已尽。${eventPlayer(game, event)}走得最远。`,
  gameEnd: silent,
  info: raw,
  duel,
  skill: raw,
  roadblock: (game, event) => `${eventPlayer(game, event)}一掌镇山。山岳落在「${nodeName(game, event)}」。`,
  roadblockHit: raw,
  roadblockGone: (game, event) => `${eventPlayer(game, event)}留下的山岳散了。`,
  miniGame: (game, event) => {
    const result = event.miniGame;
    if (!result) return event.text;
    if (result.tier === 'fail') return `${eventPlayer(game, event)}收火慢了。一炉成灰，余下炼得 ${result.pills} 颗丹药。`;
    if (result.tier === 'perfect') return `${eventPlayer(game, event)}在金火正中收炉，炼得 ${result.pills} 颗丹药。`;
    return `${eventPlayer(game, event)}守住火候，炼得 ${result.pills} 颗丹药。`;
  },
} satisfies Record<GameEventType, EventNarrator>;

export function narrateEvent(game: Game, event: GameEvent): string | null {
  const narrator = EVENT_NARRATION[event.type];
  return narrator ? narrator(game, event) : null;
}

export function roundNarration(game: Game, state: GameState): { title: string; sub: string } {
  const { manifest, rounds } = game.data.config;
  const left = manifest.round - state.round;
  const sub = state.round === rounds
    ? '最后一轮。秘境将闭，莫留遗憾。'
    : left > 0
      ? `再过 ${left} 轮，白泽现世。`
      : '秘境已过半。先化神者，先出此门。';
  return { title: `第 ${state.round} / ${rounds} 轮`, sub };
}

export function turnNarration(name: string, round: number, multiHuman: boolean): { title: string; sub: string } {
  return {
    title: multiHuman ? `轮到${name}` : `${name}，该你了`,
    sub: `第 ${round} 轮。按空格掷骰，也可先整备。`,
  };
}

export function aiTurnNarration(name: string): string {
  return `${name}动身了`;
}

export function resumeNarration(round: number): string {
  return `旧局重开。仍是第 ${round} 轮。`;
}

export function titleNarration(data: GameData): string[] {
  return [
    '世人皆说，修仙要看灵根。',
    '灵根好的，十岁入宗门，三十岁筑基，前程似锦。',
    '灵根差的，一辈子挑水、砍柴，看着别人御剑飞过头顶。',
    '直到那一年，白泽秘境开了。',
    '秘境里有灵田、丹房和前人留下的机缘。也有比妖兽更可怕的同道。',
    `秘境只开 ${data.config.rounds} 年。`,
    '四个灵根驳杂的少年，揣着全部家当，走了进去。',
  ];
}

export const TITLE_SUBTITLE = '凡人问道，就从今天开始。';

export interface TutorialCopy {
  id: 'goal' | 'turn' | 'land' | 'alchemy' | 'breakthrough' | 'duel' | 'heroes' | 'baize';
  title: string;
  lines: string[];
}

function building(data: GameData, level: number): string {
  return data.board.buildings[level].name;
}

const goalPage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  return {
    id: 'goal',
    title: '目标：化神或秘境关闭',
    lines: [
      `四个凡人同入秘境。最先踏入${cfg.realms.at(-1)!.name}的人，立即获胜。`,
      `第 ${cfg.rounds} 轮结束仍无人化神，先比境界，再比修为，最后比总资产。`,
      '灵田养草，灵草炼丹，丹药护住突破。所有积攒，都为往上走一步。',
      `灵石耗尽也不会出局。灵田归还，修为清空，带着 ${cfg.bankrupt.resetStones} 灵石重来。`,
    ],
  };
};

const turnPage = (): TutorialCopy => ({
  id: 'turn',
  title: '一回合',
  lines: [
    '回合开始时，先结算定身和技能冷却。',
    '掷骰前可以出符、用技能。修为圆满且身在闭关地时，也可先闭关。',
    '掷骰后沿路前进。经过修士时，可以发起斗法。',
    '停下后结算灵田、丹房、坊市或机缘。',
    '行动阶段可以升级、服丹、出符、用技能或闭关。结束时吐纳，在自家灵田还会打坐。',
  ],
});

const landPage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  const body = data.heroes.find((hero) => hero.id === 'body')!;
  return {
    id: 'land',
    title: '灵田与灵草',
    lines: [
      '买下无主灵田。别人停在这里，会向你交租。',
      `灵田升为${building(data, 1)}后，每轮产 ${cfg.landLevels[1].herbs} 株灵草，也能闭关。`,
      `升到${building(data, 2)}或${building(data, 3)}，打坐可得 ${cfg.landLevels[2].sit} 点修为。`,
      `${building(data, 3)}闭关另有 +${cfg.landLevels[3].closureBonus} 地利。`,
      `${body.name}能在自家任何灵田闭关。其他人要先把灵田升为${building(data, 1)}。`,
    ],
  };
};

const alchemyPage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  const alch = data.heroes.find((hero) => hero.id === 'alch')!;
  return {
    id: 'alchemy',
    title: '炼丹',
    lines: [
      `停在丹房时，每 ${cfg.alchemy.herbsPerPill} 株灵草可炼一颗丹药。灵草够，就能连炼。`,
      `第一炉要看火候。正中金区多出 ${cfg.alchemy.perfectBonus} 颗，失手则这一炉成灰。`,
      `${alch.name}每次停在丹房，还会多得 ${cfg.alchemy.alchBonus} 颗丹药。`,
      `${alch.name}站在自家${building(data, cfg.alchemy.furnaceLevel)}以上的灵田时，也能开随身药炉。`,
      `丹药可服下，换 ${cfg.cultivation.pill} 点修为。也可押进突破，换更稳的一线生机。`,
    ],
  };
};

const breakthroughPage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  const body = data.heroes.find((hero) => hero.id === 'body')!;
  return {
    id: 'breakthrough',
    title: '闭关突破与押丹',
    lines: [
      `修为条圆满后，在自家${building(data, 1)}以上的灵田或白泽灵台闭关。`,
      `突破目标依次为 ${cfg.realms.slice(0, -1).map((realm) => realm.target).join('、')}。检定总和达到目标便成。`,
      `每押一颗丹药 +${cfg.breakthrough.pillBonus}，最多押 ${cfg.breakthrough.maxPills} 颗。成败都会消耗。`,
      `白泽灵台和自家${building(data, 3)}另有 +${cfg.breakthrough.altarBonus} 地利。`,
      `走火入魔会损失一半修为，心境 +${cfg.breakthrough.mindBonus}。${body.name}的修为不会散。`,
    ],
  };
};

const duelPage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  const body = data.heroes.find((hero) => hero.id === 'body')!;
  const sword = data.heroes.find((hero) => hero.id === 'sword')!;
  return {
    id: 'duel',
    title: '斗法与宝光',
    lines: [
      '移动途中或落点遇到修士，可以向其中一人斗法。平局时守方胜。',
      `境界、神识、剑气和铜皮铁骨都会影响胜负。${sword.name}攻方 +${cfg.duel.swordAttack}，${body.name}守方 +${cfg.duel.bodyDefense}。`,
      `胜者先夺 ${cfg.duel.steal} 颗丹药。败者无丹，便夺 ${cfg.duel.lossStones} 灵石。`,
      `身怀 ${cfg.duel.glowAt} 颗丹药就会冒宝光。来犯者 +${cfg.duel.glowBonus}，败时会被夺 ${cfg.duel.glowSteal} 颗。`,
      `到了${cfg.realms[3].name}，每轮首次落败可元婴遁走，不失宝物。`,
    ],
  };
};

const heroesPage = (data: GameData): TutorialCopy => {
  const [body, magic, sword, alch] = ['body', 'magic', 'sword', 'alch']
    .map((id) => data.heroes.find((hero) => hero.id === id)!);
  return {
    id: 'heroes',
    title: '四位修士',
    lines: [
      `${body.name}，${body.origin}。守得住，也熬得住。`,
      `${magic.name}，${magic.origin}。把多出的修为记作感悟，也能引雷破境。`,
      `${sword.name}，${sword.origin}。斗法得胜便养出战意，也能剑遁追敌。`,
      `${alch.name}，${alch.origin}。丹房多出丹，在自家灵田也能开炉。`,
      '没有天才。选一条活路，把它走到底。',
    ],
  };
};

const baizePage = (data: GameData): TutorialCopy => {
  const cfg = data.config;
  return {
    id: 'baize',
    title: '白泽现世',
    lines: [
      `第 ${cfg.manifest.round} 轮开始，白泽现世。境界和修为落后的人先挑机缘。`,
      `白泽图给 ${cfg.manifest.chartCult} 点修为。灵脉馈赠给 ${cfg.manifest.giftStones} 灵石。`,
      `丹霞给 ${cfg.manifest.giftPills} 颗丹药。指路会把人送到白泽灵台。`,
      `白泽灵台可闭关并得 +${cfg.breakthrough.altarBonus} 地利。停留却不闭关，会得 ${cfg.cultivation.altarCalm} 点修为。`,
      `步数未尽时，也可留下 ${cfg.altarToll} 颗丹药借道。`,
    ],
  };
};

export function tutorialCopy(data: GameData): TutorialCopy[] {
  return [
    goalPage(data),
    turnPage(),
    landPage(data),
    alchemyPage(data),
    breakthroughPage(data),
    duelPage(data),
    heroesPage(data),
    baizePage(data),
  ];
}
