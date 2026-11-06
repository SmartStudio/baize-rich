# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

《白泽秘境大富翁》原型资料包：像素风、东方修仙题材的大富翁式桌游。现行规则是 GDD v0.8「凡人问道」，境界是唯一主线：灵田产灵草 → 丹房炼丹 → 押丹闭关突破 → 先化神者胜。所有内容都在 `baize-prototype/` 下：

- `docs/GDD.md`：规则的唯一来源（按章节 §N 引用）。`docs/script.md` 是文案，`docs/assets.md` 是资产清单和图集帧名约定。
- `data/*.json`：全部数值与内容（`board.json` 77 格棋盘、`heroes.json` 四名修士、`spells.json` 8 种符箓、`events.json` 16 张机缘、`config.json` 境界 / 灵田等级 / 修为来源 / 突破 / 斗法 / 白泽现世等全部数值）。v0.7 及以前的天魔、悬赏令、禁制、附身灵体、功能建筑、地段连锁、医馆 / 思过崖 / 双数、地形、灵骰台和 `blessings.json` 已删除（GDD §13）。
- `assets/`：Phaser 图集 `atlas.png/json`、单帧精灵、效果图。
- `game/`：可运行原型（Phaser 3.90 + TypeScript + Vite + vitest）。

**约定**
- GDD 与 JSON 冲突时以 JSON 为准，并同步修正文档。`game/` 只读取 `docs/`、`data/`，不在实现原型时修改它们。规则解读、简化以及发现的文档/数据矛盾记录到 `game/NOTES.md`，方便策划逐条确认。
- 数值都在 `data/config.json`，按主题分块（`realms`、`landLevels`、`cultivation`、`breakthrough`、`alchemy`、`duel`、`manifest` 等），杂项放在 `rules` 块（类型 `RulesConfig`）。引擎通过 `this.cfg.x.y` 读取，不要散落成字面量。
- 题材只用「凡人修仙」类通用元素，不使用任何具体小说的人名、地名、宗门名。
- 代码里的面向玩家文本、战报和文档都用中文。

## 命令（在 `baize-prototype/game/` 下执行）

```bash
npm install
npm run dev                         # http://localhost:5173；?auto=1 直接开 4 AI 对局，?seed=123 固定种子，?speed=1 设倍速
npm test                            # vitest run（tests/**/*.test.ts，node 环境）
npx vitest run tests/movement.test.ts -t "altar"   # 跑单个文件 / 按名字过滤
npm run typecheck                   # tsc --noEmit
npm run build                       # 类型检查 + vite 构建 → dist/
npm run sim -- --games 500 --seed 1 # AI 无头自对弈平衡统计；可加 --difficulty easy|normal|hard、--verbose、--json
npm run replay -- record.json        # 复现下载的对局记录（GameRecord）并打印胜者与各席位结果；--log 打印战报、--json
npm run sweep -- --param breakthrough.pillBonus --values 1,2,3   # 参数扫描，多种子对比 §12 指标
npm run matchup -- --by difficulty  # AI 混桌胜率，按难度或性格（--by personality）
npm run board                       # 打印 ASCII 地图并检查 data/board.json
npm run shots                       # 需先 build；用 Playwright 打开 dist、截图到 screenshots/ 并检查控制台报错
BAIZE_NO_ATLAS=1 npm run build      # 强制使用占位图构建
```

`npm run shots` 使用全局预装的 `playwright`（不是项目依赖）。改了平衡相关的规则后，用 `npm run sim` / `npm run sweep` 和 GDD §12 的目标对比（平均 10–12 轮、50–70% 由化神结束、修士胜率 22–28%、座位差 < 3%、人均突破 2.5–3.5 次、每局斗法 ≥ 6、被夺丹回合 ≥ 5%、第 8 轮领先者胜 ≤ 65%），`run.ts` 直接打印这几项。结果更新到 NOTES.md。

## 架构

**规则引擎与画面完全分离。** `src/core/` 是纯 TS，**禁止 import Phaser**。同一个引擎同时驱动 Phaser UI、AI（`src/ai/`）和无头模拟（`src/sim/`）。

