# 「凡人问道」开发总结（2026-11-06 至 11-08）

给新加入的同事看：这一轮做了什么，为什么这样做，怎么接着做。规则仍以 `docs/GDD.md` 为准，数值以 `data/*.json` 为准，本文只记录过程和结论。文中数字都对照代码或提交记录核过，统计截至 `9db9879`。

## 1. 项目现状与如何运行

- 规则版本 v0.11（`data/config.json` 的 `version`）。Phaser 3.90 + TypeScript + Vite + Vitest，游戏在 `game/`，数据在 `data/`，出图工具在 `tools/art/`。
- 能完整打一局：选人、对战 AI、闭关突破、结算。有新手引导、音效音乐、自动存档。
- 运行方式见 `README.md` 和 `game/README.md`。常用命令：`npm run dev`（加 `?auto=1` 自动开一局 4 AI）、`npm test`、`npm run build`、`npm run sim -- --games 2000 --seed 1`。

## 2. 本轮开发做了什么

每条线在单独的 worktree 分支上开发，用 `merge --no-ff` 合进 main，合并提交的标题就是这条线的摘要。按合并顺序：coach `3a2b5ff`、own `f1d1897`、race `6af3f46`、polish `10a4c1f`、pick `6469821`、pace `9da33ec`、econ `d946897`、toll `d5c25fa`、fixes `065cd5f`、readable `89bd734`、audio `1d6a740`、art `04721b9`、juice `21620a0`、guide `1ab646c`、clear `bbb6da1`、board `237250d`、stage `dddb10f`、pace2 `102bd21`。下面按玩家能感受到的主题归类。

### 2.1 规则与数值（econ、toll、fixes、pace）

| 改动 | 为什么 | 位置 |
|---|---|---|
| 路过对手灵田付半价过路费：当前租金 × `tollRate` 0.5，向下取整（v0.11） | 只在停下时收租，地产存在感太弱 | `data/config.json`、`src/core/engine.ts`、`src/core/rules.ts` |
| 3 级福地产 2 灵草，闭关成功率 +2（`levels[3].herbs`、`closureBonus`） | 福地升级不划算，没人升到 3 级 | `data/config.json` |
| 后手补偿 `seatBonusStones` [0, 150, 300, 450]，每晚一位多 150 灵石 | 后手胜率偏低 | `data/config.json` |
| AI 按实测客流给地价估值 | 旧估值和实际收租脱节 | `src/ai/ai.ts`、`src/ai/evaluate.ts` |
| 每回合只能升级一块地；闭关要修为条满且站在闭关地点（灵台或自家灵田），丹药提高成功率 | 原规则不变，这一轮把它们讲清楚 | `src/core/rules.ts` |
| 闭关成功率只由 `closureOdds` 计算，行动栏、押丹窗口、AI 都读它（fixes 让 AI 也改读这里） | 之前界面和 AI 各算各的，数字对不上 | `src/core/closureOdds.ts` |
| 买地提示写出过路费；固定的格子提示在弹窗打开时关闭 | 试玩反馈 | `src/ui/choices/prompts.ts`、`src/ui/ChoiceModal.ts` |

验证方式：每次改数值都跑 2000 局模拟，看四名修士胜率是否都在 22–28%，后手是否追平。具体数据和平衡记录在 `game/NOTES.md` §1 和 §5。

### 2.2 可读性与引导（coach、own、race、pick、readable、guide、clear）

- **行动栏讲原因**（coach、clear）。`src/ui/dockPlan.ts` 根据局面算出这一回合能做什么。缺少某个选项时，它会说明原因，比如「本回合已升级」或者闭关要站在什么地方。它还会写明当前在等谁，AI 回合会显示进度。
- **首局引导**（coach、guide）。`Coach.ts` 和 `coachTriggers.ts` 负责首局提示。只有点气泡本身才关闭提示，过时的提示会自动收起。
- **归属一眼可见**（own）。已购的地插主人颜色的旗子，可点的格子加青色角框，被遮挡的棋子画出轮廓。规格见 `docs/assets.md` §2b。
- **境界竞赛**（race）。HUD 顶部显示境界进度和倒计时，结算页给出排名和回顾。
- **在棋盘上直接选**（pick、readable、guide）。岔路、出口、灵台过路这类选择改成在格子上标号点选。`pickPlan.ts` 负责数据，`pickLayout.ts` 负责避开 HUD 的标签位置。1 倍视角下标签可读，2 倍视角在放得下时自动框住候选格。路线标签写明终点和效果。完全相同的选项自动代答。
- **斗法与炼丹**（clear、guide）。斗法前显示胜率和赌注，炼丹要等点火后才开始。
- **结算说明**（guide）。`resultVerdict.ts` 写出输的原因，并给一条下次可以试的建议。

