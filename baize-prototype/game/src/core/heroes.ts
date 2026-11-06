import type { HeroId, HeroSkillData } from './types';
export const HERO_IDS: HeroId[] = ['body', 'magic', 'sword', 'alch'];

/** What a skill costs, as shown next to its name: 「耗 1 颗丹药 · 冷却 3 回合」. */
export function skillTerms(skill: HeroSkillData): string {
  const cost = skill.pillCost > 0 ? `耗 ${skill.pillCost} 颗丹药 · ` : '';
  return `${cost}冷却 ${skill.cooldown} 回合`;
}
