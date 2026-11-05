# GitHub Actions CI/CD

公开仓库只使用 GitHub-hosted Runner。Mac mini 不注册为仓库 Runner，也不会因为公开 PR 或 `main` 更新自动改变本机。

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

合并到 `main` 后，`Build main` 在 GitHub-hosted Runner 上再次验证并构建，保存提交元数据；`Deploy landing page` 发布 `landing/` 到 GitHub Pages。它们不会调用 Mac mini，不会读取本机数据或凭证。

## 插件和 Pages

- `.github/workflows/pages.yml`：`main` 更新后发布 `landing/`。
- `.github/workflows/plugins.yml`：推送 `plugins-v1.0.0` 标签后构建、握手验证并发布插件 Release。

插件标签发布和应用部署相互独立。

## Mac mini 手动部署

Mac mini 是维护者的个人生产环境，和公开仓库分离。需要更新时，在 Mac mini 的 KanBan 工作副本执行已经通过 `main` 构建的固定提交：

```sh
git fetch --prune origin main
pnpm deploy:manual <commit-sha>
```

脚本只接受 `origin/main` 的提交，在临时 worktree 中调用 `pnpm runtime:update`。运行时脚本会构建独立副本、执行启动检查，失败时保留或恢复旧副本。PR、分支推送和普通 `main` 合并都不会自动更新 Mac mini。

插件标签发布仍由 GitHub Actions 完成，与 Mac mini 更新相互独立。
