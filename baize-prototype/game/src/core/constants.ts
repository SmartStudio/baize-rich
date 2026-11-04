// Rule numbers that appear only in GDD text (docs/GDD.md) or card descriptions,
// NOT as fields in data/*.json. Kept in one place so they can be moved into the
// JSON later without hunting through the engine. (Listed in NOTES.md.)
export const RULES = {
  /** §9.4 / §12 */
  alchBuyDiscount: 0.9, // 丹道营商：购地 9 折
  discountCardMult: 0.7, // 折扣符：7 折
  buyoutMult: 1.5, // 灵丹换地：1.5 倍价
  swordQiSteal: 20, // 剑气
  goldtouchStones: 200, // 点金符
  swiftstepMax: 3, // 神行符 +1..+3
  swiftDivineDelta: 1, // 身轻如燕 ±1
  swordUltDelta: 3, // 御剑飞行 ±3
  magicPassivePills: 1, // 灵息
  gatherPills: 1, // 聚灵
  midasMult: 1.2, // 点石成金 +20%
  goldbodyCooldownRounds: 3, // 金身 每 3 回合
  shrinkCooldownRounds: 3, // 缩地成寸 每 3 回合
  pillheartBelow: 2, // 丹心 灵丹 < 2 时 +1
  immovableTurns: 2, // 不动明王：本回合与下回合
  /** §9.5 天赐 */
  wardRounds: 4,
  chartCultivation: 1,
  chartDraw: 1,
  auspiceLands: 2,
  veinStones: 400,
  dawnPills: 4,
  /** §8.1 / §10 */
  bountyCultivation: 1,
  demonLastHitCultivation: 2,
  thunderDemonDamage: 2,
  magicUltDemonDamage: 3,
  subdueDamageMult: 2,
  /** §4 tiles */
  springPills: 1,
  furnacePills: 2,
  shrinePills: 1,
  /** §11.2 灵兽引路 */
  beastRollMin: 1,
  beastRollMax: 6,
  /** §9.4 神识 */
  senseDrawCount: 2,
} as const;
