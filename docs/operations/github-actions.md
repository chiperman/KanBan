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

PR、main push 和手动触发的 `CI` workflow 都先执行 `node scripts/release.mjs`，检查应用版本与更新日志一致；纯文档或介绍页改动也不跳过这项检查。它不安装依赖，也不执行发版操作。

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

## 版本发布

应用版本以 [package.json](../../package.json) 为准，使用 `X.Y.Z`；应用 Tag 和 GitHub Release 使用 `vX.Y.Z`。[CHANGELOG.md](../../CHANGELOG.md) 是发布说明的唯一来源，Release 正文复用对应章节，不另外维护一份。

日常完成功能或修复时，同步维护已有的“未发布”章节，不需要另行要求修改 Changelog；如果最新版本已经发布，先保留可追溯的提交记录，在下一批发布准备时统一汇总，保持已发布章节不变。

完成一组可交付功能，或修复影响日常使用、安全与数据正确性的问题时，评估发布新版本；只有文档、内部重构或构建次数变化时，通常无需单独发版。版本幅度按本批实际变更判断，不要求维护者逐项指定版本号或 Tag 命令。

维护者说“发布一版”时，执行完整应用发布流程：整理版本和 Changelog、提交发布 PR、等待合并后主分支检查通过、为固定提交打 Tag 并创建 GitHub Release。该指令不包含 Mac mini 部署；“更新到 3001”按已确认版本的固定 SHA 执行部署，不额外升级版本号。“提交代码”只执行验证与本地 Git 提交，推送、发布和部署按各自明确指令执行。

### 选择版本与准备记录

- 按实际交付批次升版，同一批次只升一次；日常提交、合并和重复构建不自动升级版本。
- 从上一个应用 `vX.Y.Z` 发布基线汇总本批全部变化，按最高兼容影响决定版本，不按提交数量或单个提交前缀推断。首次建立应用发布记录时明确基线，不借用历史 `plugins-*` Tag，不补造发版历史。
- 兼容修复升 patch，新增功能升 minor。当前 `0.x` 阶段，不兼容的接口、配置或数据格式变化也升 minor，并单列兼容性变化、迁移与恢复要求。进入 `1.0.0` 后，不兼容变化升 major。
- 准备发版时一起修改应用版本和更新日志。最新章节格式为 `## [X.Y.Z] - 未发布`，按新增、改进、修复及兼容性变化记录实际交付内容；空分类不保留。正式发布前将“未发布”改为实际发布日期 `YYYY-MM-DD`。
- 回补没有正式发版日期的既有开发版本时，历史章节使用 `## [X.Y.Z] - 历史开发版本`，依据 Git 历史按功能主题归纳并写明源码边界，不按提交日期分段；仅记录已确认的正式发布日期，不补造版本号或日期。此标记不能用于当前最新版本，也不作为应用发布 Tag 基线。
- 后续开发可先补充当前“未发布”章节；已发布章节保持不变。下一批交付确定时才建立新版本，不能在旧版本下记录新的发布内容。

准备完成后执行：

```sh
pnpm release:check
```

版本号和完整 Changelog（包括最终日期）通过同一 PR 合入 `main`。延期导致发布日期变化时，更新日期并重新通过 CI。

### Tag 与 GitHub Release

在干净的 `main` 工作副本执行 `git pull --ff-only`，确认包含版本号与最终更新日志的提交已经合入，并且该 SHA 的主分支 CI、CodeQL 和 Native SDK 检查通过。记录固定 SHA 后不再混入其他改动：

```sh
release_version=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version') &&
release_tag="v$release_version" &&
release_sha=$(git rev-parse HEAD) &&
pnpm release:check &&
pnpm deploy:manual "$release_sha" --check &&
mkdir -p tmp/release &&
pnpm --silent release:notes > tmp/release/notes.md
```

`release:check` 只验证本地版本记录；`deploy:manual --check` 另行确认固定提交属于远端 main 且主分支应用构建成功，不能替代其他安全检查。发布说明导出失败时停止，补齐日志或日期后重新提交并验证，不能继续打 Tag。

确认待发布 SHA 和导出的说明后，创建附注 Tag，只推送这个 Tag，再创建 Release：

```sh
git tag -a "$release_tag" "$release_sha" -m "KanBan $release_tag" &&
git push origin "refs/tags/$release_tag" &&
gh release create "$release_tag" --verify-tag --title "$release_tag" --notes-file tmp/release/notes.md
```

`--verify-tag` 要求远端已经存在该 Tag，避免 Release 自动从默认分支新建 Tag。已发布的 Tag 不移动、不覆盖；后续修复发布新版本。若 Tag 已推送但创建 Release 失败，先核对远端 Tag 的提交与现有 Release 状态，仅重试缺失步骤，不重新打 Tag。发布后核对远端 Tag 的提交、Release 版本及正文。

应用发布不自动切换 Mac mini。需要更新正式副本时，按下节部署同一 `release_sha`，再核对运行副本的来源 SHA 和服务健康状态。

## Mac mini 手动部署

Mac mini 是维护者的个人生产环境，和公开仓库分离。需要更新时，在 Mac mini 的 KanBan 工作副本执行已经通过 `main` 构建的固定提交：

```sh
git fetch --prune origin main
pnpm deploy:manual <commit-sha> --check
pnpm deploy:manual <commit-sha>
```

需要本机已登录的 GitHub CLI。脚本从 `origin` 确认仓库，只接受 `origin/main` 的提交，并通过 GitHub API 检查该提交最新的 push/main 应用构建成功；兼容入口合并前的 `main-build.yml` 历史记录，PR、手动运行或其他 workflow 成功不能替代应用构建。失败、运行中、没有记录或无法连接时均停止。`--check` 只检查，不创建运行副本或切换服务。通过检查后才在临时 worktree 中调用 `pnpm runtime:update`，运行配置保存提交 SHA、是否有未提交修改、准备时间及主分支构建链接。

运行时脚本会构建独立副本、执行启动检查，失败时保留或恢复旧副本。自动回退恢复代码和任务，不覆盖已写入的正式数据库；不兼容迁移须单独设计恢复方案。PR、分支推送和普通 `main` 合并都不会自动更新 Mac mini。
