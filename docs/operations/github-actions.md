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

PR 和 main 共用 [CI workflow](../../.github/workflows/ci.yml)。PR 在干净的 Ubuntu Runner 中执行安装、路由类型生成、类型检查、设计检查、离线单测和生产构建。构建生成全部官方集成，随后对这批产物执行初始化握手；不再为握手重复构建一遍。

纯文档或 `landing/` 内容的 PR 会跳过应用安装、测试和构建，但保留成功的必过检查，避免分支保护一直等待。其他改动默认完整检查。影响范围由 [ci-scope.mjs](../../scripts/ci-scope.mjs) 统一判定；事件、比较基线或 Git diff 无法确认时，执行完整检查，不猜测跳过。手动运行也执行完整检查。

同一 PR 有新提交时，取消旧的 CI、CodeQL、Dependency review 和 Native SDK 运行；不同 PR 互不取消。PR 检查失败时不能合并。CodeQL 保留所有 PR 扫描及每周扫描，以满足安全告警门禁和持续检查。

修改官方集成、共享 SDK 或构建逻辑时，本地可先运行 `pnpm plugins:verify`。它不读取正式数据、不调用真实账户 API，也不发布插件产物；它只验证官方源码构建结果和协议边界。

## 合并与部署

单人维护阶段，PR 不强制独立审批；外部贡献仍由维护者审阅后决定是否合并。管理员同样受分支保护约束：应用验证（`Typecheck, design lint, unit tests and build`）、Dependency review、CodeQL 扫描和 Rust native checks 必须通过，讨论须解决，分支须保持最新。Dependency review 拒绝新引入的高危及严重依赖；CodeQL 另有高危及以上安全发现的合并门禁，扫描任务成功不代表没有告警。

`Native SDK` 先在 Ubuntu 判定影响范围；原生源码、锁文件、构建/产物校验脚本、相关工具链或原生工作流变化时，才在 GitHub-hosted macOS 安装固定 Rust 并编译、运行现有契约测试。其他改动在 Ubuntu 完成同名检查，不启动 macOS；判定任务失败则必过检查也失败。它不连接维护者的 Keychain 或真实账户。JavaScript/TypeScript 的离线检查继续在 Ubuntu 执行。

默认 Squash merge，需要保留多个独立提交时才使用 Rebase merge；禁止 Merge Commit、强推或删除 `main`。CI 失败先修复，不通过管理员绕过门禁。

合并到 `main` 后，同一份 `CI` 对每次 push 的最新提交完整验证并构建，成功后保存提交元数据；一次 push 包含多个提交时，不为中间提交各启动一轮。PR 与 main 使用同一个验证任务和工具链，保留现有必过检查名称；手动运行执行完整检查，但不能代替 main push 的构建记录。`Deploy landing page` 只在 `landing/` 或其 workflow 改动时发布，也可手动运行。它们不会调用 Mac mini，不会读取本机数据或凭证。

main 的应用构建、CodeQL 和 Native SDK 验证不共用可互相替换的并发组；新 push 不会取消已经运行或等待的旧 push 验证，资源不足时由 GitHub 调度。验证结束可能成功或失败，不保证完成顺序。Pages 负责发布最新介绍页，同一发布组保留最新任务，不承担应用验证。

CI 验证失败时上传 `.ci-run/verification.json`，记录步骤、退出状态和耗时；详细输出仍见 Actions 日志，附件不包含环境变量、临时数据库或凭证。Dependabot 每周分组更新 npm、Actions 和两份 Cargo 项目；Node 类型的大版本随工具链显式升级。

## 官方集成和 Pages

- `.github/workflows/pages.yml`：`main` 的介绍页或其 workflow 更新后发布 `landing/` 到 GitHub Pages。
- `plugins/` 中的官方集成由 `pnpm build` 编译到 `dist/plugins/packages/`，并随应用构建一起验证。

官方集成不单独发布插件 Release。用户升级整个 KanBan 应用即可获得新的平台接入版本；应用不会从 GitHub、插件目录或本地压缩包加载新的可执行代码。希望增加新平台的开发者应提交源码 PR，经过 CI 和维护者审核后随应用发布。

## Mac mini 手动部署

Mac mini 是维护者的个人生产环境，和公开仓库分离。需要更新时，在 Mac mini 的 KanBan 工作副本执行已经通过 `main` 构建的固定提交：

```sh
git fetch --prune origin main
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

需要本机已登录的 GitHub CLI。脚本从 `origin` 确认仓库，只接受 `origin/main` 的提交，并通过 GitHub API 检查该提交最新的 push/main 应用构建成功；兼容入口合并前的 `main-build.yml` 历史记录，PR、手动运行或其他 workflow 成功不能替代应用构建。失败、运行中、没有记录或无法连接时均停止。`--check` 只检查，不创建运行副本或切换服务。通过检查后才在临时 worktree 中调用 `pnpm runtime:update`，运行配置保存提交 SHA、是否有未提交修改、准备时间及主分支构建链接。

运行时脚本会构建独立副本、执行启动检查，失败时保留或恢复旧副本。自动回退恢复代码和任务，不覆盖已写入的正式数据库；不兼容迁移须单独设计恢复方案。PR、分支推送和普通 `main` 合并都不会自动更新 Mac mini。
