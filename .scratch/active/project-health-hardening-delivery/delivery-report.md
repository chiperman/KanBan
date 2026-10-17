# 项目健康优化交付报告

日期：2026-09-19。范围：已确认的 01—16 执行 Ticket；审查基线 9328360。

16 项实现及范围内定向验收已经完成，按业务边界本地提交。阶段进度：立即处理 7/7、本迭代 5/5、后续重构 4/4。原健康度 6.5/10 属审查时评分，本次没有重新开展全项目评分。全仓浏览器门禁仍有失败，不将定向验收通过写成全仓质量问题已清零。

## 提交与结果

| Ticket | 结果 | 主要提交 |
| --- | --- | --- |
| 01 | 自动发现离线单测，验证失败退出 | 55c0cf9 |
| 02 | 正式日结独立 CLI 及调度命令验证 | cfd0258 |
| 03 | 完整备份、旧版历史丢弃确认及回滚 | 6a4cfea、62125c5 |
| 04 | 服务端挑战绑定与原子单次消费 | 85b364c |
| 05 | 可信 HTTPS/本机 HTTP Cookie 策略 | af29a60 |
| 06 | 定向升级生产依赖，公告审计归零 | 68d87b1、ebed76d |
| 07 | 声明并校验实际验证工具链 | dd9bae3 |
| 08 | 单日观测按日期读取 | f8a7eab |
| 09 | 来源详情按来源和日期读取 | f72b1e3、53cb24e |
| 10 | 正式日结子证据批量读取 | 7ed9079 |
| 11 | 合并活动通知，保留空闲锁定 | c313fa4、9c881b3 |
| 12 | 命令菜单按真实焦点处理键盘 | 55b9c99 |
| 13 | 原生构建与启动检查分离 | 00ed6b9 |
| 14 | 提取持久化与迁移，保留兼容入口 | c9b1f20 |
| 15 | 提取秘密、认证存储与来源连接 | 4e7a0fa |
| 16 | 收敛生产装配，验证启动和 HMR | dbad39d |

同阶段补充修复：cdbc5fc 当前本金/盈亏按当前汇率展示；ba42a1f 正式日结状态与安全执行记录；6ab4700 不支持 Passkey 的恢复说明。均有各自独立提交，没有混入模块搬迁。

## 验证结果与边界

- 类型检查通过；默认单元测试 155/155 通过，包含发现入口、CLI 子进程、临时 SQLite、历史投影、会话与生命周期测试。
- 冻结安装与默认 Turbopack 生产构建通过。基线在独立目录冻结安装并构建，应用用户目录的 .next 未被本轮构建覆盖。
- 生产依赖审计 0 项公告；这是当前锁文件和审计数据库结果，不等于无未知漏洞。处理细节见 docs/operations/dependency-advisories-2026-09-19.md。
- 真实临时 SQLite 备份测试 11 项通过；旧备份确认和详情区间浏览器新增用例 2/2 通过；统一周期定向回归 2/2 通过。
- 隔离 HTTPS 代理与 Chromium 虚拟认证器完成注册、登录、失败清理、退出和 Cookie 检查；虚拟认证器并发签名断言证明挑战单次消费。没有测试真实硬件 Passkey 或真实域名代理。
- 新进程启动、模块重载和进程重启持久化测试通过；实际 Next dev HMR 重新编译后服务标识保持且仅有 1 个合成来源。此证据表示兼容模块重载可复用服务，不承诺底层实现修改后替换已有实例，运维仍需冷重启。
- TypeScript AST 运行时导入图：223 模块、0 环，排除纯类型导入。动态加载或运行时资源依赖不属于此静态结论。
- 原生 Cargo --locked 构建、macOS 签署及 addon 导出加载通过；PATH=/usr/bin:/bin 不含 Cargo 时检查仍退出 0。未读取真实钥匙串；未安装或启停真实 launchd 任务。
- 独立复审代理因提供方加密投递错误未成功执行。本轮完成自检，不冒充独立审查。

### 全量浏览器结果

| 配置 | 基线 9328360 | 本轮原始全量 |
| --- | --- | --- |
| APP_ENV=test | 196 通过 / 133 失败，共 329 | 207 通过 / 133 失败，共 340 |
| production | 22 通过 / 21 失败，共 43 | 22 通过 / 21 失败，共 43 |

test 模式有 129 个同名失败；production 的 21 个失败名称完全相同。全量后修正了新增用例选择器及刷新夹具并通过定向复验，没有将这些结果拼为新的全量通过率。

覆盖不完整展示用例全量失败后，单独复跑通过，本轮与基线又各连续 5/5 通过。触发原因尚未确定，仍列为待定位偶发失败。其他同名失败也不能只因基线失败就认定无业务风险。逐项清单见 [全量回归对照](regression-baseline.md)。

### 迁移与生命周期补验