纠正过的判断：画面体检和试玩体检的报告里有三条经过核对后更正了。
1. 报告说「一回合只能做一件事」。实际上一回合能做多件事，只是升级每回合限一块，服丹那行消失是正常的。真正的问题是其他行消失时没有说明，clear 补上了说明。
2. 报告说闭关条件没有提示。实际上提示只在悬停时出现，行动栏里没有。clear 把它加进了行动栏。
3. 报告说 2 倍视角下棋子的头被丹炉挡住。逐帧放大后，棋子其实画在丹炉前面。看不清是因为黑头发叠在深色炉底上，所以 board 线给棋子加了浅色描边，没有改遮挡顺序。

### 2.3 节奏（pace、pace2）

- 所有停顿时长集中在 `src/ui/pacing.ts`：`PACE.watch` 用于人类回合和涉及人类的 AI 行动，`PACE.skim` 用于 AI 自己的事。另有 `AI_TURN` 控制 AI 的思考停顿，`SPEEDS` 是倍速档位。
- pace 加了快放 AI 回合，并支持取消押丹。之后的试玩反馈是 AI 走得太快，看不清。pace2 改成默认放慢：AI 的每一步、思考停顿、灵石飞行和建筑长出都看得见。骰子会翻滚，镜头跟着自己的棋子走，倍速设置会保存。
- 实测（`scripts/round-time.cjs`，1 倍速，四人一轮，在合并后的 main 上量）：

  | | 你 | 对手 1 | 对手 2 | 对手 3 | 一轮 |
  |---|---|---|---|---|---|
  | pace2 之前 | 4.6 秒 | 3.8 秒 | 2.6 秒 | 3.6 秒 | 14.6 秒 |
  | pace2 之后 | 6.1 秒 | 7.5 秒 | 6.5 秒 | 7.6 秒 | 27.8 秒 |

  juice 线自身对节奏几乎没有影响，一轮从 14.56 秒变成 14.65 秒。

### 2.4 画面与动效（polish、juice、board、stage）

- **juice**。镜头只停在整数倍缩放，像素不会糊。灵石从付款人飞向收款人（`StoneFlight.ts`），建筑升起，斗法掷骰，HUD 先于回合横幅出现，面板上浮进场，结算页淡入。
- **board**。棋子加浅色描边，建筑往格子后沿摆放，减少压住道路和棋子的情况。2 倍视角下 HUD 收成窄条（`HudFold.ts`）。
- **stage**。白泽现世改成分级的像素光，横幅移到雕像下方。突破面板缩小，成功时棋子有光环，失败时暗色闪烁（`Breakthrough.ts`、`breakthroughView.ts`、`Cutscene.ts`）。标题光晕也改成分级。
- **polish**。标题背景用正面斜俯视的棋盘，镜头移动时关闭提示框，Phaser 拆成独立的 chunk。

### 2.5 美术（art）

图集里最后 14 帧代码画的图换成了 gpt-image 生成的像素图：`baize`、6 张卡底（`card_attack/guard/move/wealth/divine/heaven`）、4 种 `decor_*`、`obj_furnace`、`ic_baize`、`ic_demon`。帧名和尺寸都没变，游戏代码不用改。卡底改用 `tools/art/src/card_frame_<cat>.png` 加 `card_art_<cat>` 插画，原来的光晕去掉了。图集现在共 103 帧。骰子、地块和行走帧这一轮没有动。

### 2.6 声音（audio）

- 不用音频文件，全部用 WebAudio 实时合成。`src/audio/cues.ts` 定义 26 个音效（古琴拨弦、钟、木鱼、锣、气声，用 D 五声音阶），每个音效有重复间隔和 AI 快放规则（`full` / `soft` / `off`）。
- `eventCues.ts` 是引擎事件到音效的唯一映射。`gate.ts` 把 AI 快放的走路合并成几声轻响，把一批过路费合并成一声。`music.ts` 逐小节生成五声音阶的背景音乐。
- 喇叭按钮可以设置音乐、音效、音量和静音，任何界面按 M 都能静音，设置存在 localStorage（`Sound.ts`、`SoundControl.ts`、`ui/saves.ts`）。

## 3. 架构要点

| 目录 | 职责 |
|---|---|
| `src/core` | 纯规则，不依赖 Phaser：`engine.ts` 推进状态并发出事件，`rules.ts`、`choices.ts`、`closureOdds.ts`、`record.ts`（存档格式） |
| `src/ai` | `ai.ts` 做决策，`evaluate.ts` 估值，`predict.ts` 预测 |
| `src/ui` | 视图和交互。大多数界面逻辑先写成纯函数的 `*Plan` / `*Readout`，再由 Phaser 组件渲染 |
| `src/scenes` | Title、Setup、HeroSelect、Versus、Game、Hud、Result 七个场景 |
| `src/audio` | 合成器、音效表、事件映射、音乐 |
| `src/sim` | 无界面自对弈：`run`、`sweep`、`matchup`、`lever`、`replay`、`board` |

