# 维护者手册

本文写给维护者，讲一件事。一个改动怎样从 issue 走到线上的 https://rich.fxai.ai。它覆盖仓库设置、开发流程、镜像构建、发布到 GHCR、Dokploy 部署、提 issue 与分流，以及 issue 自动修复。

只想玩游戏或提交 PR 的话，读 [README](../README.md) 和 [CONTRIBUTING](../CONTRIBUTING.md) 就够了。

## 先看哪些已经在运行

| 环节 | 状态 | 依据 |
|---|---|---|
| PR 与 main 的 CI | 已运行 | `ci.yml` 在 `f92ab05` 上通过 |
| 构建并推送镜像到 GHCR | 已运行 | 用 `workflow_dispatch` 手动触发过，三个标签指向同一个 digest |
| 部署到 Dokploy 并校验线上版本 | 已运行 | 手动触发过，线上 `/version.json` 与发布版本一致 |
| 发布 GitHub Release 自动触发上面两步 | 未实测 | 仓库还没有任何 Release 或 tag，只测过手动触发 |
| issue 自动修复 | 仅设计，未启用 | 见「issue 自动修复」，仓库里没有对应工作流 |

下文凡是标了「建议」的内容，都是还没生效的设计。

## 仓库一览

| 项目 | 值 |
|---|---|
| 公开仓库 | `SmartStudio/baize-rich`，默认分支 `main` |
| 归档仓库 | `SmartStudio/baize-rich-archive`，私有，只读，保留清理前的完整历史 |
| 镜像 | `ghcr.io/joesmart/baize-rich`，私有包，平台 `linux/amd64` |
| 线上地址 | https://rich.fxai.ai |
| 合并方式 | merge、squash、rebase 三种都开着 |
| Issue | 开启。Discussions 未开启 |
| 私密漏洞报告 | 开启，见 [SECURITY.md](../SECURITY.md) |

仓库变量（Settings → Secrets and variables → Actions → Variables）。

| 名称 | 当前值 | 作用 |
|---|---|---|
| `GHCR_NAMESPACE` | `joesmart` | 镜像命名空间。为空时发布任务整体跳过 |
| `DEPLOY_URL` | `https://rich.fxai.ai/` | 部署后校验 `/version.json`。为空时不部署 |

仓库密钥（Secrets）。

| 名称 | 内容 | 最小权限 |
|---|---|---|
| `GHCR_PUSH_TOKEN` | `joesmart` 账号的 classic PAT | 只勾 `write:packages` |
| `DOKPLOY_DEPLOY_WEBHOOK` | 仅限 `baize-rich` 应用的 Dokploy 部署 Webhook URL | 不要用账号管理员 API Key |

用 `! gh secret set <名称>` 写入，值不会进入对话或日志。不要把令牌或 Webhook URL 写进代码、日志、Release 说明或 issue。

### 提交身份

提交使用 GitHub 的 noreply 邮箱，真实邮箱不进历史。仓库内已设置本地 `user.email`。换机器后重新执行一次。

```bash
git config user.email "418816+joesmart@users.noreply.github.com"
```

### 建议的仓库设置

下面三项我用 `gh api` 读到了当前值，改动还没做。

- `main` 没有分支保护（读取返回 404）。建议要求 `check` 和 `docker` 两个 CI 任务通过后才能合并，并禁止直接推送。
- Actions 的默认令牌权限是 `write`。两个工作流都显式声明了 `permissions`，所以现在没有实际风险。建议改成只读，让新增工作流必须自己申请权限。
- 建议只保留 squash 合并，并开启「合并后删除分支」。一个 PR 对应 `main` 上的一个提交，回滚时只需 revert 一次。

## 开发流程

流程分四步。改动、本地检查、PR、合并。

### 1. 开分支

从最新的 `main` 开分支，一个分支只做一件事。分支名用 `fix/`、`feat/`、`docs/`、`chore/` 加短横线描述，例如 `fix/closure-odds-display`。

并行做多件事时用 git worktree，每个分支一个目录，并把 `game/node_modules` 软链过去，避免重复安装。

```bash
git worktree add -b fix/closure-odds-display ../baize-fix-closure main
```

### 2. 改动与约定

