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
npm run lever -- --games 2000 --seed 1          # 灵田杠杆：一个座位从不买地 / 最多升到某一级时的胜率（公平值 25%）
npm run replay -- 对局记录.json                 # 无头复现一份对局记录，打印胜者、轮数与各席位修为/灵石/突破（加 --log 打印完整战报）
npm run board        # 打印 ASCII 地图并检查 data/board.json（有问题时退出码 1）
npm run shots        # 需先 build：用 Playwright 打开构建产物、截图到 screenshots/ 并检查控制台错误
```

URL 参数：

| 参数 | 作用 |
|---|---|
| `?auto=1` | 跳过标题和选人，直接开始 4 个 AI 的对局（默认 2 倍速） |
| `?seed=123` | 固定随机种子（选人、高级设置与 auto 模式都生效） |
| `?speed=1` | 动画倍速（auto 模式默认 2，其余默认 1） |
| `?preview=minigame` | 开发用预览：试玩炼丹房 / 灵骰台浮层（亲手与观战），并列出 v0.6 新增的占位美术 |

开局流程：标题（开场文案，任意键跳过）→ 选修士（点一位作为「你」，坐 1 号位，其余三位由 AI 扮演，统一选一个难度）→ 对阵过场 → 对局。选人界面的「高级设置」进入逐席位设置（多人同屏、AI 性格、种子）。「玩法说明」是 7 页图文浮层，标题界面随时可开；第一次点「开始游戏」会自动弹出一次（`localStorage` 键 `baize.tutorialSeen`，读不到就当没看过）。

快捷键（GDD §14）：空格 掷骰 / 确认，B 升级，C 出符（含大招、技能、布禁制），K 发动技能，Enter 结束回合，Esc 取消，F 切换倍速（0.5/1/2/4），L 展开 / 收起战报，S 下载对局记录，H（或 Home）回到棋子；弹窗内数字键 1–9 直接选择。

棋盘镜头：拖动棋盘平移，滚轮 / 双指捏合缩放。镜头平时跟着行动中的棋子走；手动拖动或缩放后暂停跟随，直到下一回合开始、掷骰或按「回到棋子 · H」。需要点格子的选择（岔路、出灵台、传送和技能目标）会自动把所有可选格框进画面。「回到棋子 · H」按钮只在放大到 2 倍时出现，在右上角化神之路下面。

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
    board.ts     由 board.json 构建的有向路网：沿 next 前进（多个即岔路）、反向边 prev、双向神道、路网距离
    rules.ts     纯计算：租金、升级费、突破费、灵脉之主、总资产……（UI / AI 也用）
    engine.ts    Game 类：回合流程、移动、结算、符箓、英雄、天魔、白泽、任务、胜负
    choices.ts   决策接口：PendingChoice / Controller 类型
    events.ts    结构化事件（战报）
    rng.ts       种子随机数（状态存在 GameState.rng 里）
    record.ts    对局记录 GameRecord：生成、校验、重放
  ai/          AI 控制器（GDD §13）：难度 easy/normal/hard，性格 稳健/激进/守财；predict.ts 为移动预测
  sim/         无头驱动 headless.ts、批量模拟库 simulate.ts、命令行 run.ts、参数扫描 sweep.ts、对局记录复盘 replay.ts、地图检查 boardcheck.ts / board.ts（`npm run board`）
  scenes/      Phaser 场景：Boot（载图集/生成占位）→ Title → HeroSelect →（Setup 高级设置）→ Versus → Game → Result；Hud 是叠在 Game 上的屏幕层，放全部面板
  ui/          画面组件：world（棋盘世界坐标与镜头数学，不依赖 Phaser，有单测）、Ground（按 board.json 生成的地面、道路与方向箭头、装饰）、BoardView（格子、棋子、建筑与功能建筑、灵体与附身光环、整街描边、路障 / 爆炎阵标记、白泽现世光效）、Spirits（灵狐 / 心魔造型与附身光环）、MiniGame（炼丹房 / 灵骰台浮层）、BoardCamera（跟随 / 框选 / 拖动缩放）、RealmRace（右上化神之路：各人境界与修为、谁领先、胜负规则）、TopBar（左上轮次）、PlayerCards（左侧玩家小卡）、LogPanel（战报）、ActionDock（右下行动坞与手牌）、Tooltip（共用提示框）、TileInfo（地块提示）、Cutscene（过场横幅）、ChoiceModal、HowToPlay（玩法说明浮层）、session（开局配置）、saves（自动存档 / 教程标记）、assets、theme、layout
tests/         vitest：移动/岔路/灵台/地形、租金、突破、灵脉、破产、胜负、确定性回放、对局记录、选人开局、棋盘世界坐标与镜头夹取
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

UI 侧（`GameScene`）就是另一个 Controller：`preRoll` / `action` 选择映射到右栏按钮、手牌点击与快捷键；真人的 `miniGame` 打开小游戏浮层（灵骰台的点数来自引擎，浮层只负责开盅），AI 的小游戏以观战方式回放；其余所有选择都弹出通用 `ChoiceModal`（选项带 `node` 时弹窗靠右并让棋盘格子可点击，一格对应多个选项时（如升级和三种改建）点它会把弹窗收窄到这一格；神通 / 天赐用卡牌样式）。AI 座位在短暂延时后由 `AIController.decide()` 自动回答。

## 如何扩展

**加一张符箓**
1. 在 `data/spells.json` 的 `cards` 里加条目（`id`、`cat`、`cost`、`timing`、`desc`）——卡面按 `cat` 选 `card_<cat>` 帧，名字与费用由代码叠加，UI 无需改动。
2. 在 `engine.ts` 实现效果：`timing: "preroll"` 加到 `castPreroll()`，`"action"` 加到 `castAction()`（需要目标时用 `askTarget()`）；反应类参考 `guard()` / `payRent()` 里的 `canPay(p, 'evade')`。
3. 在 `ai/ai.ts` 的 `preRoll()` / `action()` 里加使用条件（不加则 AI 不会主动用）。
4. 在 `tests/` 里加一条测试。

**加一件百宝阁道具**（GDD §18.3）
1. `data/spells.json` 加条目，带 `price`（百宝阁售价）和 `shopOnly: true`（不进牌堆、用后不进弃牌堆）。牌堆里的符箓只加 `price` 也会在百宝阁出售。
2. 效果同上加到 `castPreroll()` / `castAction()`；需要选格子时用 `askTarget()` 的 `node` 目标。
3. AI：`ai.ts` 的 `SHOP_VALUE` 给它估价，再在 `preRoll()` / `action()` 里加使用条件。

**加一种功能建筑或小游戏**（GDD §18.4、§18.5）
1. 功能建筑：`board.json` 的 `specials` 加名字和说明，`types.ts` 的 `SpecialKind` 加 id，引擎的 `specialOptions()` 返回它，效果写进 `settle()`（他人停留 / 自己停留）或 `roundStart()`；AI 在 `bestSpecial()` 里估值。
2. 小游戏：`board.json` 的 `games` 加条目，格子写 `type: "minigame"` 和 `game`；奖励放 `config.rules.miniGameRewards`。结果档位必须作为 `miniGame` 选择问出来（真人由画面决定，AI 用自己的随机数），这样重放才确定。

**加一种地块**
1. `data/board.json`：在 `tileTypes` 里加类型说明，并把 `nodes` 里某个节点的 `type` 改成它；在 `types.ts` 的 `TileType` 里加上名字。
2. `engine.ts` 的 `settle()` 里加 `case`；如果"经过"也有效果，加到 `enterNode()`。
3. 美术：图集里加 `tile_<type>` 与 `obj_<type>`；占位图在 `ui/assets.ts` 的 `TYPE_FILL` 里加一行。
4. AI：在 `AIController.landingScore()` 里给它估值。

**改地图**
1. `data/board.json` 的 `nodes`：每格写 `id`、`type`、`pos`、`next`（前进方向的后继格，多于一个是岔路，`next[0]` 是主线）。灵田加 `region`、`name`、`price`、`street`（街道写在顶层 `streets`）；路网格（神道和灵台以外）标 `outer: true`；神道格标 `road`，并把内外两个邻格都写进 `next`。
2. 必须有一个 `start`、一个 `cliff`，以及 id 为 `ALTAR` 的灵台。需要提供的字段和各条规则的对应关系见 `../docs/board-design.md`。
3. `npm run board` 打印 ASCII 地图并检查：坐标不重叠、边是直线、没有死路、每格都能走到也能回到起点、每个灵域有 ≥2 个岔路和灵泉 / 丹炉 / 历练碑 / 坊市或百宝阁、3 条 3–5 块灵田的街道。`tests/board.test.ts` 在 `npm test` 里跑同一套检查（`src/sim/boardcheck.ts`）。
4. 规则测试用 `tests/fixtures/ring-board.json`（原 41 格环形地图，`helpers.ts` 的 `ringGame()`），换地图不会影响它们。新地图的走法可以参考 `tests/graph.test.ts` 加测试。
5. 画面不用改：`grid` 决定世界大小（每格 80 世界像素），格子按 `pos` 摆放，灵台按 `rect` 占格；道路沿 `next` 画，只写了单向的边带箭头；地面颜色取最近的带 `region` 的格子。地图比屏幕大时镜头会自动滚动。

**加一名英雄**
1. `data/heroes.json` 加条目；`types.ts` 的 `HeroId` 与 `core/heroes.ts` 的 `HERO_IDS` 加 id。
2. 被动：在引擎里搜索 `p.hero ===`，在对应时机加判断（如 `enterNode()`、`buyPrice()`、`thunderTargets()`）。
3. 大招：`ultAvailable()`（何时可用、在掷骰前还是行动阶段）与 `useUlt()`（效果）各加一个分支。
4. AI：`preRoll()` / `action()` 中加估值；美术帧 `tok_<id>`、`por_<id>`，占位颜色在 `HERO_FILL`。
5. 主动技能：`heroes.json` 的 `skill`（`id`、`name`、`timing`、`desc`），`types.ts` 的 `HeroSkillId` 加 id；引擎里 `skillTargets()`（可选目标）和 `useSkill()`（效果）各加一个分支，数值放 `config.rules`；AI 在 `ai.ts` 的技能估值里加一个分支。

## 未完成 / 占位

- **交易**：首版不做；坊市只能买符。
- 音频未做；存档只有一个自动存档位（「继续上局」），没有多存档位。
- 标题界面并入设置界面。
- 更多规则层面的简化见 `NOTES.md`。
