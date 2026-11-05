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

PR 的 `Verify` workflow 会在干净的 Ubuntu Runner 中再次执行安装、路由类型生成、类型检查、设计检查、离线单测和生产构建。插件、`src/`、工程脚本、依赖或 workflow 变化时，还会构建全部官方集成并在临时目录逐包执行初始化握手；纯文档修改跳过官方集成打包。无法取得比较基线或手动运行时执行完整官方集成检查。PR 检查失败时不能合并；同一个 PR 的旧运行会在新提交到达后取消。

修改官方集成、共享 SDK 或构建逻辑时，本地可先运行 `pnpm plugins:verify`。它不读取正式数据、不调用真实账户 API，也不发布插件产物；它只验证官方源码构建结果和协议边界。

## 合并与部署

单人维护阶段，PR 不强制独立审批；外部贡献仍由维护者审阅后决定是否合并。管理员同样受分支保护约束：Verify、Dependency review、CodeQL 扫描和 Rust native checks 必须通过，讨论须解决，分支须保持最新。Dependency review 拒绝新引入的高危及严重依赖；CodeQL 另有高危及以上安全发现的合并门禁，扫描任务成功不代表没有告警。

`Native SDK` workflow 只在原生源码、锁文件或原生工作流变化时安装固定 Rust 并编译、运行现有契约测试；其他 PR 的同名检查正常结束。它使用 GitHub-hosted macOS，不连接维护者的 Keychain 或真实账户。JavaScript/TypeScript 的离线检查继续在 Ubuntu 执行。

默认 Squash merge，需要保留多个独立提交时才使用 Rebase merge；禁止 Merge Commit、强推或删除 `main`。CI 失败先修复，不通过管理员绕过门禁。

合并到 `main` 后，`Build main` 在 GitHub-hosted Runner 上再次验证并构建，保存提交元数据；`Deploy landing page` 发布 `landing/` 到 GitHub Pages。它们不会调用 Mac mini，不会读取本机数据或凭证。

主分支构建使用 concurrency 串行，不取消正在运行的任务；GitHub 对同一并发组最多保留一个等待中的任务，不能把它当作无限队列。Verify 与 main 验证失败时上传 `.ci-run/verification.json`，记录步骤、退出状态和耗时；详细输出仍见 Actions 日志，附件不包含环境变量、临时数据库或凭证。Dependabot 每周分组更新 npm、Actions 和两份 Cargo 项目；Node 类型的大版本随工具链显式升级。

## 官方集成和 Pages

- `.github/workflows/pages.yml`：`main` 更新后发布 `landing/` 到 GitHub Pages。
- `plugins/` 中的官方集成由 `pnpm build` 编译到 `dist/plugins/packages/`，并随应用构建一起验证。

官方集成不单独发布插件 Release。用户升级整个 KanBan 应用即可获得新的平台接入版本；应用不会从 GitHub、插件目录或本地压缩包加载新的可执行代码。希望增加新平台的开发者应提交源码 PR，经过 CI 和维护者审核后随应用发布。

## Mac mini 手动部署

Mac mini 是维护者的个人生产环境，和公开仓库分离。需要更新时，在 Mac mini 的 KanBan 工作副本执行已经通过 `main` 构建的固定提交：

```sh
git fetch --prune origin main
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

需要本机已登录的 GitHub CLI。脚本从 `origin` 确认仓库，只接受 `origin/main` 的提交，并通过 GitHub API 检查该提交最新的 push/main 构建成功；失败、运行中、没有记录或无法连接时均停止。`--check` 只检查，不创建运行副本或切换服务。通过检查后才在临时 worktree 中调用 `pnpm runtime:update`，运行配置保存提交 SHA、是否有未提交修改、准备时间及主分支构建链接。

运行时脚本会构建独立副本、执行启动检查，失败时保留或恢复旧副本。自动回退恢复代码和任务，不覆盖已写入的正式数据库；不兼容迁移须单独设计恢复方案。PR、分支推送和普通 `main` 合并都不会自动更新 Mac mini。