下面几条会让 PR 被打回，先记住。完整清单在 [CONTRIBUTING.md](../CONTRIBUTING.md) 和根目录 `CLAUDE.md`。

- 规则以 [GDD](GDD.md) 为准，数值以 `data/*.json` 为准，两者冲突时 JSON 优先，并同步修正文档。
- 实现代码时不改 `docs/` 和 `data/`。要改规则或数值，单独开一个 PR 并写明理由。
- `game/src/core/` 不能 import Phaser，随机数只走 `core/rng.ts`，不用 `Math.random()`。
- 数值放进 `data/config.json`，通过 `this.cfg.x.y` 读取，不在代码里写字面量。
- 题材只用通用的凡人修仙元素，不出现具体小说的人名、地名、宗门名。面向玩家的文本和文档用中文。
- 修 bug 先写一个能复现它的失败测试，再改代码。

### 3. 本地检查

在 `game/` 目录运行。这五条与 CI 完全一致，本地通过就能过 CI。

```bash
npm run typecheck
npm test
npm run board
npm run build
npm run sim -- --games 50 --seed 1
```

改了规则、数值或 AI 时，再跑一次大样本，并把结果与 GDD §12 的目标对比，贴进 PR 描述。500 局的结果大约有 2 个百分点的噪声，要看单个参数的影响时用 `npm run sweep` 或 `npm run lever`。

```bash
npm run sim -- --games 2000 --seed 1
```

改了界面时，用浏览器真实点一遍关键路径（掷骰、买地、升级、闭关、斗法、结算），确认控制台没有报错。`npm run shots` 可以辅助截图，截图写到 `game/screenshots/`，该目录已被忽略，不要提交。

### 4. 提 PR 与合并

1. 提交信息用英文前缀加一句话，沿用仓库现有写法，例如 `fix: ...`、`docs: ...`、`ci: ...`、`refactor: ...`。
2. 推送分支，用 `gh pr create` 或网页开 PR。PR 模板里的检查项要逐条勾选。
3. 等 CI 的 `check` 和 `docker` 都变绿。
4. 维护者 squash 合并。
5. 合并后更新 [CHANGELOG](../CHANGELOG.md) 的「未发布」段。可以在 PR 里一起改，也可以发布前统一补。

`docs/dev-summary.md` 第 4 节描述的是 v0.11 开发期的 worktree、`merge --no-ff` 和截图提交流程。截图已经不再入库，现行流程以本节为准。

## CI

`.github/workflows/ci.yml` 在每个 PR 和每次推送到 `main` 时运行，分两个任务。

| 任务 | 做什么 | 超时 |
|---|---|---|
| `check` | 在 `game/` 下 `npm ci`、`typecheck`、`test`、`board`、`build`，再跑 50 局 `sim`（种子 1） | 15 分钟 |
| `docker` | 用仓库根目录的 Dockerfile 构建镜像，不推送 | 15 分钟 |

Node 版本读 `game/.nvmrc`（当前是 24）。第一次提交曾把路径写成根目录的 `.nvmrc` 而失败，修正后通过。第三方 Action 都固定到提交 SHA，升级时同时更新注释里的版本号。

## 构建镜像

Dockerfile 分两阶段。

1. 构建阶段基于 `node:24-alpine`，复制 `game/`、`data/`、`assets/`，执行 `npm test && npm run build`。测试失败会让镜像构建失败。构建结束时写入 `dist/version.json`，内容是 `{"version": ..., "revision": ...}`。
2. 运行阶段基于 `nginx:stable-alpine`，托管 `dist/`。`deploy/nginx.conf` 提供 `/healthz`。两个基础镜像都固定了 digest。

本地构建与验证。

```bash
docker build --platform linux/amd64 --build-arg APP_VERSION=local --build-arg VCS_REF=local -t baize-rich:local .
docker run --rm -p 127.0.0.1:8080:80 baize-rich:local
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/version.json
```

## 发布与部署

发布由 `.github/workflows/release.yml`（名称 Release image and deploy）完成，分 `publish` 和 `deploy` 两个任务。

### 触发方式

| 方式 | 版本号 | 是否部署 |
|---|---|---|
| 发布正式 Release（非 pre-release） | Release 的 tag | 是 |
| 手动运行，在 `main` 上 | 输入的 `version`，留空则用 `bootstrap-<提交前 12 位>` | 看 `deploy` 开关，默认关 |

