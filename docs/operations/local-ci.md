# Mac mini 本地 CI（手动回退）

公开仓库的正式 CI/CD 由 GitHub Actions 触发，详见 [GitHub Actions CI/CD](github-actions.md)。本文件保留 Mac mini 上的手动验证和回退入口；启用 Actions 部署后，不要安装本文件中的轮询 LaunchAgent。

## 流程

| 触发 | 门禁 | 发布动作 |
| --- | --- | --- |
| 手动 `verify` | frozen install、路由类型、类型/设计检查、离线单测、生产构建；可选 HTTPS/Passkey 冒烟 | 无 |
| 手动 `run` | 同上，针对远端固定 SHA | 只有显式开启配置时才调用原子 `runtime:update` 或发布 Pages |
| `plugins-v1.0.0` 标签 | 同上，再构建所有插件并逐包安装握手 | `pnpm ci:local release plugins-v1.0.0` 使用本机 `gh` 发布 Release |

质量门与发布动作分开，验证失败不会更新正式副本。介绍页和插件发行不读取资产数据；正式副本更新继续沿用现有 launchd 任务、数据目录和回滚路径。

每次轮询执行以下顺序：

1. 从 `origin` 获取提交和标签；
2. 在 `~/Library/Application Support/KanBan/ci/checkout` 维护独立 Git checkout；
3. 针对远端目标 SHA 创建临时 worktree，避免读取当前开发目录的脏改动；
4. 使用临时业务目录和随机加密密钥执行 `pnpm install --frozen-lockfile`、`next typegen`、`pnpm typecheck`、可用时的 `pnpm design:lint`、`pnpm test:unit` 和 `pnpm build`；不把历史分支中可能包含浏览器 smoke 的聚合 `pnpm test` 当作离线门禁；
5. 验证期间远端分支再次前进时，丢弃本次结果，不部署旧 SHA；
6. 只有验证成功且配置开启时，调用既有 `pnpm runtime:update`。该命令构建独立运行副本，切换前等待采集完成，失败自动恢复旧任务；
7. 介绍页发布是独立的可选阶段。插件标签仍可按既有 `pnpm plugins:release` 生成产物并用本机 `gh` 发布。

浏览器冒烟不是每次提交的默认门禁；需要时在配置中打开 `browserSmoke`，或手动追加 `--browser-smoke`。它只使用临时数据、临时 TLS 证书和 Playwright 虚拟 Passkey。

## 安装到 Mac mini

在仓库工作树中执行：

```sh
pnpm install --frozen-lockfile
pnpm ci:local:launchd install
pnpm ci:local:launchd status
```

首次安装生成：

```text
~/Library/Application Support/KanBan/ci/config.json
~/Library/Application Support/KanBan/ci/checkout/
~/Library/Application Support/KanBan/ci/logs/
~/Library/Application Support/KanBan/ci/artifacts/
```

默认配置为只验证：

```json
{
  "ref": "main",
  "deployRuntime": false,
  "publishPages": false,
  "browserSmoke": false
}
```

确认 `pnpm ci:local status` 连续成功后，再编辑 `config.json` 将 `deployRuntime` 改为 `true`，随后执行：

```sh
pnpm ci:local:launchd remove
pnpm ci:local:launchd install
```

正式版仍使用现有 `com.xiaox.kanban.web` 和 `com.xiaox.kanban.background-collection`，CI 不直接改数据库、不复制 `data/`、不把服务启动在开发目录。远程 Git 使用当前 `origin`，Mac mini 必须能在非交互 launchd 环境下完成 SSH/HTTPS 认证；插件发行还需要 `gh auth status` 通过。

如果目标提交的 `package.json` 声明了 `prebuild`，CI 会先检查 `rustc --version` 和 `cargo --version`。当前远端 `main` 的长桥原生产物构建依赖 Rust；缺失时 CI 会停止在前置检查，不会误报为 TypeScript、单测或部署失败。当前工作分支没有该 `prebuild` 时，生产构建不需要 Rust。

## 与 GitHub Actions 的迁移

现有 `.github/workflows/pages.yml` 和 `.github/workflows/plugins.yml` 可以先保留作为人工回退。确认本地 CI 已经完成一次主分支验证、一次正式副本更新和一次插件发布后，再停用对应 Actions，避免两套发布器并发写入同一 Release 或 Pages。

本地 CI 的失败证据在 `logs/` 和每次验证的 `artifacts/verify-*/result.json`；`ci:local:launchd remove` 只移除调度任务，不删除 checkout、日志、产物或正式运行副本。
