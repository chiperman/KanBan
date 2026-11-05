# 脚本入口与职责

本目录保存持续维护的工程脚本及相应离线单测。命令定义以 [package.json](../package.json) 为准，环境与原生产物约束见 [工具链](../docs/operations/toolchain.md)。以下按职责索引现有文件，不改变脚本运行路径。

所有命令从仓库根目录执行。一次性调查脚本放已忽略的 `tmp/<topic>/`，不混入本目录；单测与对应模块放在一起。

## 开发与检查

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm dev` / `pnpm start` | [run-local-next.mjs](run-local-next.mjs)：校验工具链、准备本机网络环境并启动 Next.js；SDK 原生产物按需检查，`start` 使用已有应用构建 |
| `pnpm build` | `next build`；SDK 原生产物按需显式构建 |
| `pnpm typecheck` | `tsc --noEmit`；首次检出或清除 Next.js 产物后，先按 [开发入口](../README.md#开发入口) 生成路由类型 |
| `pnpm test:unit` | [run-unit-tests.mjs](run-unit-tests.mjs)：发现 `scripts/` 和 `src/` 中既有 `*.test.ts` / `*.test.mjs`，通过 Node 执行离线单测 |
| `pnpm test` | 按顺序执行 `typecheck`、`design:lint`、`test:unit`；不启动应用构建或浏览器 |
| `pnpm ci:verify` | [ci-verify.mjs](ci-verify.mjs)：在隔离临时数据目录执行 frozen install、Next 路由类型生成、类型检查、设计检查、离线单测和生产构建；供 GitHub-hosted Runner 使用 |

范围与新增测试约束见 [测试纪律](../AGENTS.md#测试纪律)。公开仓库由 [PR 验证 Action](../.github/workflows/verify.yml) 和 [main 构建 Action](../.github/workflows/main-build.yml) 负责正式门禁与构建。

## 原生扩展与本机授权

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm native:longbridge:build` | [build-longbridge-keychain-sdk.mjs](build-longbridge-keychain-sdk.mjs)：编译并签署扩展，写入本机产物清单 |
| `pnpm native:longbridge:check` | [native-artifact.mjs](native-artifact.mjs)：校验源指纹、产物摘要和运行兼容性；也供构建脚本写清单 |
| `pnpm longbridge:keychain:repair` | [longbridge-keychain.mjs](longbridge-keychain.mjs)：显式交互修复 macOS 登录钥匙串，不由应用启动触发 |

