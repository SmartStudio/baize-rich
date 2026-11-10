# 参与贡献

欢迎提 issue 和 PR。动手前请先读完本页，这个项目有几条和一般代码仓库不同的约定。

## 开发环境

Node.js 22.12 及以上（`.nvmrc` 和 Dockerfile 用 Node 24）。

```bash
cd baize-prototype/game
npm install
npm run dev          # http://localhost:5173
npm test             # vitest
npm run typecheck
npm run build
```

PR 提交前请确保 `npm run typecheck`、`npm test`、`npm run board`、`npm run build` 都通过，CI 会跑同样的检查。命令清单见 [`baize-prototype/game/README.md`](baize-prototype/game/README.md)。

## 项目约定

**规则和数值的来源。**
- 规则以 `baize-prototype/docs/GDD.md` 为准，数值以 `baize-prototype/data/*.json` 为准。两者冲突时以 JSON 为准，并同步修正文档。
- `game/` 只读取 `docs/` 和 `data/`，实现代码时不要顺手改它们。要改规则或数值，请单独提一个 PR 并说明理由。
- 对规则的解读、简化和发现的文档矛盾，记到 [`baize-prototype/game/NOTES.md`](baize-prototype/game/NOTES.md)。
- 数值放在 `data/config.json`，通过 `this.cfg.x.y` 读取，不要在代码里写字面量。

**架构。**
- `game/src/core/` 是纯 TypeScript 规则引擎，**不能 import Phaser**。
- 所有随机都走 `core/rng.ts`，不要用 `Math.random()`，否则对局无法重放（有确定性测试覆盖）。
- 新增一种需要玩家决定的选择，要同时加 `kind` 和 `ChoiceValueMap` 里的类型。
- 新增符箓、地块或修士的改动清单见 [`baize-prototype/game/README.md`](baize-prototype/game/README.md) 的「如何扩展」。

**平衡改动。** 改了规则或数值后，请跑 `npm run sim -- --games 500 --seed 1`，把结果和 GDD §12 的目标对比，贴在 PR 描述里。

**题材与语言。**
- 题材只用「凡人修仙」类通用元素，不使用任何具体小说的人名、地名、宗门名。
- 面向玩家的文本、战报和文档用中文。
- 不要提交 `dist/`、`node_modules/` 和 `game/screenshots/`（后者由 `npm run shots` 生成，已被忽略）。

## 提交 PR

- 一个 PR 只做一件事，描述里写清动机和验证方式。
- 修 bug 请带上能复现它的测试。
- 提交内容按 [MIT 许可证](LICENSE) 发布。

## 报告问题

- 功能问题和建议用 issue 模板。
- 对局记录（对局中按 S 下载的 JSON）能让我们完整复现一局，遇到规则或 AI 问题时请附上。
- 安全问题见 [SECURITY.md](SECURITY.md)。
