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

修改官方集成、共享 SDK 或打包逻辑时，提交前运行 `pnpm plugins:verify`，检查全量官方包和隔离握手。该命令不访问真实账户，也不写入正式数据。

## 官方集成

官方集成源码位于 `plugins/`，清单元数据位于 [`plugins/official.json`](plugins/official.json)。它们会随 KanBan 应用一起构建，用户升级应用即可获得对应版本；不发布独立插件 Release，也不提供第三方包安装、导入、更新、停用或卸载入口。

新增或修改官方集成时，请在 PR 中说明协议、只读权限、数据范围、版本变化和验证结果。集成会在服务所在机器以独立进程执行，请不要引入交易写入、隐藏网络请求或未说明的凭证读取。构建器会拒绝依赖核心服务运行时代码，CI 会逐个构建并执行初始化握手。

## Mac mini 部署

公开仓库不拥有 Mac mini Runner。维护者在 Mac mini 上针对已经通过 `main` 构建的固定提交执行：

```sh
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

部署脚本先用 GitHub CLI 核对固定提交属于 main 且最新主分支构建成功，再调用既有运行时切换和健康检查；失败时保留或恢复旧运行副本。PR 和 `main` 的 GitHub Actions 不会自动触碰 Mac mini。

## 许可证

项目代码采用 [MIT License](LICENSE)。第三方代码、字体与资源继续遵循各自许可证，见 [第三方声明](docs/third-party-notices.md)。