草稿和 pre-release 不触发。版本号必须是合法的 Docker 标签，且不能是 `latest`。

### 发布一个版本

1. 确认 `main` 的最新提交 CI 为绿。
2. 把 CHANGELOG 的「未发布」改成版本号和日期。需要时同步 `game/package.json` 的 `version`。
3. 创建并发布 Release。

```bash
gh release create v0.4.0 --target main --title "v0.4.0" --generate-notes
```

4. 在 Actions 页面看 **Release image and deploy**。两个任务都绿，才算发布完成。
5. 打开 https://rich.fxai.ai/version.json，确认 `version` 是刚发布的 tag。

如果只想推镜像、先不上线，用手动触发并保持 `deploy` 关闭。

```bash
gh workflow run "Release image and deploy" --ref main -f version=v0.4.0 -f deploy=false
```

### `publish` 做了什么

1. 检查 `GHCR_PUSH_TOKEN` 存在。
2. 构建 `linux/amd64` 镜像并加载到本机，不先推送。
3. 在本机启动镜像，校验 `/healthz`、`/version.json` 的 `revision`、`atlas.json`、`atlas.png` 和首页 HTML。
4. 登录 GHCR，先推送 `<version>` 和 `sha-<完整提交>` 两个标签。
5. 确认包仍是私有，再推送 `latest`。包被改成公开时，这一步失败，`latest` 不会更新。

### `deploy` 做了什么

1. 向 `DOKPLOY_DEPLOY_WEBHOOK` 发一个 POST。
2. 每 3 秒轮询一次 `${DEPLOY_URL}/version.json`，最多 90 次，直到 `revision` 和 `version` 都与本次发布一致。
3. 超时则任务失败，线上状态以 Dokploy 控制台为准。

同一时间只会有一个发布在跑（`concurrency` 组 `baize-rich-production`，不取消进行中的任务）。

### Dokploy 应用设置

| 位置 | 值 |
|---|---|
| 应用名 | `baize-rich` |
| General → Source | Docker |
| Docker Image | `ghcr.io/joesmart/baize-rich:latest` |
| Registry URL / Username | `ghcr.io` / `joesmart` |
| Registry Password | 具备 `read:packages` 的拉取令牌，与推送令牌分开 |
| Auto Deploy | 开启，其 Webhook 即 `DOKPLOY_DEPLOY_WEBHOOK` |
| 域名 | `rich.fxai.ai`，映射容器端口 80 |

镜像保持私有，不要为方便拉取而公开包。

### 回滚

1. 在 Dokploy 把 Docker Image 改成某个已发布的版本标签，例如 `ghcr.io/joesmart/baize-rich:v0.3.0`，或固定到 `@sha256:<digest>`。
2. 点 Deploy。
3. 打开 `/version.json` 确认版本。
4. 问题修好后改回 `:latest`，否则之后的自动发布不会生效。

### 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `publish` 在第一步失败 | `GHCR_PUSH_TOKEN` 没设置或过期 | 重新 `gh secret set GHCR_PUSH_TOKEN` |
| `deploy` 失败，提示配置 Webhook | `DOKPLOY_DEPLOY_WEBHOOK` 缺失 | 在 Dokploy 复制该应用的 Webhook，重新写入密钥 |
| 推送后提示包必须保持私有 | 包被改成公开 | 到包设置改回私有，重跑 |
| `deploy` 轮询超时 | Dokploy 没拉到新镜像，或域名指向了别的容器 | 看 Dokploy 部署日志，核对镜像标签和域名端口 |
| CI 在 setup-node 步骤失败 | `.nvmrc` 路径不对 | 路径应为 `game/.nvmrc` |
| 发布任务整体被跳过 | `GHCR_NAMESPACE` 为空，例如在 fork 里 | 预期行为，不用处理 |

## 提 issue 与分流

### 提 issue

仓库有两个模板，空白 issue 也允许。

| 模板 | 标签 | 要填的内容 |
|---|---|---|
| 问题报告 | `bug` | 发生了什么、预期、复现步骤、浏览器、种子或对局记录、规则版本 |
| 建议 | `enhancement` | 想解决的问题、建议做法、对「境界」主线的影响 |

