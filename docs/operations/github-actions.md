# GitHub Actions CI/CD

公开仓库使用 GitHub Actions 作为触发器和状态中心。PR 使用 GitHub-hosted Runner；`main` 的正式构建和部署使用 Mac mini 上只执行受信任 `main` 任务的 self-hosted Runner。

## 日常开发

```sh
git switch -c feat/<topic>
pnpm install --frozen-lockfile
pnpm dev
```

提交前先在本地运行：

```sh
pnpm test
```

涉及生产构建、Next 配置或运行时入口时，再运行：

```sh
pnpm build
```

推送分支并创建 PR：

```sh
git push -u origin feat/<topic>
```

PR 的 `Verify` workflow 会在干净的 Ubuntu Runner 中再次执行安装、路由类型生成、类型检查、设计检查、离线单测和生产构建。PR 检查失败时不能合并；同一个 PR 的旧运行会在新提交到达后取消。

## 合并与部署

合并到 `main` 后，`Build and deploy production` workflow 在 Mac mini Runner 上执行：

1. 检出合并后的精确 SHA；
2. 再次运行完整验证；
3. 调用 `pnpm runtime:update`；
4. 由既有运行时脚本构建独立副本、切换 launchd 任务并执行启动检查；
5. 构建或启动检查失败时保留旧副本或自动恢复旧任务。

生产部署使用 `production` Environment，并以并发组串行执行。PR workflow 永远不使用 Mac mini Runner，也不读取生产凭据。

## 插件和 Pages

- `.github/workflows/pages.yml`：`main` 更新后发布 `landing/`。
- `.github/workflows/plugins.yml`：推送 `plugins-v1.0.0` 标签后构建、握手验证并发布插件 Release。

插件标签发布和应用部署相互独立。

## Runner 约束

Mac mini Runner 的标签必须包含：

```text
self-hosted
macos
arm64
kanban-deploy
```

Runner 服务使用当前 `xiaox` 用户运行，以便访问既有 launchd 服务、正式运行副本和必要的本机工具。公开 PR 不得选择这个标签；只有来自受保护 `main` 的部署 workflow 才能使用它。

## 切换规则

启用 GitHub Actions 部署后，不要同时安装 `pnpm ci:local:launchd` 的轮询任务。旧的 `ci:local verify` 仍可手动运行，作为本地排查入口；旧轮询器只在回退演练时临时启用。
