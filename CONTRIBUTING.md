# 贡献指南

## 开发与 PR

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
```

提交 PR 前请确认：

- 已按影响范围完成验证，代码修改通常运行 `pnpm test`；仅改文档时检查事实与引用；
- 需要时 `pnpm build` 通过；
- 没有提交 `.env.local`、`data/`、数据库、凭证或原生产物；
- 说明行为变化、验证范围和未验证风险。

PR 会在 GitHub-hosted Runner 中重新安装依赖并执行 Verify。合并到 `main` 后只会触发 GitHub-hosted 的构建，不会自动更新维护者的 Mac mini。

单人阶段不强制独立审批，外部 PR 仍由维护者审阅。必过检查、安全门禁及合并方式统一见 [合并与部署](docs/operations/github-actions.md#合并与部署)，管理员也不能跳过；默认 Squash merge，禁止 Merge Commit。

修改插件、共享 SDK 或打包逻辑时，提交前运行 `pnpm plugins:verify`，检查全量官方包、目录和隔离安装握手。该命令不访问真实账户；目录中的第三方插件不下载、不执行。

## 插件发布与安装

插件发布使用 `plugins-v1.0.0` 格式的标签：

```sh
git tag plugins-v1.0.0 <已通过主分支构建的完整SHA>
git push origin plugins-v1.0.0
```

GitHub Actions 会验证目标提交、构建试装官方包并发布完整 Release。提交选择、版本、权限和失败重试规则统一见 [官方插件发布](docs/operations/github-actions.md#官方插件发布)。

插件目录只登记介绍和来源；用户可以从目录、插件仓库或 Release 地址安装。

新增官方插件或修改 `plugins/registry.json` 时，请在 PR 中说明协议、权限、数据范围、版本和安装验证。插件会在服务所在机器执行，请不要引入交易写入、隐藏网络请求或未说明的凭证读取。

## Mac mini 部署

公开仓库不拥有 Mac mini Runner。维护者在 Mac mini 上针对已经通过 `main` 构建的固定提交执行：

```sh
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

部署脚本先用 GitHub CLI 核对固定提交属于 main 且最新主分支构建成功，再调用既有运行时切换和健康检查；失败时保留或恢复旧运行副本。PR 和 `main` 的 GitHub Actions 不会自动触碰 Mac mini。

## 许可证

项目代码采用 [MIT License](LICENSE)。第三方代码、字体与资源继续遵循各自许可证，见 [第三方声明](docs/third-party-notices.md)。