只在一处计算、其他地方都来读的模块：
- `core/closureOdds.ts`：闭关成功率，行动栏、押丹窗口和 AI 共用。
- `ui/dockPlan.ts`：行动栏显示什么、为什么缺某一项。
- `ui/pickPlan.ts`：哪些选择改在棋盘上点，标签怎么写。
- `ui/pacing.ts`：所有播放停顿和倍速档位。
- `audio/eventCues.ts`：事件对应哪个音效。

这几个模块都是纯 TS，有 vitest 覆盖（`tests/` 下 31 个文件）。改界面行为时先改它们，再改渲染。

## 4. 开发与验证流程

每条线：
1. `git worktree add -b <line> ../baize-<line> main`，再把 `game/node_modules` 软链过去。改动文件不重叠的线可以并行。
2. 改完跑 `npx tsc --noEmit`、`npx vitest run`、`npm run build`。
3. 改了规则、数值或 AI 就跑 `npm run sim -- --games 2000 --seed 1`，和改动前对比。500 局有大约 2 个百分点的噪声。调单个参数用 `npm run lever`。
4. 截图：`npm run build` 后运行 `PORT=4179 NODE_PATH=/tmp/pw/node_modules node scripts/screenshots.cjs`（约 2 分钟，写到 `game/screenshots/*.png`）。几个 worktree 同时跑时要换不同的 PORT。
5. 涉及节奏的改动：`PORT=4197 node scripts/round-time.cjs` 测一轮的耗时。
6. 鼠标试玩：用浏览器真实点完一局关键路径（掷骰、买地、升级、闭关、斗法、结算），确认没有控制台报错。
7. 合并：`git merge --no-ff <line>`，标题写 `merge: <line> (摘要)`。截图 PNG 冲突不要手工挑，合并后重新生成，单独提交 `chore(screenshots): regenerate after <line> merge`。
8. 推送前在合并后的 main 上再做一次浏览器检查。推送后删掉 worktree，确认没有遗留的 dev server。

## 5. 美术出图流程

1. 在 `tools/art/manifest.json` 写条目：`id`、提示词、帧尺寸 `size`、`fit` 模式。
2. 用 Codex 的内置图像工具出原图，每次一张，大约 60 秒，可以并行：
   ```bash
   codex exec --skip-git-repo-check -s workspace-write \
     "Use your image generation tool (gpt-image) to create exactly one image, then copy the resulting PNG to <绝对路径> and print its absolute path and pixel size. <提示词>"
   ```
   原图存为 `tools/art/src/<id>.jpg|png`。图像模型的版本由 Codex 决定，不能指定。
3. `python3 tools/art/pixelize.py <id>` 抠色、缩放、量化。`fit` 有这几种：`w` / `h` 按宽或高缩放，`frame` 用于头像，`box` 缩进固定尺寸并底部居中（替换旧帧时用它，帧尺寸不变），`quad` 做四边形映射，`tile` 用于无缝纹理。
4. `python3 tools/art/pack.py` 重建 `assets/atlas.png` 和 `atlas.json`。
5. 逐张查看：糊的、带字的、画风不搭的重新出图。16 像素图标看不清时保留旧版本。

## 6. 已知问题与待决事项

- 右侧栏里的格子不显示选择标签，因为会和 HUD 重叠。目前只靠角框提示。
- 3 级建筑在 1 倍视角下仍可能挡住后排棋子，目前靠遮挡描边兜底。
- pace2 之后 AI 的脚步声变密了，走 9 步响 5 声，以前是 3 声。如果嫌吵可以调稀。
- 卡底原来的光晕已去掉，需要确认是否要换一种做法加回来。
- 斗法命中音偏响，需要试听后定。
- 普通按钮没有点击音，只有确认和取消有声音。
- 有意保留、这一轮没改的取舍：洞府升级费系数 1.05，秘境和灵泉都用青色，站在灵台上要选两次。
- 最常弹出的窗口是斗法、买地和押丹。它们都需要玩家真正做决定，所以留在弹窗里。

## 7. 下一步建议

1. 先把第 6 节的音量和密度问题过一遍试听，这几项改动小，效果直接。
2. 解决右侧栏的选择标签和后排遮挡，这两项最影响新手看懂棋盘。
3. 行走动画、施法动画、白泽动画按 `docs/assets.md` §3 交给画师。
4. 继续用 2000 局模拟盯住体修胜率（目前在 22% 的下限附近），见 `game/NOTES.md`。
