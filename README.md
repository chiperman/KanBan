# Personal Asset Dashboard

本地优先、单所有者的只读个人资产看板。

项目主页：[chiperman.github.io/KanBan](https://chiperman.github.io/KanBan/)

## 开发入口

使用 Node 24.15.0、pnpm 11.25.0；编译原生扩展另需 Rust。完整约束见 [工具链](docs/operations/toolchain.md)。

首次准备：

```sh
pnpm install --frozen-lockfile
pnpm native:longbridge:build
pnpm dev
```

已有兼容原生产物时，日常开发直接运行 `pnpm dev`。本机配置放在已忽略的 `.env.local`，运行时数据保存在 `data/`。

需要 Mac 登录后持续采集时，使用独立生产运行副本和正式数据目录，无需每天手动启动开发服务器；准备、迁移及安装命令见 [后台自动采集](docs/operations/service-composition.md#后台自动采集)。

已安装 3001 正式版后，开发完成在仓库根目录执行 `pnpm runtime:update` 即可更新；沿用正式数据与采集周期，构建失败保留旧版，启动检查失败恢复旧任务。使用 `pnpm runtime:update --check` 可只查看更新目标。切换时网页短暂重启，流程与回退边界见 [永久运行副本](docs/operations/service-composition.md#永久运行副本)。

清除构建目录或首次检出后，可单独生成路由类型并检查类型，无需完整构建：

```sh
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
```

`pnpm test` 依次执行类型检查、设计守门和离线单测，不包含应用构建或浏览器检查。也可按改动范围单独执行 `pnpm typecheck`、`pnpm design:lint` 或 `pnpm test:unit`；仅改文档时检查事实和引用即可。完整命令与脚本职责见 [脚本入口](scripts/README.md)，测试范围见 [Agent 测试纪律](AGENTS.md#测试纪律)。

## 目录职责

| 目录 | 保存内容 |
| --- | --- |
| [src/app/](src/app/) | Next.js 页面、HTTP 路由和全局 CSS；运行时 Token 与组件配方也在此处，归属见 [设计契约](DESIGN.md#源码归属) |
| [src/domain/](src/domain/) | 领域规则、金额与收益计算及相应单测 |
| [src/server/](src/server/) | 服务装配、来源接入与同步、外部适配器、持久化和认证 |
| [src/ui/](src/ui/) | 页面工作区、客户端交互与展示模型；共享 React 组件在 [vibe/](src/ui/vibe/) |
| [src/shared/](src/shared/) | 跨客户端与服务端共用的基础定义，当前为会话策略 |
| [native/longbridge-keychain-sdk/](native/longbridge-keychain-sdk/) | 原生扩展源码、Cargo 锁文件与必需的 OAuth 本地补丁；产物说明见 [工具链](docs/operations/toolchain.md#原生产物) |
| [public/](public/) | 应用运行时静态资源，包括字体及许可证 |
| [landing/](landing/) | 独立 GitHub Pages 介绍页及其资源，不参与应用构建 |
| [scripts/](scripts/README.md) | 持续维护的开发、设计与运维脚本；入口、辅助模块和检查范围见索引 |
| [docs/](docs/README.md) | 现行规范、源码导航与唯一待办入口 |
| [.github/workflows/](.github/workflows/) | 当前仅发布介绍页的 GitHub Actions 工作流 |
| `data/` | 本机业务数据、凭证和备份，已忽略，不作为临时目录清理 |
| `tmp/` / `output/` | 已忽略的临时计划、一次性脚本与检查证据 |

服务端内部按职责组织：

| 入口 | 职责 |
| --- | --- |
| [composition.ts](src/server/composition.ts) / [production.ts](src/server/production.ts) / [app-services.ts](src/server/app-services.ts) | 进程级服务入口、生产装配与服务类型，生命周期见 [服务文档](docs/operations/service-composition.md) |
| [ports/](src/server/ports/) | 按能力分组的端口合同；[ports.ts](src/server/ports.ts) 保留聚合导出 |
| [asset-sources/](src/server/asset-sources/) / [asset-source-onboarding/](src/server/asset-source-onboarding/) | 供应商读取适配，以及接入预览状态与类型 |
| [persistence/](src/server/persistence/) | SQLite、Schema、迁移、存储适配和读模型 |
| [auth/](src/server/auth/) / [credentials/](src/server/credentials/) | 认证会话与挑战，以及所有者凭证和秘密存储 |
| [backup/](src/server/backup/) | 业务备份文档编解码 |
| [testing/](src/server/testing/) / [src/app/test-doubles/](src/app/test-doubles/) | 测试替身、fixture 与受环境门禁保护的 HTTP 辅助入口 |

页面到工作区的具体导航在 [当前能力与源码导航](docs/current-baseline.md) 维护。根目录保留工程配置及 `README.md`、`AGENTS.md`、`CONTEXT.md`、`DESIGN.md` 四个文档入口；历史报告和一次性脚本不散放根目录。单测与对应模块同目录保存。

应用和独立介绍页分别保留字体资源及许可证，使两套发布入口都能独立提供字体；共享来源与授权见 [第三方声明](docs/third-party-notices.md)。

GitHub Pages 由 `.github/workflows/pages.yml` 发布 `landing/`。首次启用时，在仓库
`Settings > Pages` 的 `Build and deployment` 中选择 `GitHub Actions`；工作流只在 `main`
分支推送或手动触发时运行。

## 本机文件与清理

- 临时计划与一次性脚本放 `tmp/<topic>/`，截图和日志放 `output/<topic>/`，均不提交。长期规则更新所属文档，未完成事项只进 [backlog](docs/backlog.md)，历史从 Git 查询。
- `.next/`、`.next-*/`、两个 Rust `target/`、`*.tsbuildinfo` 是生成物，停止使用它们的服务或构建后可清理。Next.js 产物由开发、构建或 `next typegen` 生成，Rust 产物由原生构建生成；离线单测不代替这些步骤。
- `next-env.d.ts` 由 Next.js 管理；清理后用 `pnpm exec next typegen` 恢复，避免保留指向旧隔离构建目录的类型引用。
- `node_modules/` 是开发依赖；原生扩展的 `.node` 与 `artifact.json` 是本机启动所需产物；`vendor/longbridge-oauth/` 是实际使用的补丁源码，均不能混同为过期缓存。
- `.env.local`、`data/`、数据库 WAL/SHM 与锁文件不纳入生成物清理。删除文件前核对用途与引用，保留尚需恢复的未提交内容，不使用全量清理命令。

## 文档入口

- [文档入口与维护规则](docs/README.md)
- [当前能力与源码导航](docs/current-baseline.md)
- [领域词汇与业务边界](CONTEXT.md)
- [设计契约与规范入口](DESIGN.md)
- [路线图与未完成事项](docs/backlog.md)
- [Agent 规则](AGENTS.md)