最终核对发现原迁移夹具先建当前 schema 再降版本，但未移除 v18 的 diagnostic_json/recent_attempts_json，造成重复加列；生产服务测试缺少合成 OAuth client id。最小修改仅涉及：

- src/app/test-doubles/sqlite-business-data-persistence/route.ts：降版本时移除两列。
- e2e/sqlite-business-data-persistence.spec.ts：期望当前 schema 18。
- playwright.shared.ts：测试服务器显式使用无权限的合成 client id。

修正提交：1ee0bb9。不改变生产迁移或金额规则。重新默认生产构建后，SQLite 持久化 29 项与无凭证备份恢复 8 项共 37/37 通过；覆盖新库、旧库迁移、JSON 首次导入及幂等、重启持久化、凭证补偿、并发连接、断开/删除和恢复回滚。修正后的类型检查通过。

## 性能测量

环境：macOS arm64、Node 24.15.0、pnpm 11.25.0；临时 SQLite 和合成数据。以下是单机单次对照，不是生产延迟保证。

| 路径 | 历史 30 / 365 / 3650 天：原读取量 | 优化读取量 | 3650 天单次耗时 |
| --- | --- | --- | --- |
| 单日观测 | 63 / 733 / 7303 行 | 均 5 行 | 26.395 → 0.190 ms |
| 正式日结完整读取 | 61 / 731 / 7301 次查询 | 均 3 次 | 72.719 → 22.497 ms |
| 详情所选来源与 7 日 | 120 / 1460 / 14600 行 | 均 24 行 | 19.412 → 0.207 ms |

详情序列化体积：30 天 23,187→2,605 B；365 天 283,634→2,626 B；3650 天 2,850,915→2,640 B。另一次启用显式 GC 的测量中，查询结果保留堆增量分别为 53,104→8,296 B、456,928→4,792 B、4,515,728→7,096 B。它是 GC 后保留堆增量，不是峰值内存或进程 RSS，小值有测量噪声。

详情保留所有来源必要元数据与汇率摘要，重型持仓/历史按范围裁剪。该来源的手工记录仍完整加载供编辑器展示，其他来源手工记录不读；全量导出及 all 区间保持完整。没有以性能优化截断财务事实。

原生已有缓存的 Cargo 构建约 0.33 秒（不含复制和签署），启动检查约 0.05 秒；只表明省去构建链，不将其称为整个应用启动提速比。

## 复现入口

在隔离副本中使用声明工具链并冻结安装；不要对运行中的用户目录执行会覆盖 .next 的构建。浏览器使用临时服务、合成授权和数据。以下命令均针对隔离副本：

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm test:unit
    pnpm build
    pnpm audit --prod --json
    pnpm test:browser:parallel
    pnpm test:browser:production:parallel
    pnpm exec playwright test e2e/sqlite-business-data-persistence.spec.ts e2e/credential-free-backup-restore.spec.ts

按需设置 PLAYWRIGHT_TEST_PORT / PLAYWRIGHT_PROD_PORT / PLAYWRIGHT_RUN_ID 避开已有服务。不要在真实数据目录调用日结或恢复来代替测试；默认单测已覆盖隔离 CLI。

## 交接与剩余风险

- 16 项交付按 Ticket 自身范围验收，不等于所有历史测试债已消除。进一步整理过期 UI 选择器、迁移测试夹具以外的领域断言和套件隔离问题，应依据现行契约单独实施。
- 真账户、真实钥匙串内容、生产代理、定时任务安装、远程 CI 与部署均未执行。没有访问真实金融账户证明平台可用性。
- 生产 SQLite 模块仍约 1808 行，schema 约 697 行。此次先明确边界，未强行拆散事务；后续可以按实际维护热点继续拆分。
- Ticket 17 是此前独立集成保护记录，保留未重新核验的历史验收框，不伪造关闭。原父级审查规格与主题 Ticket 保留作历史资料，避免重复实施。
- 只提交代码、测试、运维文档与本地追踪 Markdown；不提交依赖目录、构建缓存、浏览器 profile、截图、原生构建产物或真实数据。没有 push，当前仓库无远程。

## 本机证据索引

原始日志保留在 /tmp/kanban-hardening-evidence-path 指向的临时目录，未纳入 Git，可能被系统清理。核心结果已固化在本报告与回归清单。

- /tmp/kanban-final-unit.log、/tmp/kanban-final-typecheck.log、/tmp/kanban-final-audit.json。
- final-build.log、final-fixture-build.log、final-https-auth.log、final-hmr.log、final-imports.json。
- final-detail-memory.log、final-native-no-cargo.log、final-new-cases.log、final-refresh-corrected.log。
- baseline-browser.log、final-browser.log、baseline-production-browser.log、final-production-browser.log、suite-comparison.json。
- final-coverage-repeat.log、baseline-coverage-repeat.log、final-sqlite-corrected.log。