**用 generator 写的引擎（`core/engine.ts` 的 `Game` 类）。** 回合流程是一个 generator。凡是需要玩家决定的地方都写成 `yield* this.ask({ player, kind, title, options })`：引擎挂起，并在 `game.pending` 上放一个 `PendingChoice`。外部调用 `game.answer(optionId)` 让它继续。驱动循环见 `sim/headless.ts`。
- `PendingChoice` 是按 `kind` 区分的联合类型，`ChoiceValueMap`（`core/choices.ts`）规定每种 kind 的 `option.value` 类型。新增一种决策要同时加 kind 和类型映射。
- 只有一个选项时 `ask` 会自动跳过，除非传入 `forceAsk`。
- 回答永远是字符串 id，所以 **(setup, 回答历史) 可以完整复现一局**：`Game.replay(setup, game.history)`。所有随机都必须走 `core/rng.ts`，它的状态存放在 `GameState.rng` 中。不要用 `Math.random()`，否则重放会失效（有确定性测试覆盖）。
- `GameState` 是纯 JSON。generator 的执行位置不可序列化，存档要靠重放：`core/record.ts` 的 `GameRecord`（setup + 席位控制方 + history + 数据版本）。`GameScene` 每次回答后写入 `localStorage` 自动存档，设置界面的「继续上局」重放它；对局中按 S 或在结算界面下载记录。
- 有人突破到化神时，引擎抛出内部的 `GameOverSignal`，立即结束整个流程；否则第 12 轮结束按境界、修为条、总资产排名。
- 每次状态变化都会 `emit` 一个结构化 `GameEvent`（`core/events.ts`，带中文 `text`）。用 `{ snapshots: true }` 构造时，每个事件附带一份状态快照：UI 逐个播放动画，并按快照刷新面板。模拟时关闭快照以保证速度。

**引擎中的关键位置**：`playTurn()`（掷骰前 → 移动 → 斗法 → 结算 → 行动 → `turnEnd()` 吐纳 / 打坐 / 白泽问心）、`settle()`（落点结算，按地块类型 `case`）、`closure()`（闭关突破）、`duel()` / `plunder()`（斗法与夺宝）、`useSkill()`（修士技能）、`addCult()`（修为条，溢出记入 `stats.cultWasted`）。修士被动散落在 `p.hero ===` 的判断里。`core/rules.ts` 放租金、升级费、闭关加成、斗法加成、排名等纯计算，UI 和 AI 共用。

**棋盘（`core/board.ts`）是通用有向路网。** 当前地图是 77 格（`next[0]` 是主线，多于一个后继就是岔路，反向沿 `prev`）。11×11 网格，每条边一个灵域（木底 / 火左 / 水顶 / 土右，编号 `W0–W18` 等）：40 格外环是主线，内侧 24 格长街连成内环，每个灵域两座秘境格把内外环连起来，内山门经 1 格神道（灵泉，双向）通向中央 ALTAR（白泽灵台）。格子类型：灵田 44、山门 8、秘境 6、丹房 6、灵泉 4、坊市 4，宗门、妖兽谷、古修洞府、阵眼、灵台各 1。`npm run board` / `src/sim/boardcheck.ts` 校验地图；规则测试用 `tests/fixtures/ring-board.json`（41 格环形图，已换成 v0.8 格子类型，`ringGame()`），与正式地图解耦。
双向的神道在 `next` 里写两端并带 `road` 键。新地图必须满足的约束见 `game/NOTES.md` §10 和 README「改地图」。

**AI 和 UI 都是 Controller。** `ai/ai.ts` 的 `AIController.decide(c)` 在 `switch (c.kind)` 里处理收窄后的选择，难度和性格只调整阈值，困难难度用 `ai/predict.ts` 做一步前瞻。格子、机缘、白泽机缘、闭关成功率的估值是 `ai/evaluate.ts` 里的纯函数。`scenes/GameScene.ts` 持有棋盘和世界相机，`scenes/HudScene.ts` 是叠在上面的固定 HUD（`ui/ActionDock` 行动坞、`ui/PlayerCards` 玩家小卡、`ui/TileInfo` 点击详情）。HUD 只通过 `GameScene.toScreen(rect)` 换算棋盘坐标。`preRoll` / `action` 映射到行动坞按钮、手牌和快捷键，其余决策交给通用的 `ui/ChoiceModal`。场景顺序：Boot → Title → HeroSelect →（Setup = 高级设置）→ Versus → Game → Result。

**美术可选**：`vite.config.ts` 在启动时检查 `../assets/atlas.*` 是否存在，并注入 `__HAS_ATLAS__`。缺少的帧由 `BootScene` 按 `ui/assets.ts` 的 `frameSpecs()` 用 Canvas 生成同名占位纹理。`publicDir` 指向 `../assets`。替换图集后需要重启 dev server。画面固定 1280×720，布局常量在 `ui/layout.ts`。

**扩展**：新增符箓、地块或英雄时需要改动的位置（JSON → `types.ts` → engine → AI → 占位图 → 测试），按 `game/README.md` 的「如何扩展」逐步列出的清单操作。

## 测试写法

`tests/helpers.ts` 提供 `newGame(seed)` / `ringGame()`（4 名固定修士：体修、法修、剑修、丹师）、`script({ kind: answer })`（按 kind 回答，可以给字符串、队列或函数，未列出的 kind 取 `defaultId`）、`rngFor([d6...])`（让接下来的骰子恰好是这些点数）以及 `placeAll()`。数据要用 `cloneData()` 深拷贝后再修改，避免影响其他测试。
