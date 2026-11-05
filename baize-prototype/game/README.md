# 白泽秘境大富翁 · 可运行原型

Phaser 3.90 + TypeScript + Vite。规则引擎与画面完全分离：同一个引擎驱动界面、AI 和无头模拟。
规则来源：`../docs/GDD.md`；所有数值来自 `../data/*.json`（只读，不在本目录内修改）。
规则解读、简化与文档/数据矛盾见 [`NOTES.md`](NOTES.md)。

## 运行

```bash
npm install
npm run dev          # 开发服务器 (http://localhost:5173)
npm run build        # tsc 类型检查 + vite 生产构建 → dist/
npm run preview      # 预览生产构建
npm test             # vitest 单元测试
npm run sim -- --games 500 --seed 1            # AI 自对弈统计（可加 --difficulty easy|normal|hard，--verbose 打印第 1 局战报，--json 输出 JSON 报告）
npm run sweep -- --param winCultivation --values 8,9,10   # 参数扫描：对 config.json 的任意数值路径，按多个种子各跑一批（可加 --seeds 1,2,3,4 --games 500 --json）
npm run replay -- 对局记录.json                 # 无头复现一份对局记录，打印胜者、轮数与各席位修为/灵石/突破（加 --log 打印完整战报）
npm run shots        # 需先 build：用 Playwright 打开构建产物、截图到 screenshots/ 并检查控制台错误
```

URL 参数：

| 参数 | 作用 |
|---|---|
| `?auto=1` | 跳过标题和选人，直接开始 4 个 AI 的对局（默认 2 倍速） |
| `?seed=123` | 固定随机种子（选人、高级设置与 auto 模式都生效） |
| `?speed=1` | 动画倍速（auto 模式默认 2，其余默认 1） |

开局流程：标题（开场文案，任意键跳过）→ 选修士（点一位作为「你」，坐 1 号位，其余三位由 AI 扮演，统一选一个难度）→ 对阵过场 → 对局。选人界面的「高级设置」进入逐席位设置（多人同屏、AI 性格、种子）。「玩法说明」是 5 页图文浮层，标题界面随时可开；第一次点「开始游戏」会自动弹出一次（`localStorage` 键 `baize.tutorialSeen`，读不到就当没看过）。

快捷键（GDD §14）：空格 掷骰 / 确认，B 升级，C 出符，Enter 结束回合，Esc 取消，F 切换倍速（1/2/4/8），L 展开 / 收起战报，S 下载对局记录；弹窗内数字键 1–9 直接选择。

### 存档与对局记录

- 对局记录（`src/core/record.ts` 的 `GameRecord`）= 开局设置 + 各席位控制方（玩家 / AI 难度与性格）+ 回答历史，外加记录格式版本和 `config.json` 的数据版本。`parseRecord()` 在读入时校验，数据版本不一致直接拒绝。
- 自动存档：每回答一次决定，`GameScene` 就把记录写入 `localStorage`（键 `baize.autosave`）；`?auto=1` 的对局不存档。刷新后标题界面会出现「继续上局」，重放历史回到刷新前的同一个待决选择，不播放动画。
- 下载：对局中按 S，或在结算界面点「下载对局记录」，得到 `baize-record-日期-seed种子.json`；用 `npm run replay -- 文件` 复盘。
- 恢复后 AI 的内部随机数从头开始（只影响简单难度之后的决定），引擎状态与回答历史不受影响。

### 美术资源

- 图集放在 `../assets/atlas.png` + `atlas.json`（Phaser JSON-Hash，1× 像素）。Vite 的 `publicDir` 指向 `../assets`，构建时原样拷贝到站点根目录。
- 图集**可选**：`vite.config.ts` 在启动 / 构建时检测文件是否存在（注入 `__HAS_ATLAS__`），不存在就不发请求；缺失的任何帧都会在 `BootScene` 中用 Canvas 生成同名占位纹理（`src/ui/assets.ts` 的 `frameSpecs()`）。放入图集后需要**重启 dev server 或重新 build**。
- `BAIZE_NO_ATLAS=1 npm run build` 可强制使用占位图，检查无图集时的表现。
- 文字目前用 Phaser `Text`（字体栈 `"Fusion Pixel 12px", "Ark Pixel 12px", "Noto Sans SC", sans-serif`，`resolution: 2`，线性过滤）。**正式版请换成位图像素字体（BitmapText）**，否则高倍缩放下会发虚、且依赖系统字体。

## 目录结构

```
src/
  core/        纯 TS 规则引擎（禁止 import Phaser）
    types.ts     JSON 数据类型 + GameState（纯 JSON，可序列化）
    data.ts      读取 ../data/*.json
    board.ts     由 board.json 构建的棋盘图：外环 R0–R31（顺时针 = 索引递增）、四条 2 格神道、ALTAR
    rules.ts     纯计算：租金、升级费、突破费、灵脉之主、总资产……（UI / AI 也用）
    engine.ts    Game 类：回合流程、移动、结算、符箓、英雄、天魔、白泽、任务、胜负
    choices.ts   决策接口：PendingChoice / Controller 类型
    events.ts    结构化事件（战报）
    rng.ts       种子随机数（状态存在 GameState.rng 里）
    record.ts    对局记录 GameRecord：生成、校验、重放
  ai/          AI 控制器（GDD §13）：难度 easy/normal/hard，性格 稳健/激进/守财；predict.ts 为移动预测
  sim/         无头驱动 headless.ts、批量模拟库 simulate.ts、命令行 run.ts、参数扫描 sweep.ts、对局记录复盘 replay.ts
  scenes/      Phaser 场景：Boot（载图集/生成占位）→ Title → HeroSelect →（Setup 高级设置）→ Versus → Game → Result
  ui/          画面组件：BoardView、TopBar（左栏顶部轮次）、PlayerCards（左栏）、LogPanel（战报）、SidePanel（右栏与回合坞）、Cutscene（过场横幅）、ChoiceModal、HowToPlay（玩法说明浮层）、session（开局配置）、saves（自动存档 / 教程标记）、assets、theme、layout
tests/         vitest：移动/岔路/灵台/地形、租金、突破、灵脉、破产、胜负、确定性回放、对局记录、选人开局
scripts/       screenshots.cjs（Playwright 冒烟测试 + 截图）
```