规则或 AI 的问题，请提交人附上对局记录。对局中按 S，或在结算界面下载 JSON，就是完整的 `GameRecord`。维护者用它可以逐步重放整局。

```bash
cd game
npm run replay -- record.json --log
```

安全问题不走 issue，走私密漏洞报告。

### 分流

新 issue 按下表处理。现有标签是 GitHub 默认的九个，下表的前几行直接可用。

| 判断 | 动作 |
|---|---|
| 信息不全，无法复现 | 加 `question`，评论里要对局记录或种子 |
| 是重复 issue | 加 `duplicate` 并关闭，指向原 issue |
| 确认是 bug，改动小 | 加 `bug`，有空时可加 `good first issue` |
| 涉及规则、数值或平衡 | 加 `enhancement`，由维护者在 GDD 上决策，不交给自动修复 |
| 不打算做 | 加 `wontfix` 并写明原因 |

## issue 自动修复

这一节是设计，未启用。仓库里还没有这个工作流，也没有对应密钥。

### 目标

维护者读完一个 bug issue，确认它值得修，给它加一个标签。几分钟后，仓库里出现一个修复分支，带复现测试，等维护者审查。

### 为什么用标签触发

我不建议在 issue 创建时自动触发，理由有三个。

- 公开仓库里任何人都能开 issue，issue 正文是不受信任的输入，可以直接拿来写提示注入。让维护者先读一遍再加标签，等于加了一道人工闸门。
- 每次运行都花 API 费用。很多 issue 是信息不全或属于规则争议，自动跑只会浪费。
- 规则和数值的改动需要 `npm run sim` 对照 GDD §12，并由策划拍板。这类 issue 不应该交给自动修复。

### 流程

1. 贡献者按模板提 issue。
2. 维护者读 issue，判断它是可复现的、范围小的 bug，不涉及规则与数值。
3. 维护者加标签 `ai-fix`。
4. GitHub 触发 `issues: labeled` 事件，工作流开始运行。
5. Claude 读 issue 和 `CLAUDE.md`，先写一个失败的复现测试，再改代码，跑本地检查，最后推送到 `claude/` 开头的新分支，并在 issue 里评论结果和预填的 PR 链接。
6. 维护者审查分支，点链接开 PR。CI 在这个 PR 上正常运行。
7. 维护者按「开发流程」的第 4 步合并。

分支只能由 Claude 推送新分支，不能推送 `main`。合并永远是人做。

### 为什么由人点开 PR

Action 的文档说，在 issue 上触发时，它总是新建分支，并"链接到预填的 PR 创建页面"，不直接开 PR（来自 `anthropics/claude-code-action` 的 `docs/capabilities-and-limitations.md`，本次已读）。

我推断这是好事。GitHub 规定，用内置 `GITHUB_TOKEN` 产生的事件不会再触发其他工作流。如果机器人自己开 PR，CI 很可能不会运行。由人点链接开 PR，CI 就是正常触发的。这一点是我对 GitHub 行为的推断，没有在本仓库实测。

### 安全模型

以下几条来自 Action 的 `docs/security.md`，本次已读。

- Action 只允许对仓库有写权限的用户触发，检查对象是触发事件的人，在这里就是加标签的人（后半句是我的推断）。外部贡献者开的 issue 不会自己启动它。
- 默认不允许机器人触发。不要设置 `allowed_bots`，也不要设置 `allowed_non_write_users`。后者会绕过写权限检查，文档称其为高风险。
- 工作流只引用一个密钥，也就是 Anthropic 的凭据。`GHCR_PUSH_TOKEN` 和 `DOKPLOY_DEPLOY_WEBHOOK` 不出现在这个工作流里，所以不会进入运行环境。GitHub 只会把工作流引用到的密钥注入任务。这是我对 GitHub 机制的推断。
- 用 `--allowedTools` 把 Claude 能运行的命令限制在读写文件和 `npm --prefix game ...` 之内。
- 即便如此，issue 正文里的指令仍可能影响 Claude 的行为。所以审查分支和合并必须由人做，下面的分支保护是这套设计的前提。

### 前置条件

