// What a seat chip and a land tooltip say. Rules stay in core/rules; this file only formats them.
import { closureOdds, type ClosureOdds } from '../core/closureOdds';
import { skillTerms } from '../core/heroes';
import {
  barFull, barSize, canClose, closurePlaces, closureSite, hasTrait, insightBonus, isGlowing, realmName, realmOf, winRealm,
} from '../core/rules';
import type { GameData, GameState, PlayerState } from '../core/types';

export type TagTone = 'gold' | 'bad' | 'dim' | 'text';

export interface ChipTag {
  label: string;
  desc: string;
  tone: TagTone;
}

export interface CloseReadout {
  label: string;
  pct: number;
  detail: string;
}

export interface ChipFace {
  realm: string;
  note: string;
  noteGold: boolean;
  filled: number;
  total: number;
  herbs: number;
  pills: number;
  stones: number;
  mind: number;
  pillGold: boolean;
  glow: boolean;
  tags: ChipTag[];
}

/** Whole-pixel segment widths. Gaps are not included. A count below 2 is one segment. */
export function barSegments(width: number, count: number, gap = 2): number[] {
  if (count <= 1) return [width];
  const inner = width - (count - 1) * gap;
  const base = Math.floor(inner / count);
  let extra = inner - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  return out;
}

/** Unstaked breakthrough chance when this seat can close where it stands. A held 清心符 counts only if `seesHand`. */
export function closeReadout(state: GameState, data: GameData, seat: number, seesHand = false): CloseReadout | null {
  const p = state.players[seat];
  const site = closureSite(state, data, seat, p.pos);
  if (site === null || !canClose(state, data, seat)) return null;
  const odds = closureOdds(state, data, seat, site, { seesHand });
  const pct = Math.round(odds.stakes[0].chance * 100);
  return {
    label: `可闭关 ${pct}%`,
    pct,
    detail: `不押丹约 ${pct}%。2D6 + ${odds.bonus} ≥ ${odds.target}，${bonusText(odds)}。`,
  };
}

export function chipFace(state: GameState, data: GameData, seat: number, seesHand = false): ChipFace {
  const p = state.players[seat];
  const total = barSize(data, p);
  const close = closeReadout(state, data, seat, seesHand);
  const note = realmNote(state, data, seat, close);
  return {
    realm: realmName(data, p.realm),
    note: note.text,
    noteGold: note.gold,
    filled: total === 0 ? 0 : Math.min(p.cult, total),
    total,
    herbs: p.herbs,
    pills: p.pills,
    stones: p.stones,
    mind: p.mind,
    pillGold: isGlowing(state, data, seat),
    glow: isGlowing(state, data, seat),
    tags: seatTags(state, data, seat),
  };
}

export function closeDetail(state: GameState, data: GameData, seat: number, seesHand = false): string {
  const close = closeReadout(state, data, seat, seesHand);
  if (close) return close.detail;
  const p = state.players[seat];
  if (p.realm >= winRealm(data)) return '已化神。';
  if (barFull(data, p)) return `修为已满。走到${closurePlaces(data)}才能闭关。`;
  const realm = realmOf(data, p.realm);
  return `修为条满 ${realm.bar} 后，在${closurePlaces(data)}闭关。2D6 + 加成 ≥ ${realm.target} 即突破。`;
}

export function failLine(data: GameData): string {
  const steady = data.heroes.find((h) => h.passive.traits.includes('steadyBar'));
  const mind = data.config.breakthrough.mindBonus;
  if (steady) return `突破失败：修为条减半（${steady.name}不掉），心境 +${mind}。`;
  return `突破失败：修为条减半，心境 +${mind}。`;
}

export function resourceTip(state: GameState, data: GameData, seat: number): string {
  const p = state.players[seat];
  const c = data.config;
  const lines = [
    `灵草 ${p.herbs}`,
    `丹药 ${p.pills}`,
    `灵石 ${p.stones}`,
    `心境 ${p.mind}（每点突破 +${c.breakthrough.mindBonus}）`,
  ];
  if (isGlowing(state, data, seat)) lines.push(`宝光：斗法失败被夺 ${c.duel.glowSteal} 颗丹药。`);
  return lines.join('\n');
}