## 引擎与决策接口

引擎的流程用 **generator** 写成。凡是需要玩家决定的地方都写作
`const v = yield* this.ask({ player, kind, title, options })`，
引擎随即挂起，并把一个 `PendingChoice` 放到 `game.pending` 上：

```ts
const game = new Game({ seed: 1, players: [{ name: 'P1', hero: 'body' }, ...] });
game.onEvent((e) => console.log(e.text));   // 结构化战报
game.start();
while (!game.over) {
  const c = game.pending!;                   // { kind, player, title, options: [{ id, label, value, node? }], defaultId, cancelId, ctx }
  game.answer(controllers[c.player].decide(c));   // 回答一个 option id
}
```

- `PendingChoice` 是按 `kind` 区分的联合类型（`preRoll`、`action`、`fork`、`altarPass`、`exitRoad`、`buy`、`rentReact`、`guardReact`、`altar`、`divinePick`、`heavenPick`、`node`、`target`、`cliff`……），每种 kind 的 `option.value` 都有确定的类型（见 `ChoiceValueMap`）。AI 在 `switch (c.kind)` 里拿到收窄后的类型。
- 回答永远只是一个字符串 id，引擎会校验。因此 **(setup, answer 历史) 就能完整复现一局**：`Game.replay(setup, game.history)`（有测试覆盖）。`GameState` 本身是纯 JSON，可直接序列化；generator 的执行位置不可序列化，存档请用"种子 + 回答历史"重放。
- 只有一个选项的决定会自动跳过（`forceAsk` 的主阶段除外）。
- 任何人修为 ≥ 10 时引擎抛出内部 `GameOverSignal` 立刻结束流程。
- 事件：每次状态变化都 `emit` 一个 `GameEvent`（`type`、中文 `text`、`player`/`node`/`from`/`dice`/`amount`）。UI 用 `{ snapshots: true }` 让每个事件附带状态快照，逐个播放动画并按快照刷新面板；模拟时关闭快照以求速度（500 局约 2 秒）。

UI 侧（`GameScene`）就是另一个 Controller：`preRoll` / `action` 选择映射到右栏按钮、手牌点击与快捷键；其余所有选择都弹出通用 `ChoiceModal`（选项带 `node` 时弹窗靠右并让棋盘格子可点击；神通 / 天赐用卡牌样式）。AI 座位在短暂延时后由 `AIController.decide()` 自动回答。

## 如何扩展

**加一张符箓**
1. 在 `data/spells.json` 的 `cards` 里加条目（`id`、`cat`、`cost`、`timing`、`desc`）——卡面按 `cat` 选 `card_<cat>` 帧，名字与费用由代码叠加，UI 无需改动。
2. 在 `engine.ts` 实现效果：`timing: "preroll"` 加到 `castPreroll()`，`"action"` 加到 `castAction()`（需要目标时用 `askTarget()`）；反应类参考 `guard()` / `payRent()` 里的 `canPay(p, 'evade')`。
3. 在 `ai/ai.ts` 的 `preRoll()` / `action()` 里加使用条件（不加则 AI 不会主动用）。
4. 在 `tests/` 里加一条测试。

**加一种地块**
1. `data/board.json`：在 `tileTypes` 里加类型说明，并把某个 `ring` / 神道节点的 `type` 改成它；在 `types.ts` 的 `TileType` 里加上名字。
2. `engine.ts` 的 `settle()` 里加 `case`；如果"经过"也有效果，加到 `enterNode()`。
3. 美术：图集里加 `tile_<type>` 与 `obj_<type>`；占位图在 `ui/assets.ts` 的 `TYPE_FILL` 里加一行。
4. AI：在 `AIController.landingScore()` 里给它估值。

**加一名英雄**
1. `data/heroes.json` 加条目；`types.ts` 的 `HeroId` 与 `core/heroes.ts` 的 `HERO_IDS` 加 id。
2. 被动：在引擎里搜索 `p.hero ===`，在对应时机加判断（如 `enterNode()`、`buyPrice()`、`thunderTargets()`）。
3. 大招：`ultAvailable()`（何时可用、在掷骰前还是行动阶段）与 `useUlt()`（效果）各加一个分支。
4. AI：`preRoll()` / `action()` 中加估值；美术帧 `tok_<id>`、`por_<id>`，占位颜色在 `HERO_FILL`。

## 未完成 / 占位

- **交易**：首版不做；坊市只能买符。
- 音频未做；存档只有一个自动存档位（「继续上局」），没有多存档位。
- 标题界面并入设置界面。
- 更多规则层面的简化见 `NOTES.md`。