首次使用 SDK 时检查原生产物，CLI 模式启动无需 SDK；原生源码、补丁与本机生成物的边界见 [原生产物](../docs/operations/toolchain.md#原生产物)。

## 设计工具

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm design:lint` | [lint-design-tokens.mjs](lint-design-tokens.mjs)：递归检查 `src/app/` 的 CSS 与 UI 样式规则；存量记录在 [token-lint-baseline.json](design-system/token-lint-baseline.json) |

验证范围和基线维护见 [设计契约](../DESIGN.md#变更与验证)，不能更新基线绕过检查。

## 数据与运维

### Mac mini 手动部署

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm deploy:manual <commit-sha>` | [manual-deploy.mjs](manual-deploy.mjs)：确认提交属于 `origin/main`，在临时 worktree 中调用 `runtime:update`，完成独立构建和健康检查 |

Mac mini 不运行轮询器，也不作为公开仓库的 self-hosted Runner。正式部署只有维护者在确认 `main` 构建通过后主动执行。

下列入口可能读取真实来源、写入业务数据或更改本机任务。命令索引仅说明现有能力，具体执行沿用本次授权与所属合同。

| 命令或脚本 | 入口与作用 |
| --- | --- |
| `pnpm runtime:prepare <新永久目录> [参数]` | [prepare-runtime.mjs](prepare-runtime.mjs)：准备独立的生产运行副本，不复制业务数据或安装任务；参数与迁移边界见 [后台自动采集](../docs/operations/service-composition.md#后台自动采集) |
| `pnpm runtime:update [--check]` | [update-runtime.mjs](update-runtime.mjs)：从临时部署 worktree 更新已安装的 3001 正式版，沿用正式配置、数据与采集周期，验证失败恢复旧任务；`--check` 只检查配置，切换与备份边界见 [永久运行副本](../docs/operations/service-composition.md#永久运行副本) |
| `pnpm plugin:build [源码目录] [新输出目录]` | [build-source-plugin.mjs](build-source-plugin.mjs)：将指定插件的静态运行时依赖发射为独立包，拒绝运行时依赖 `src/server/`；长桥 `--with-sdk` 校验并携带本机产物，默认构建 `plugins/binance`，不安装或接触来源 |
| `pnpm plugins:build [新输出目录] [--with-sdk]` | [build-source-plugins.mjs](build-source-plugins.mjs)：构建全部八个外部来源与服务包，默认输出 `dist/plugins/packages/`，不安装插件 |
| `pnpm plugin <available\|list\|inspect\|install\|update\|enable\|disable\|uninstall\|rollback> [参数]` | [source-plugin.ts](source-plugin.ts)：浏览发行目录；`inspect` 查看 GitHub 发行信息；按 ID、GitHub 仓库/Release 地址、包目录或压缩包安装及管理，多插件仓库用 `--plugin <ID>` 选择；读取 `.env.local`，下一次请求自动生效，详见 [插件安装](../docs/operations/asset-sources.md#独立包安装与生命周期) |
| `pnpm plugin create <名称> <新目录>` / `pack <包目录> <新输出.tar.gz> [--repository owner/repo --release v1.0.0]` | [开发模板](../plugins/sdk/template/) 与独立包归档入口；带仓库和 tag 时还生成同目录 `catalog.json`，输出目录须先创建且文件须不存在；协议和分发见 [第三方插件开发](../docs/operations/plugin-development.md) |
| `pnpm plugin release <包目录> [包目录...] --output <新目录> --repository owner/repo --release v1.0.0` | 一次生成全量插件压缩包与 `catalog.json`；每次传入仓库全部可运行包目录，未改动插件保持原版本；拒绝已有输出目录和重复 ID，失败清理本次产物；不执行发布 |
| `pnpm plugins:release plugins-v1.0.0 [新输出目录]` | [release-source-plugins.mjs](release-source-plugins.mjs)：构建八个通用压缩包、目录与摘要，默认输出 `dist/plugins/release/`，不执行发布 |
| `pnpm background:run` | [run-background.mjs](run-background.mjs) / [run-background-collection.ts](run-background-collection.ts)：一次后台检查，执行到期全量、失败补试及正式日结；必须显式指定正式数据目录 |
| `pnpm background:launchd <install\|status\|remove\|print>` | [background-launchd.mjs](background-launchd.mjs)：管理永久副本的网页常驻与每分钟后台检查任务；移除不删除数据 |
| `pnpm daily-settlement:run` | [run-formal-daily-settlement.ts](run-formal-daily-settlement.ts)：独立运行生产日结服务；`APP_ENV=test` 不会将此 CLI 切换为测试替身，合同见 [正式日结](../docs/operations/service-composition.md#正式日结) |
| `pnpm daily-settlement:launchd <install\|status\|remove\|print>` | [formal-daily-settlement-launchd.mjs](formal-daily-settlement-launchd.mjs)：安装、查询、移除或打印本实例的 macOS 任务配置 |
| `pnpm migrate:json-to-sqlite <dashboard.sqlite> <dashboard.json> <cards.json>` | [migrate-json-to-sqlite.ts](migrate-json-to-sqlite.ts)：显式迁移旧 JSON；目标空库校验及备份见 [服务生命周期](../docs/operations/service-composition.md) |
| [import-source-investment-history.ts](import-source-investment-history.ts) | 独立来源历史导入工具，参数为数据库路径、记录 JSON 和可选的 `--apply`；默认只读分析，`--apply` 先备份再导入。历史原件与三本账归属见 [ADR-0007](../docs/adr/0007-unify-investment-books.md) |

历史导入入口需启用与其他 TypeScript CLI 相同的别名加载器：

```sh
node --experimental-transform-types --import ./scripts/register-ts-alias.mjs ./scripts/import-source-investment-history.ts <数据库> <记录JSON> [--apply]
```

## 辅助模块与专项检查

| 文件 | 职责 |
| --- | --- |
| [lib/plugin-archive.mjs](lib/plugin-archive.mjs) | 插件打包与受限 USTAR 解包，拒绝越界路径、链接、重复文件及超限内容 |
| [check-toolchain.mjs](check-toolchain.mjs) | 安装、启动与 CLI 共用的 Node/pnpm 版本检查 |
| [local-network-environment.mjs](local-network-environment.mjs) | 为本机启动准备 Node 网络环境，处理不可达的本地代理 |
| [register-ts-alias.mjs](register-ts-alias.mjs) / [ts-alias-loader.mjs](ts-alias-loader.mjs) | TypeScript CLI 与单测的 `@/` 别名加载支持 |
| [check-https-auth.mjs](check-https-auth.mjs) | 独立的 HTTPS 认证浏览器检查，使用隔离构建、临时 TLS 与虚拟 Passkey；运行前提与证据边界见 [认证传输](../docs/operations/auth-transport.md#验证入口) |

专项脚本按需运行，存在不代表最近已通过。
