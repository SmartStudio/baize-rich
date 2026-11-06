// Which first-game sentence is due, from the game moment that just happened.
// Phaser draws the bubble. This module only decides the sentence and its anchor.
import type { GameData } from '../core/types';
import type { NodeId } from '../core/types';
import { realmName, winRealm } from '../core/rules';

export const COACH_STEPS = ['roll', 'buy', 'cult', 'herbs', 'closure', 'glow', 'win'] as const;
export type CoachStep = (typeof COACH_STEPS)[number];

export function isCoachStep(value: string): value is CoachStep {
  return (COACH_STEPS as readonly string[]).includes(value);
}

export type CoachAt =
  | { t: 'roll' }
  | { t: 'round' }
  | { t: 'cult' }
  | { t: 'herbs' }
  | { t: 'glow' }
  | { t: 'closure' }
  | { t: 'tile'; node: NodeId };

export interface CoachCue {
  step: CoachStep;
  text: string;
  seat: number;
  at: CoachAt;
}

export interface CoachBook {
  seen: CoachStep[];
  waiting: CoachCue[];
  showing: CoachStep | null;
}

export type CoachMoment =
  | {
      t: 'choice';
      human: boolean;
      seat: number;
      kind: string;
      node?: NodeId;
      nodeType?: string;
      closure: boolean;
    }
  | {
      t: 'event';
      human: boolean;
      seat: number;
      type: string;
      node?: NodeId;
      nodeType?: string;
      cultGained: number;
      glowing: boolean;
    };

export interface CoachCopy {
  [step: string]: string;
}

function zh(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n === 2) return '两';
  if (n < 10) return d[n] ?? String(n);
  if (n === 10) return '十';
  if (n < 20) return `十${d[n - 10]}`;
  return String(n);
}

export function emptyBook(seen: readonly CoachStep[] = []): CoachBook {
  return { seen: [...seen], waiting: [], showing: null };
}

export function coachCopy(data: GameData): Record<CoachStep, string> {
  const herbLevel = data.config.landLevels.findIndex((level) => level.herbs > 0);
  const closeLevel = data.config.landLevels.findIndex((level) => level.closureBonus !== null);
  const herbName = data.board.buildings[herbLevel]?.name ?? '药圃';
  const closeName = data.board.buildings[closeLevel]?.name ?? '药圃';
  const per = zh(data.config.alchemy.herbsPerPill);
  const glow = zh(data.config.duel.glowAt);
  const rounds = zh(data.config.rounds);
  const win = realmName(data, winRealm(data));
  return {
    roll: '按空格掷骰，点数就是你要走的格数。',
    buy: '这块灵田没人要。买下它，别人路过交半租，停下交全租。你停在这里还能打坐修炼。',
    cult: '左边是你的修为条。每个回合都会吐纳长一点，在自家地上打坐长得更快。',
    herbs: `${herbName}会长灵草。带着灵草去丹房，${per}株炼一颗丹药。`,
    closure: `修为条满了，就在灵台或自家${closeName}以上的灵田闭关。押上丹药，成功率更高。失败会走火入魔。`,
    glow: `丹药揣到${glow}颗，身上就会冒宝光。别人会盯上你，留着还是吃掉，你自己想。`,
    win: `先渡劫${win}的人赢。秘境第${rounds}年关闭，到时看谁境界最高。`,
  };
}

export function observe(book: CoachBook, moment: CoachMoment, copy: Record<CoachStep, string>, armed = true): { book: CoachBook; cue: CoachCue | null } {
  if (!armed) return { book, cue: null };
  const waiting = queue(book, moment, copy);
  if (book.showing) return { book: { ...book, waiting }, cue: null };
  return nudge({ ...book, waiting });
}

export function dismiss(book: CoachBook, step: CoachStep): CoachBook {
  const seen = book.seen.includes(step) ? book.seen : [...book.seen, step];
  return { seen, waiting: book.waiting.filter((cue) => cue.step !== step), showing: null };
}

/** Show the next sentence already waiting. Call after a dismiss. */
export function nudge(book: CoachBook): { book: CoachBook; cue: CoachCue | null } {
  if (book.showing || book.waiting.length === 0) return { book, cue: null };
  const [cue, ...waiting] = book.waiting;
  return { book: { ...book, waiting, showing: cue.step }, cue };
}

function queue(book: CoachBook, moment: CoachMoment, copy: Record<CoachStep, string>): CoachCue[] {
  const waiting = book.waiting.filter((cue) => cue.step !== book.showing && !book.seen.includes(cue.step));
  for (const step of stepsDue(moment)) {
    if (book.seen.includes(step) || book.showing === step || waiting.some((cue) => cue.step === step)) continue;
    waiting.push(makeCue(step, moment, copy));
  }
  waiting.sort((a, b) => COACH_STEPS.indexOf(a.step) - COACH_STEPS.indexOf(b.step));
  return waiting;
}

function stepsDue(moment: CoachMoment): CoachStep[] {
  if (!moment.human) return [];
  if (moment.t === 'choice') return choiceSteps(moment);
  return eventSteps(moment);
}

function choiceSteps(moment: Extract<CoachMoment, { t: 'choice' }>): CoachStep[] {
  const steps: CoachStep[] = [];
  if (moment.kind === 'preRoll') steps.push('roll', 'win');
  if (moment.kind === 'buy' && moment.node) steps.push('buy');
  if (moment.kind === 'brew' || moment.nodeType === 'alchemy') steps.push('herbs');
  if (moment.closure) steps.push('closure');
  return steps;
}

function eventSteps(moment: Extract<CoachMoment, { t: 'event' }>): CoachStep[] {
  const steps: CoachStep[] = [];
  if (moment.type === 'cult' && moment.cultGained > 0) steps.push('cult');
  if (moment.type === 'herbs' || (moment.type === 'info' && moment.nodeType === 'alchemy')) steps.push('herbs');
  if (moment.glowing) steps.push('glow');
  return steps;
}

function makeCue(step: CoachStep, moment: CoachMoment, copy: Record<CoachStep, string>): CoachCue {
  return { step, text: copy[step], seat: moment.seat, at: anchor(step, moment) };
}

function anchor(step: CoachStep, moment: CoachMoment): CoachAt {
  switch (step) {
    case 'roll': return { t: 'roll' };
    case 'win': return { t: 'round' };
    case 'buy': return moment.node ? { t: 'tile', node: moment.node } : { t: 'round' };
    case 'cult': return { t: 'cult' };
    case 'herbs': return moment.node ? { t: 'tile', node: moment.node } : { t: 'herbs' };
    case 'closure': return { t: 'closure' };
    case 'glow': return { t: 'glow' };
    default: {
      const never: never = step;
      return never;
    }
  }
}
