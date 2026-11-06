import type { HeroId, HeroSkillData } from './types';
export const HERO_IDS: HeroId[] = ['body', 'magic', 'sword', 'alch'];

/** What a skill costs, as shown next to its name: 「冷却 3 回合」. */
export function skillTerms(skill: HeroSkillData): string {
  return `冷却 ${skill.cooldown} 回合`;
}
