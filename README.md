# Personal Asset Dashboard

本地优先、单所有者的只读个人资产看板。

## 开发入口

使用 Node 24.15.0、pnpm 11.25.0；编译原生扩展另需 Rust。完整约束见 [工具链](docs/operations/toolchain.md)。

首次准备：

```sh
pnpm install --frozen-lockfile
pnpm native:longbridge:build
pnpm dev
```

已有兼容原生产物时，日常开发直接运行 `pnpm dev`。本机配置放在已忽略的 `.env.local`，运行时数据保存在 `data/`。

清除构建目录或首次检出后，可单独生成路由类型并检查类型，无需完整构建：

```sh
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
```

其他检查按改动范围选择：`pnpm test:unit`、`pnpm design:lint`；浏览器检查命令及范围见 `package.json`。`pnpm test` 包含构建和浏览器测试。

## 目录职责

| 目录 | 保存内容 |
| --- | --- |
| `src/app/` | Next.js 页面、路由和 HTTP 入口 |
| `src/domain/` | 领域规则、计算与相应单测 |
| `src/server/` | 服务装配、外部适配器、持久化和测试支持 |
| `src/ui/` | 页面工作区、交互组件、Vibe 组件与视觉 Token |
| `src/shared/` | 确实需要跨层共用的基础定义 |
| `native/` | 原生扩展源码、Cargo 锁文件与必需的本地依赖补丁 |
| `public/` | 应用运行时使用的静态资源 |
| `scripts/` | 持续维护的开发、构建和运维脚本及其测试 |
| `e2e/` | 浏览器测试、共享助手；`smoke/` 为默认范围，`archive/` 仍由完整回归命令使用 |
| `docs/` | 现行合同与源码导航，另设调研和历史审查区，见 [文档入口](docs/README.md) |
| `data/` | 本机业务数据、凭证和备份，已忽略，不作为临时目录清理 |

根目录保留工程配置及 `README.md`、`AGENTS.md`、`CONTEXT.md`、`DESIGN.md` 四类入口；历史报告和一次性脚本不散放根目录。单测与对应模块同目录保存，不为归类统一搬迁。

## 临时文件与清理规范

- 临时计划、一次性脚本、预览和调研副本放 `tmp/<topic>/`。
- 截图、日志、测试证据放 `output/<topic>/`；需要长期引用且已脱敏的报告归入 `docs/audits/`，同步更新引用。
- 不再维护 `.scratch/` 或强制 spec／本地 Ticket 流程；未完成事项见 [待办清单](docs/backlog.md)，需求讨论和修改过程从 Git 历史查询。
- `.next/`、`.next-*/`、两个 Rust `target/`、`test-results/`、`playwright-report/`、`.playwright-cli/`、`*.tsbuildinfo` 是生成物，停止使用它们的服务或构建后可清理。下次开发、构建或测试会按需再生成。
- `next-env.d.ts` 由 Next.js 管理；清理后用 `pnpm exec next typegen` 恢复，避免保留指向旧隔离构建目录的类型引用。
- `node_modules/` 是开发依赖；原生扩展的 `.node` 与 `artifact.json` 是本机启动所需产物；`vendor/longbridge-oauth/` 是实际使用的补丁源码，均不能混同为过期缓存。
- `.env.local`、`data/`、数据库 WAL/SHM 与锁文件不纳入生成物清理。清理旧证据前先核对引用并做仓库外可校验备份，不依赖废纸篓恢复。
- 临时产物和本机数据不提交；源码、文档整理分别按范围审阅，不使用全量清理命令替代逐项核对。

## 文档入口

- [文档入口与维护规则](docs/README.md)
- [当前能力与源码导航](docs/current-baseline.md)
- [领域词汇与业务边界](CONTEXT.md)
- [设计契约](DESIGN.md) / [设计系统](docs/design-system/README.md)
- [历史审查与验收索引](docs/audits/README.md)
- [未完成事项](docs/backlog.md)
- [Agent 规则](AGENTS.md)
