# NOTES：规则解读、简化与发现的问题


> 历史记录（v0.4–v0.7 的调参、试玩反馈、已删除系统的解读）在 [`../docs/history/notes-v0.4-v0.7.md`](../docs/history/notes-v0.4-v0.7.md)。棋盘路网与 77 格地图的约束在 [`../docs/board-design.md`](../docs/board-design.md)。

## 0. v0.8「凡人问道」（2026-11-06，现行规则）

规则以 `docs/GDD.md` v0.8 为准，境界是唯一主线。v0.8 删掉了天魔、悬赏令、禁制与路障 / 爆炎、附身灵体、功能建筑、地段连锁 / 一域独占 / 灵脉之主 / 终局加成、医馆 / 思过崖 / 双数、四种地形、灵骰台，以及 `blessings.json`（神通、天赐）。**v0.4–v0.7 的历史记录已移到 `docs/history/notes-v0.4-v0.7.md`**，其中涉及这些系统、修为胜利线、突破机会、灵丹押注斗法的内容都已不再适用。

**实现时的解读（GDD 没写死，由代码决定）**
- 闭关突破在掷骰前也能做：修为条满、站在白泽灵台或自家药圃以上时，掷骰前菜单就有「闭关突破」。否则回合末打坐把条打满后，下回合只能先掷骰走开。每回合最多闭关 1 次。
- 白泽问心（+1 修为）只在本回合停到灵台、且没有闭关时，于回合末结算。
- 定身符：跳过掷骰、移动和落点结算，保留行动阶段。定身符不能用金光符挡（GDD 只写了金光符挡斗法与夺灵符）。
- 金光符在被挑战的那一刻使用，挡下后不掷骰。去掉了 v0.7 的「每轮被挑战一次的保护」和斗法押灵丹，GDD v0.8 没有这两条。
- 御器 ±1 与神行符 +1..+3 只能调整真实掷出的点数，不能叠在御骰符上。
- 前辈指点可以叠加计数，每次突破消耗 1 次。
- 丹房：丹道（丹师 +1）只在本次至少炼了 1 炉时生效；火候失手时第一炉白费（−1 颗）。
- 白泽现世的挑选顺序 = 排名倒序（境界、修为条、总资产从低到高）；四份机缘各只有一份。删掉了 v0.7 的灵雨租金减半。
- 秘境裂隙传到另一个秘境格并再抽 1 张，连锁最多 4 层。

**调参（`npm run sim -- --games 2000`，种子 1，普通难度）**

| §12 指标 | 目标 | 结果 |
|---|---|---|
| 平均轮数 | 10–12 | 11.58 |
| 化神结束 | 50–70% | 60.5% |
| 修士胜率 | 22–28% | 体修 18.2% / 法修 28.3% / 剑修 24.9% / 丹师 28.5% |
| 座位胜率差 | < 3% | 2.0%（24.9 / 25.3 / 23.9 / 25.9） |
| 人均突破 / 走火入魔 | 2.5–3.5 / 约 1 | 3.45 / 0.80 |
| 每局斗法 | ≥ 6 | 8.70 |
| 被夺丹药的回合 | ≥ 5% | 10.7% |
| 第 8 轮领先者获胜 | ≤ 65% | 60.6% |

改过的数值（`config.json`）：四个境界的修为条 3/4/5/6 → 4/4/4/4（目标值 8/9/10/11 不变，难度仍逐级上升）；座位补偿 [0,100,200,300] → [0,25,50,75]；体修守方 +1 → +2；剑遁距离 8 → 5。

**体修：铜皮铁骨加了「在自家地上打坐修为 +1」**（`cultivation.bodySit`）。原因是 GDD 写「体修苟在家打坐」，但没有规则奖励这种打法；只调体修数值（守方 1–3、妖兽谷灵草、剑遁距离）体修最高约 19%。加上之后三组种子各 2000 局：体修 21.6% / 20.9% / 22.4%，法修 26.4–28.3%，剑修 23.9–24.3%，丹师 26.3–27.3%，化神结束 60.8–62.6%，座位差 1.3–2.8%。体修仍略低于 22%，法修贴着上限，留待真人试玩再调。

**其他观察**
- 付租回合只有 2.7%，人均只占约 2.5 块地。地产现在主要靠产灵草和打坐接进主线，租金几乎不影响胜负。
- 灵草经常囤到十几颗再一次炼掉（单次最多见过 20 炉），因为丹房格只有 6 个。


