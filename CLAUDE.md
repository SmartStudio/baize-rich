# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

《白泽秘境大富翁》原型资料包：像素风、东方修仙题材的大富翁式桌游。所有内容都在 `baize-prototype/` 下：

- `docs/GDD.md`：规则的唯一来源（按章节 §N 引用）。`docs/script.md` 是文案，`docs/assets.md` 是资产清单和图集帧名约定。
- `data/*.json`：全部数值与内容（棋盘 41 个节点、英雄、符箓、事件、境界/神通/天赐、全局配置）。
- `assets/`：Phaser 图集 `atlas.png/json`、单帧精灵、效果图。
- `game/`：可运行原型（Phaser 3.90 + TypeScript + Vite + vitest）。

**约定**
- GDD 与 JSON 冲突时以 JSON 为准，并同步修正文档。`game/` 只读取 `docs/`、`data/`，不在实现原型时修改它们。规则解读、简化以及发现的文档/数据矛盾记录到 `game/NOTES.md`，方便策划逐条确认。
- 只写在 GDD 正文里、JSON 中没有字段的数值，集中放在 `data/config.json` 的 `rules` 块（类型 `RulesConfig`），引擎里通过 `cfg.rules.x` 读取，不要散落成字面量。
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
npm run sim -- --games 500 --seed 1 # AI 无头自对弈平衡统计；可加 --difficulty easy|normal|hard、--verbose
npm run replay -- record.json        # 复现下载的对局记录（GameRecord）并打印胜者与各席位结果；--log 打印战报、--json
npm run sweep -- --param rules.furnacePills --values 2,3,4   # 参数扫描，多种子对比 §16 指标
npm run shots                       # 需先 build；用 Playwright 打开 dist、截图到 screenshots/ 并检查控制台报错
BAIZE_NO_ATLAS=1 npm run build      # 强制使用占位图构建
```

`npm run shots` 使用全局预装的 `playwright`（不是项目依赖）。改了平衡相关的规则后，用 `npm run sim` / `npm run sweep` 和 GDD §16 的目标对比（英雄胜率 22–28%、12–15 轮等），把结果更新到 NOTES.md。

## 架构

**规则引擎与画面完全分离。** `src/core/` 是纯 TS，**禁止 import Phaser**。同一个引擎同时驱动 Phaser UI、AI（`src/ai/`）和无头模拟（`src/sim/`）。

**用 generator 写的引擎（`core/engine.ts` 的 `Game` 类）。** 回合流程是一个 generator。凡是需要玩家决定的地方都写成 `yield* this.ask({ player, kind, title, options })`：引擎挂起，并在 `game.pending` 上放一个 `PendingChoice`。外部调用 `game.answer(optionId)` 让它继续。驱动循环见 `sim/headless.ts`。
- `PendingChoice` 是按 `kind` 区分的联合类型，`ChoiceValueMap`（`core/choices.ts`）规定每种 kind 的 `option.value` 类型。新增一种决策要同时加 kind 和类型映射。
- 只有一个选项时 `ask` 会自动跳过，除非传入 `forceAsk`。
- 回答永远是字符串 id，所以 **(setup, 回答历史) 可以完整复现一局**：`Game.replay(setup, game.history)`。所有随机都必须走 `core/rng.ts`，它的状态存放在 `GameState.rng` 中。不要用 `Math.random()`，否则重放会失效（有确定性测试覆盖）。
- `GameState` 是纯 JSON。generator 的执行位置不可序列化，存档要靠重放：`core/record.ts` 的 `GameRecord`（setup + 席位控制方 + history + 数据版本）。`GameScene` 每次回答后写入 `localStorage` 自动存档，设置界面的「继续上局」重放它；对局中按 S 或在结算界面下载记录。
- 修为达到胜利线时，引擎抛出内部的 `GameOverSignal`，立即结束整个流程。
- 每次状态变化都会 `emit` 一个结构化 `GameEvent`（`core/events.ts`，带中文 `text`）。用 `{ snapshots: true }` 构造时，每个事件附带一份状态快照：UI 逐个播放动画，并按快照刷新面板。模拟时关闭快照以保证速度。

**引擎中的关键位置**：`settle()`（落点结算，按地块类型 `case`）、`enterNode()`（经过效果）、`castPreroll()` / `castAction()`（符箓，按 `timing` 区分）、`ultAvailable()` / `useUlt()`（英雄大招）。英雄被动散落在 `p.hero ===` 的判断里。`core/rules.ts` 放租金、升级费、总资产等纯计算，UI 和 AI 共用。

**棋盘（`core/board.ts`）**：外环 R0–R31（顺时针 = 索引递增，每条边 8 格对应一个灵域：木/火/水/土），四座山门各有一条 2 格神道通向中央的 ALTAR（白泽灵台）。

**AI 和 UI 都是 Controller。** `ai/ai.ts` 的 `AIController.decide(c)` 在 `switch (c.kind)` 里处理收窄后的选择，难度和性格只调整阈值（GDD §13），困难难度用 `ai/predict.ts` 做一步前瞻。`scenes/GameScene.ts` 把 `preRoll` / `action` 映射到右栏按钮、手牌和快捷键，其余决策交给通用的 `ui/ChoiceModal`。场景顺序：Boot → Setup → Game → Result。

**美术可选**：`vite.config.ts` 在启动时检查 `../assets/atlas.*` 是否存在，并注入 `__HAS_ATLAS__`。缺少的帧由 `BootScene` 按 `ui/assets.ts` 的 `frameSpecs()` 用 Canvas 生成同名占位纹理。`publicDir` 指向 `../assets`。替换图集后需要重启 dev server。画面固定 1280×720，布局常量在 `ui/layout.ts`。

**扩展**：新增符箓、地块或英雄时需要改动的位置（JSON → `types.ts` → engine → AI → 占位图 → 测试），按 `game/README.md` 的「如何扩展」逐步列出的清单操作。

## 测试写法

`tests/helpers.ts` 提供 `newGame(seed)`（4 名固定英雄）、`script({ kind: answer })`（按 kind 回答，可以给字符串、队列或函数，未列出的 kind 取 `defaultId`），以及 `placeAll()`。数据要用 `cloneData()` 深拷贝后再修改，避免影响其他测试。
