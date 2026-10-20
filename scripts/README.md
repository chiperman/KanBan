# 脚本入口与职责

本目录保存持续维护的工程脚本及相应离线单测。命令定义以 [package.json](../package.json) 为准，环境与原生产物约束见 [工具链](../docs/operations/toolchain.md)。以下按职责索引现有文件，不改变脚本运行路径。

所有命令从仓库根目录执行。一次性调查脚本放已忽略的 `tmp/<topic>/`，不混入本目录；单测与对应模块放在一起。

## 开发与检查

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm dev` / `pnpm start` | [run-local-next.mjs](run-local-next.mjs)：校验工具链和原生产物，准备本机网络环境，启动 Next.js；`start` 使用已有应用构建 |
| `pnpm build` | `next build`；`prebuild` 先执行原生扩展构建 |
| `pnpm typecheck` | `tsc --noEmit`；首次检出或清除 Next.js 产物后，先按 [开发入口](../README.md#开发入口) 生成路由类型 |
| `pnpm test:unit` | [run-unit-tests.mjs](run-unit-tests.mjs)：发现 `scripts/` 和 `src/` 中既有 `*.test.ts` / `*.test.mjs`，通过 Node 执行离线单测 |
| `pnpm test` | 按顺序执行 `typecheck`、`design:lint`、`test:unit`；不启动应用构建或浏览器 |

范围与新增测试约束见 [测试纪律](../AGENTS.md#测试纪律)。当前 GitHub Actions 仅 [发布介绍页](../.github/workflows/pages.yml)，没有自动执行应用测试的工作流。

## 原生扩展与本机授权

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm native:longbridge:build` | [build-longbridge-keychain-sdk.mjs](build-longbridge-keychain-sdk.mjs)：编译并签署扩展，写入本机产物清单 |
| `pnpm native:longbridge:check` | [native-artifact.mjs](native-artifact.mjs)：校验源指纹、产物摘要和运行兼容性；也供构建脚本写清单 |
| `pnpm longbridge:keychain:repair` | [longbridge-keychain.mjs](longbridge-keychain.mjs)：交互修复 macOS 登录钥匙串；同模块向启动脚本提供检查与修复接口 |

`predev` / `prestart` 执行产物检查；原生源码、补丁与本机生成物的边界见 [原生产物](../docs/operations/toolchain.md#原生产物)。

## 设计工具

| 命令 | 入口与作用 |
| --- | --- |
| `pnpm design:lint` | [lint-design-tokens.mjs](lint-design-tokens.mjs)：检查样式规则；存量记录在 [token-lint-baseline.json](design-system/token-lint-baseline.json) |

验证范围和基线维护见 [设计契约](../DESIGN.md#变更与验证)，不能更新基线绕过检查。

## 数据与运维

下列入口可能读取真实来源、写入业务数据或更改本机任务。命令索引仅说明现有能力，具体执行沿用本次授权与所属合同。

| 命令或脚本 | 入口与作用 |
| --- | --- |
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
| [check-toolchain.mjs](check-toolchain.mjs) | 安装、启动与 CLI 共用的 Node/pnpm 版本检查 |
| [local-network-environment.mjs](local-network-environment.mjs) | 为本机启动准备 Node 网络环境，处理不可达的本地代理 |
| [register-ts-alias.mjs](register-ts-alias.mjs) / [ts-alias-loader.mjs](ts-alias-loader.mjs) | TypeScript CLI 与单测的 `@/` 别名加载支持 |
| [check-https-auth.mjs](check-https-auth.mjs) | 独立的 HTTPS 认证浏览器检查，使用隔离构建、临时 TLS 与虚拟 Passkey；运行前提与证据边界见 [认证传输](../docs/operations/auth-transport.md#验证入口) |

专项脚本按需运行，存在不代表最近已通过。
