# Personal Asset Dashboard

本地优先、单所有者的只读个人资产看板。

项目主页：[chiperman.github.io/KanBan](https://chiperman.github.io/KanBan/)

CI/CD 与 Mac mini 部署见 [GitHub Actions CI/CD](docs/operations/github-actions.md)；本地排查入口见 [本地 CI 运维说明](docs/operations/local-ci.md)。

## 集成插件

外部接入以独立插件提供，按需安装：Binance、OKX、Bitget、BIT / Matrixport、Ethereum 观察钱包、BNB 观察钱包、长桥和 CoinGecko。

无需设置 Passkey 即可预览：进入演示模式后点击“插件”，或打开 `/settings?view=plugins&mode=demo`。演示使用虚构版本和安装状态，可搜索、筛选，不执行安装或读取本机账户与插件数据。

### 安装与使用

1. 打开 **设置 → 插件**，浏览或搜索插件，点击“安装”。
2. 账户插件安装启用后，通过“添加账户”填写只读凭证或完成授权，核对预览后确认。CoinGecko 提供参考价格服务，无需添加账户。
3. 在插件页管理更新、启停、卸载，或回滚到本机保留的历史版本。停用和卸载会停止后续读取，保留账户、凭证、快照与历史。

插件目录由 [plugins/registry.json](plugins/registry.json) 维护，只登记介绍和发布仓库，版本及安装包从各自的 GitHub Release 获取；官方包使用本仓库的稳定 `plugins-v*` Release。目录安装和 GitHub 直接安装均从原仓库检查更新，开发者发布新版无需重复提交上架 PR，用户确认后升级。尚未发布的官方插件仍可查看介绍，安装按钮显示“待发布”。也可选择“导入插件包”，导入开发者提供的 `.tar.gz` 文件，查看用途、版本、开发者与 SHA-256 后确认安装。插件在服务所在机器执行代码，请仅安装可信来源的包。

未上架的插件也能安装：点击“从 GitHub 安装”，粘贴开发者提供的 `owner/repo` 或 Release 地址，查看插件信息后确认。一个仓库可发布多个插件，安装时选择其中一个；后续点击“检查更新”，会从原发布仓库读取新版本。

命令行安装、已有账户升级及维护者发布步骤见 [插件安装与生命周期](docs/operations/asset-sources.md#独立包安装与生命周期)。

### 开发自己的接入

第三方开发者可使用统一协议独立开发，无需修改 KanBan 核心或将源码合入主仓库。先创建模板：

```sh
pnpm plugin create my-provider ./my-provider
```

实现生成的 `provider.mjs` 中的只读资产读取与授权函数，并验证真实账户接入后，打包分发：

```sh
mkdir -p release
pnpm plugin pack ./my-provider ./release/my-provider-1.0.0.tar.gz \
  --repository your-name/my-provider --release v1.0.0
```

将生成的 `.tar.gz` 与 `catalog.json` 一起上传到自己仓库的 `v1.0.0` Release，用户即可从仓库地址直接安装。希望出现在插件目录时，再向 [plugins/registry.json](plugins/registry.json) 提交 PR，审核合入后展示。官方插件集中在本仓库，第三方可自行选择单插件或多插件仓库。清单、协议、快照格式与上架步骤见 [第三方插件开发指南](docs/operations/plugin-development.md)。

同一仓库有多个插件时，每次发行都包含全部插件，包括未改动的插件：

```sh
pnpm plugin release ./provider-a ./provider-b --output ./release-v1.1.0 \
  --repository your-name/plugins --release v1.1.0
```

命令生成完整 `catalog.json` 和各插件压缩包，将输出目录内的所有文件一起上传。未改动的插件保持原版本，输出目录须尚不存在。

## 开发入口

使用 Node 24.15.0、pnpm 11.25.0；编译原生扩展另需 Rust。完整约束见 [工具链](docs/operations/toolchain.md)。

首次准备：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

本机配置放在已忽略的 `.env.local`，运行时数据保存在 `data/`。仅使用长桥 CLI 时无需编译原生扩展；使用 SDK 前构建原生产物并以 `--with-sdk` 打包长桥插件，具体步骤见 [插件构建与发布](docs/operations/asset-sources.md#维护者构建与发布)。

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
| [src/domain/](src/domain/) | 纯值模型、领域规则、金额与收益计算及相应单测；不依赖服务端或 UI |
| [src/server/](src/server/) | 服务装配、来源接入与同步、外部适配器、持久化和认证 |
| [src/ui/](src/ui/) | 页面工作区、客户端交互与展示模型；共享 React 组件在 [vibe/](src/ui/vibe/) |
| [src/shared/](src/shared/) | 跨客户端与服务端共用的基础定义，当前为会话策略 |
| [plugins/](plugins/) | 独立来源与服务插件；构建、安装与停用见 [来源接入](docs/operations/asset-sources.md) |
| [plugins/sdk/](plugins/sdk/) | 插件协议、stdio 入口、共享运行时工具与第三方模板；不是独立发布的 npm SDK |
| [plugins/longbridge/native/](plugins/longbridge/native/) | 原生扩展源码、Cargo 锁文件与必需的 OAuth 本地补丁；产物说明见 [工具链](docs/operations/toolchain.md#原生产物) |
| [public/](public/) | 应用运行时静态资源，包括字体及许可证 |
| [landing/](landing/) | 独立 GitHub Pages 介绍页及其资源，不参与应用构建 |
| [scripts/](scripts/README.md) | 持续维护的开发、设计与运维脚本；入口、辅助模块和检查范围见索引 |
| [docs/](docs/README.md) | 现行规范、源码导航与唯一待办入口 |
| [.github/workflows/](.github/workflows/) | PR 验证、main 部署、介绍页发布与独立插件 Release 工作流 |
| `data/` | 本机业务数据、凭证和备份，已忽略，不作为临时目录清理 |
| `dist/plugins/` | 已忽略的独立插件包、发行目录与摘要，由插件构建命令生成 |
| `tmp/` / `output/` | 已忽略的临时计划、一次性脚本与检查证据 |

服务端内部按职责组织：

| 入口 | 职责 |
| --- | --- |
| [composition.ts](src/server/composition.ts) / [production.ts](src/server/production.ts) / [app-services.ts](src/server/app-services.ts) | 进程级服务入口、生产装配与服务类型，生命周期见 [服务文档](docs/operations/service-composition.md) |
| [ports/](src/server/ports/) | 按能力分组的服务端口及领域模型兼容导出；[ports.ts](src/server/ports.ts) 保留聚合导出 |
| [asset-sources/](src/server/asset-sources/) / [asset-source-onboarding/](src/server/asset-source-onboarding/) | 核心读取编排、兼容门面，以及接入预览状态与类型；供应商实现归属 `plugins/` |
| [persistence/](src/server/persistence/) | SQLite、Schema、迁移、存储适配和读模型 |
| [auth/](src/server/auth/) / [credentials/](src/server/credentials/) | 认证会话与挑战，以及所有者凭证和秘密存储 |
| [backup/](src/server/backup/) | 业务备份文档编解码 |
| [testing/](src/server/testing/) / [src/app/test-doubles/](src/app/test-doubles/) | 独立测试装配、替身、fixture 与受环境门禁保护的 HTTP 辅助入口；Next.js 仅在测试环境通过 [instrumentation.ts](src/instrumentation.ts) 初始化 |

页面到工作区的具体导航在 [当前能力与源码导航](docs/current-baseline.md) 维护。根目录保留工程配置及 `README.md`、`AGENTS.md`、`CONTEXT.md`、`DESIGN.md` 四个文档入口；历史报告和一次性脚本不散放根目录。单测与对应模块同目录保存。

应用和独立介绍页分别保留字体资源及许可证，使两套发布入口都能独立提供字体；共享来源与授权见 [第三方声明](docs/third-party-notices.md)。

GitHub Pages 由 `.github/workflows/pages.yml` 发布 `landing/`。首次启用时，在仓库
`Settings > Pages` 的 `Build and deployment` 中选择 `GitHub Actions`；工作流只在 `main`
分支推送或手动触发时运行。

## 本机文件与清理

- 临时计划与一次性脚本放 `tmp/<topic>/`，截图和日志放 `output/<topic>/`，均不提交。长期规则更新所属文档，未完成事项只进 [backlog](docs/backlog.md)，历史从 Git 查询。
- `dist/plugins/`、`.next/`、`.next-*/`、两个 Rust `target/`、`*.tsbuildinfo` 是生成物，停止使用它们的服务或构建后可清理。Next.js 产物由开发、构建或 `next typegen` 生成，Rust 产物由原生构建生成；离线单测不代替这些步骤。
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