export function seatTags(state: GameState, data: GameData, seat: number): ChipTag[] {
  const p = state.players[seat];
  const tags: ChipTag[] = [];
  pushDebuffs(tags, p);
  tags.push(skillTag(data, p));
  pushBuffs(tags, state, data, seat);
  return tags;
}

export function homeClosureNote(data: GameData): string {
  const names = data.heroes
    .filter((h) => h.passive.traits.includes('homeClosure'))
    .map((h) => `${h.name}（${h.school}）`);
  if (names.length === 0) return '';
  return `${names.join('、')}在自家灵田上都能闭关，上表不可闭关的等级按 +0。`;
}

function realmNote(
  state: GameState, data: GameData, seat: number, close: CloseReadout | null,
): { text: string; gold: boolean } {
  if (close) return { text: close.label, gold: true };
  const p = state.players[seat];
  if (p.realm >= winRealm(data)) return { text: '已化神', gold: true };
  if (barFull(data, p)) return { text: '条满', gold: true };
  return { text: '', gold: false };
}

function bonusText(odds: ClosureOdds): string {
  const b = odds.fixed;
  const parts: [string, number][] = [
    ['地点', b.site],
    ['心境', b.mind],
    ['指点', b.guidance],
    ['感悟', b.insight],
    ['战意', b.momentum],
    ['清心符', odds.calm],
  ];
  const shown = parts.filter(([, n]) => n !== 0).map(([name, n]) => `${name} ${n > 0 ? '+' : ''}${n}`);
  return shown.length === 0 ? '无额外加成' : shown.join('，');
}

function pushDebuffs(tags: ChipTag[], p: PlayerState): void {
  if (p.bound) tags.push({ label: '定身', desc: '中了定身符：下回合不能移动，原地结算。', tone: 'bad' });
  if (p.dazed) tags.push({ label: '迷魂', desc: '中了迷魂丹：下一次掷骰移动的步数减半（向下取整，至少 1）。', tone: 'bad' });
}

function pushBuffs(tags: ChipTag[], state: GameState, data: GameData, seat: number): void {
  const p = state.players[seat];
  const b = data.config.breakthrough;
  if (isGlowing(state, data, seat)) {
    tags.push({
      label: '宝光',
      desc: `丹药达到 ${data.config.duel.glowAt} 颗，或本轮宝光外泄。斗法输了被夺 ${data.config.duel.glowSteal} 颗。`,
      tone: 'gold',
    });
  }
  if (p.momentum || hasTrait(data, p, 'momentum')) {
    tags.push({
      label: '战意',
      desc: p.momentum
        ? `斗法得胜的余势：下次闭关突破 +${b.momentumBonus}，闭关时用掉。`
        : `尚未获得。主动斗法得胜后，下次闭关突破 +${b.momentumBonus}。`,
      tone: p.momentum ? 'gold' : 'dim',
    });
  }
  if (hasTrait(data, p, 'insight')) {
    tags.push({
      label: `感悟 ${p.insight}`,
      desc: `过目不忘：下次闭关突破 +${insightBonus(data, p)}，闭关时用尽。`,
      tone: p.insight > 0 ? 'gold' : 'dim',
    });
  }
  if (p.guidance > 0) {
    tags.push({ label: '指点', desc: `下次闭关突破 +${b.guidanceBonus}。`, tone: 'gold' });
  }
}

function skillTag(data: GameData, p: PlayerState): ChipTag {
  const hero = data.heroes.find((h) => h.id === p.hero)!;
  const phase = hero.skill.timing === 'preroll' ? '掷骰前' : '行动阶段';
  const wait = p.skillReadyTurn - p.turnsTaken;
  const missing = Math.max(0, hero.skill.pillCost - p.pills);
  const label = wait > 0
    ? `技能 冷却 ${wait}`
    : missing > 0
      ? `技能 缺丹 ${missing} · ${phase}`
      : `技能 就绪 · ${phase}`;
  return {
    label,
    desc: `【${hero.skill.name}】${hero.skill.desc}。${skillTerms(hero.skill)}（按 K 或在「出符」菜单发动）。\n被动【${hero.passive.name}】${hero.passive.desc}。`,
    tone: 'text',
  };
}