`data/config.json` 新增了 `rules` 块，内容是原来 `src/core/constants.ts` 里的数值，值没有变（见 §2 第 11 条）。`docs/GDD.md` 只改了开头指向这些数值位置的一句。下面每一条都对应代码里的一个具体决定，方便策划逐条确认或改判。


## 界面待重建（v0.8 规则层合并时留下）

规则层为保持能编译，删掉或临时改了下面这些界面引用。画面重写阶段按 GDD v0.8 §14 重做。

### UI references removed in unit 1 (subtract)
- BoardView: spirits/auras (renderSpirits, animateSpirit, spiritPoints, placeSpirit, setAura), demon sprite + moveDemon, 禁制 trap marker, 路障/爆炎阵 marks (renderMarks, MARKS), whole-street double rim + flashStreet, special building frames, render(state, blastAlpha) → render(state)
- Spirits.ts deleted (addSpirit, possessionAura); PreviewScene spirit/aura preview row removed
- Minimap.update: demon + spirits params removed
- TopBar: 天魔 icon/countdown + tooltip line
- TileInfo: special building, 整街 ×mult tail, region ruleName, onTile (spirits, 路障)
- PlayerCards: 神通 icons/divineTip, 任务 tag, 面壁/护道/祠印/不动明王/地脉异动/迷踪/悬赏令/灵狐/心魔/医馆/禁制/灵脉之主 tags, 大招 tag, 神识 hand peek (viewer param), cult-source lines for 灵脉之主/任务/天魔/悬赏/白泽图
- GameScene: cutscenes street/blast/spirit/demonSpawn/ult, ribbons special/shop/barrier/barrierHit/blastSet/hospital/spirit, events slide/demonMove/demonSpawn/spirit/street, blastAlpha, dice mini-game spec, heavenPick/divinePick card modals, buy-modal 灵脉之主/一域独占 lines, shop/diceBet previews, Pace.slide/demon, cast ids trap:/ult/shrink
- HowToPlay: pages 整街/附身/功能建筑 and 百宝阁/小游戏/医馆; lines for 双数/思过崖, 灵脉之主, 任务, 天魔, 悬赏, 白泽图, 禁制, 神通, 大招
- HeroSelect/Setup/Versus: 大招 lines (Versus now shows 技能)
- ResultScene: 神通 count, 任务 count
- assets.ts: div_*/hv_* icon frames
- Left in place, now dead (compile fine): MiniGame.ts dice mode, sprites.ts spirit/shop/hospital/special/card frames, PreviewScene FRAMES list + dice runs, layout SPRITE.demon, card_divine/card_heaven frames

### Unit 2 (v0.8 model) UI touch-ups, minimal, for compile only
- GameScene: miniSpec(MiniGameResult.game) removed, always the alchemy 火候 overlay (HEAT_SPEC). DELTAS now 灵石 / 丹药 / 灵草 / 修为(bar). win cutscene 'cultivation' → 'ascend' 渡劫化神. roundRibbon text no longer mentions winCultivation. baizeManifestRound → manifest.round.
- ResultScene / SetupScene / TitleScene: winCultivation copy replaced by 化神 win text; result rows show realm + bar.
- ActionDock: spell cost badge (circle + number) and "· N 灵丹" in card tooltip removed (cards are free in v0.8). timingName gained adjust / closure labels; 'start' timing removed.
- BoardView: obj_minigame_${game} lookup removed, uses obj_${type}. New placeholder fills in assets.ts TYPE_FILL for secret/alchemy/beast/ruins/eye (trial/cliff/array/shrine fills removed; furnace kept for MiniGame).
- TileInfo: mini-game description (board.games) and rent multiplier list removed; rent ladder loops to maxLevel (Lv0–Lv3).
- TopBar: win tooltip rewritten (化神 / round cap by realm→bar→assets / bankruptcy clears bar); 灵雨 rent-halving text removed.
- PlayerCards: chip shows realm + bar (cult/bar, 可闭关); tags 灵兽引路 removed, 宝光 and 指点 added; cultTip rewritten (no thresholds / cultivationOnBuild / breakthroughCost).
- HowToPlay: pages 目标 / 修为从哪里来 / 斗法与宝光 / 闭关突破 rewritten from config; realm bar art replaces the old 修为 threshold strip; duel bet/steal-pct copy removed.
- Not yet surfaced in UI (needs Phase B): herbs on chips beyond tooltip, brew / stake / calm / market / fortunePick / manifestPick / rift node prompts rely on the generic choice menu; no art for new tile types beyond placeholders.

