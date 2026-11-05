# 贡献指南

## 开发与 PR

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
```

提交 PR 前请确认：

- `pnpm test` 通过；
- 需要时 `pnpm build` 通过；
- 没有提交 `.env.local`、`data/`、数据库、凭证或原生产物；
- 说明行为变化、验证范围和未验证风险。

PR 会在 GitHub-hosted Runner 中重新安装依赖并执行 Verify。合并到 `main` 后只会触发 GitHub-hosted 的构建，不会自动更新维护者的 Mac mini。

## 插件发布与安装

插件发布使用 `plugins-v1.0.0` 格式的标签：

```sh
git tag plugins-v1.0.0
git push origin plugins-v1.0.0
```

GitHub Actions 会构建全部插件、逐包安装握手并创建公开 Release。插件目录只登记介绍和来源；用户可以从目录、插件仓库或 Release 地址安装。

新增官方插件或修改 `plugins/registry.json` 时，请在 PR 中说明协议、权限、数据范围、版本和安装验证。插件会在服务所在机器执行，请不要引入交易写入、隐藏网络请求或未说明的凭证读取。

## Mac mini 部署

公开仓库不拥有 Mac mini Runner。维护者在 Mac mini 上针对已经通过 `main` 构建的固定提交执行：

```sh
pnpm deploy:manual <commit-sha>
```

部署脚本会检出固定提交、调用既有运行时切换和健康检查；失败时保留或恢复旧运行副本。PR 和 `main` 的 GitHub Actions 不会自动触碰 Mac mini。
