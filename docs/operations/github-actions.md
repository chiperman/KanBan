# GitHub Actions CI/CD

公开仓库只使用 GitHub-hosted Runner。Mac mini 不注册为仓库 Runner，也不会因为公开 PR 或 `main` 更新自动改变本机。

## 日常开发

```sh
git switch -c feat/<topic>
pnpm install --frozen-lockfile
pnpm dev
```

代码提交前按影响范围验证，通常先在本地运行：

```sh
pnpm test
```

仅改文档时检查事实与引用，不要求本地运行应用测试。

涉及生产构建、Next 配置或运行时入口时，再运行：

```sh
pnpm build
```

推送分支并创建 PR：

```sh
git push -u origin feat/<topic>
```

PR 的 `Verify` workflow 会在干净的 Ubuntu Runner 中再次执行安装、路由类型生成、类型检查、设计检查、离线单测和生产构建。插件、`src/`、工程脚本、依赖或 workflow 变化时，还会构建全部官方插件、校验发行目录并在临时数据目录逐包试装、握手；纯文档修改跳过插件打包。无法取得比较基线或手动运行时执行完整插件检查。PR 检查失败时不能合并；同一个 PR 的旧运行会在新提交到达后取消。

修改插件、共享 SDK 或打包逻辑时，本地可先运行 `pnpm plugins:verify`。它不读取正式数据、不调用真实账户 API，也不发布产物；第三方上架条目仅校验目录格式、重复 ID、仓库和能力声明，不下载或执行第三方代码。安装握手只能证明包结构和入口可用，不能证明真实账户权限、余额和供应商 API 正确。

## 合并与部署

单人维护阶段，PR 不强制独立审批；外部贡献仍由维护者审阅后决定是否合并。管理员同样受分支保护约束：Verify、Dependency review、CodeQL 扫描和 Rust native checks 必须通过，讨论须解决，分支须保持最新。Dependency review 拒绝新引入的高危及严重依赖；CodeQL 另有高危及以上安全发现的合并门禁，扫描任务成功不代表没有告警。

`Native SDK` workflow 只在原生源码、锁文件或原生工作流变化时安装固定 Rust 并编译、运行现有契约测试；其他 PR 的同名检查正常结束。它使用 GitHub-hosted macOS，不连接维护者的 Keychain 或真实账户。JavaScript/TypeScript 的离线检查继续在 Ubuntu 执行。

默认 Squash merge，需要保留多个独立提交时才使用 Rebase merge；禁止 Merge Commit、强推或删除 `main`。CI 失败先修复，不通过管理员绕过门禁。

合并到 `main` 后，`Build main` 在 GitHub-hosted Runner 上再次验证并构建，保存提交元数据；`Deploy landing page` 发布 `landing/` 到 GitHub Pages。它们不会调用 Mac mini，不会读取本机数据或凭证。

主分支构建排队执行，不取消正在运行或等待的任务。Verify 与 main 验证失败时上传 `.ci-run/verification.json`，记录步骤、退出状态和耗时；详细输出仍见 Actions 日志，附件不包含环境变量、临时数据库或凭证。Dependabot 每周分组更新 npm、Actions 和两份 Cargo 项目；Node 类型的大版本随工具链显式升级。

## 插件和 Pages

- `.github/workflows/pages.yml`：`main` 更新后发布 `landing/`。
- `.github/workflows/plugins.yml`：维护者推送 `plugins-v1.0.0` 格式的标签后，检查主分支 CI、构建试装并发布完整插件 Release。

插件标签发布和应用部署相互独立。

### 官方插件发布

1. 在插件改动的同一个 PR 中提高内容发生变化的插件 `manifest.json` 版本。共享 SDK、领域模块或构建链路使包内容变化时，受影响的插件也须升版。
2. 将改动通过 PR 合入 `main`，等待该提交最新一次 `Build main` 成功；推送到分支的代码或主分支未验证的提交不能发布。发行批次标签与各插件版本独立：例如 `plugins-v1.1.0` 可同时包含 Binance `1.0.2` 和未改动的 OKX `1.0.0`。
3. 在确认的提交上创建并推送新 `plugins-v*` 标签。已有标签受保护，不得移动或删除；标错目标时使用新版本标签。工作流失败时在 Actions 中重跑原任务，不删标签重新指向其他提交。
4. 只读构建任务校验标签仍指向该提交、该提交已进入 `main`、其最新主分支构建成功；生成并试装全部官方包，再与上一稳定发行比较版本和摘要。首个发行没有历史版本可比较。发行批次须递增，插件不能降级或复用版本交付不同内容。
5. 构建任务保存验证后的完整产物；独立发布任务不安装依赖或执行插件，只读取产物并获得发行写权限。它重新检查目标提交、续传同一提交的草稿、下载复核全部附件后公开 Release。失败保留草稿，重跑复用已正确上传的附件；已公开附件不覆盖，不一致时停止并要求新版本。

仓库开启 Immutable releases，公开后的附件和标签由 GitHub 锁定。插件发布使用全局并发组与完整等待队列；队列不承诺版本顺序，因此维护者仍应按批次版本依次发布，确认前一版本完成后再推下一标签，不能靠并发抢占决定版本。

`catalog.json` 登记所有插件、协议、Node 主版本、大小、摘要及来源提交，`SHA256SUMS` 覆盖所有包和目录。每个发行包含全量官方插件；未改动插件保持原版本和包内容。平台专属长桥 SDK 不放入通用发行包，继续由所有者在本机构建。

真实公开下载、安装、升级和回滚的验收仍以 [backlog](../backlog.md#插件目录发布与页面验收) 为准；本地试装和隔离的发布演练不等于实际发布成功。

## Mac mini 手动部署

Mac mini 是维护者的个人生产环境，和公开仓库分离。需要更新时，在 Mac mini 的 KanBan 工作副本执行已经通过 `main` 构建的固定提交：

```sh
git fetch --prune origin main
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

需要本机已登录的 GitHub CLI。脚本从 `origin` 确认仓库，只接受 `origin/main` 的提交，并通过 GitHub API 检查该提交最新的 push/main 构建成功；失败、运行中、没有记录或无法连接时均停止。`--check` 只检查，不创建运行副本或切换服务。通过检查后才在临时 worktree 中调用 `pnpm runtime:update`，运行配置保存提交 SHA、是否有未提交修改、准备时间及主分支构建链接。

运行时脚本会构建独立副本、执行启动检查，失败时保留或恢复旧副本。自动回退恢复代码和任务，不覆盖已写入的正式数据库；不兼容迁移须单独设计恢复方案。PR、分支推送和普通 `main` 合并都不会自动更新 Mac mini。

插件标签发布仍由 GitHub Actions 完成，与 Mac mini 更新相互独立。
