# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。规则版本见 `baize-prototype/docs/GDD.md`。

## [未发布]

### 新增
- MIT 许可证、根目录 README、贡献指南、行为准则、安全策略、issue 与 PR 模板。
- `ci.yml`：每个 PR 和 `main` 的 push 运行类型检查、测试、地图校验、构建和 AI 自对弈冒烟。
- `package.json` 补充 `license`、`repository`、`engines`，并加入 `.nvmrc`。

### 变更
- 镜像发布和部署工作流改读仓库变量 `GHCR_NAMESPACE`、`DEPLOY_URL`，未设置时自动跳过，fork 不会误触发。
- `game/screenshots/` 不再纳入版本控制，README 用的 3 张图放在 `baize-prototype/docs/images/`。