1. 给 `main` 开分支保护，要求 `check` 和 `docker` 通过，禁止直接推送。没有它，这套设计里"Claude 不能改 `main`"只靠工作流的约束。
2. 创建标签 `ai-fix`。
3. 按 Action 的 `docs/setup.md` 安装 Claude GitHub App，并配置 Anthropic 凭据。本次我没有逐步走过这份安装流程，第一次接入时以它为准。
4. 用 `! gh secret set ANTHROPIC_API_KEY` 写入密钥。如果用 OAuth 令牌，则改传 `claude_code_oauth_token`。

### 工作流草案

写入 `.github/workflows/issue-fix.yml`。这份草案没有运行过。

版本固定到 `v1.0.271`。该 tag 对应提交 `4fa93a88de49bbef68b10eb15aabedf28ca0e1ed`，我用 `gh api repos/anthropics/claude-code-action/tags` 读到。启用时再查一次最新版本。

```yaml
name: Issue auto-fix

on:
  issues:
    types: [labeled]

permissions:
  contents: read

concurrency:
  group: issue-fix-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  fix:
    if: github.event.label.name == 'ai-fix'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
      issues: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-depth: 1
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version-file: game/.nvmrc
          cache: npm
          cache-dependency-path: game/package-lock.json
      - run: npm --prefix game ci --no-audit --no-fund
      - uses: anthropics/claude-code-action@4fa93a88de49bbef68b10eb15aabedf28ca0e1ed # v1.0.271
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          label_trigger: ai-fix
          branch_prefix: claude/
          prompt: |
            REPO: ${{ github.repository }}
            ISSUE: ${{ github.event.issue.number }}

            Fix the issue above. Follow CLAUDE.md in the repository root.
            1. Write a failing test that reproduces the bug before changing code.
            2. Make the smallest change that fixes it. Do not edit docs/ or data/.
            3. Run these from the repository root and fix every failure:
               npm --prefix game run typecheck
               npm --prefix game test
               npm --prefix game run board
               npm --prefix game run build
            4. If the issue needs a rule or balance change, stop and explain why in a comment.
            5. Commit to the new branch. Never push to main.
            6. Comment on the issue with what changed and which tests cover it.
          claude_args: |
            --max-turns 40
            --allowedTools "Read,Edit,Write,Glob,Grep,Bash(npm --prefix game:*),Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git diff:*)"
```

`if` 已经按标签过滤了任务。`label_trigger` 让 Action 内部再按同一个标签判断一次，两处标签名要保持一致。

### 启用步骤

1. 先满足「前置条件」。
2. 把工作流文件放进一个 PR，让 CI 和维护者先审查。
3. 开一个专门的测试 issue，故意写一个小而明确的 bug，例如某个提示文案错字。加 `ai-fix`。
4. 检查三件事。分支名以 `claude/` 开头。issue 里有评论和 PR 链接。分支上有复现测试，且 CI 在人开的 PR 上运行。
5. 三件事都成立，再对真实 issue 使用。

### 已知限制

- 它只适合范围小、能用测试复现的 bug。UI 动画、美术、手感类问题没有自动化测试可依赖，不要用它。
- 复现依赖 issue 里的信息。有对局记录的 issue 成功率应当更高，这是推断，没有数据。
- 每次运行都有 API 费用，上限靠 `--max-turns` 和 `timeout-minutes` 控制。启用后观察几次实际花费，再决定是否放宽。
- 这个工作流不会部署。修复合并到 `main` 后，要上线仍走「发布与部署」。

## 已知遗留项

| 项目 | 状态 | 建议 |
|---|---|---|
| 归档仓库 `baize-rich-archive` 里仍有清理前的历史 | 私有且已归档 | 确认其中没有未轮换的凭据；有的话先轮换，再考虑删除 |
| `docker/*` 相关 Action 的 Node 20 弃用警告 | 构建日志里可见 | 升级到支持 Node 24 的版本并重新固定 SHA |
| 第一次 Release 触发路径未实测 | 只测过手动触发 | 发第一个正式版时，全程盯着 Actions 页面 |
| Discussions | 未开启 | 提问类内容变多后再决定 |
| `docs/dev-summary.md` 第 4 节的流程已过时 | 已在「开发流程」里注明 | 下次整理该文档时改写或删除 |
