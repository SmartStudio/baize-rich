# GHCR 与 Dokploy 发布

本目录说明维护者如何把项目发布成 Docker 镜像并部署。只想运行游戏的话不需要这些，见根目录 README；fork 后不配置下面的仓库变量，发布工作流会自动跳过。

镜像：`ghcr.io/<GHCR_NAMESPACE>/baize-rich`。构建平台：`linux/amd64`。
Dockerfile 使用仓库根目录作为构建上下文，保留 `game/` 同级的 `data/`、`assets/`，并在镜像构建中运行测试和生产构建。

## GitHub Actions

发布正式 GitHub Release 会自动构建、测试、推送镜像并触发 Dokploy；草稿和预发布不会部署。
也可以手动运行 **Release image and deploy**，选择是否部署，用于首次接入和验证。

镜像标签包括 Release 标签、`sha-<完整提交 SHA>` 和 `latest`。`/version.json` 返回镜像的版本与提交，工作流会确认线上版本与本次发布一致。

仓库 Actions Variables（Settings → Secrets and variables → Actions → Variables）：

- `GHCR_NAMESPACE`：镜像所属的 GHCR 用户名，未设置时发布任务整体跳过。
- `DEPLOY_URL`：线上访问地址，例如 `https://example.com/`。部署后工作流用它校验 `/version.json`；未设置时不执行部署任务。

仓库 Actions Secret：

- `DOKPLOY_DEPLOY_WEBHOOK`：仅针对此应用的 Dokploy 部署 Webhook URL。不要使用账号管理员 API Key。
- `GHCR_PUSH_TOKEN`：内置 `GITHUB_TOKEN` 无法发布到个人命名空间，因此需要该命名空间所有者的 classic PAT，权限为 `write:packages`；不需要 `repo` 或 `delete:packages`。工作流用 `users/<GHCR_NAMESPACE>` 接口检查包可见性，组织命名空间需要改成 `orgs/`。

不要把任何令牌或 Webhook URL 写进代码、日志或 Release 说明。

## Dokploy

- 应用名：`baize-rich`。
- General → Source：Docker。
- Docker Image：`ghcr.io/<GHCR_NAMESPACE>/baize-rich:latest`。
- Registry URL：`ghcr.io`；Username：`<GHCR_NAMESPACE>`；Password：具备 `read:packages` 的拉取令牌。
- 启用 Auto Deploy，将本应用 Webhook 作为上述 GitHub Secret。
- 域名映射容器端口 `80`，访问地址与 `DEPLOY_URL` 保持一致。
- 镜像保持私有。不要为方便拉取而修改包的可见性。

恢复旧版本时，在 Dokploy 将 Docker Image 改为已发布的版本标签或 `@sha256:<digest>` 后部署。
需要继续跟随自动发布时，再改回 `:latest`。

## 本地验证

```bash
docker build --platform linux/amd64 --build-arg APP_VERSION=local --build-arg VCS_REF=local -t baize-rich:local .
docker run --rm -p 127.0.0.1:8080:80 baize-rich:local
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/version.json
```
