# 代码结构与可维护性审查报告

- 日期：2026-10-14
- 范围：`src/`（354 个 TS/TSX 文件，约 64,400 行）、`e2e/`（61 个 spec，353 个 test）、`scripts/`、`src/app/test-doubles/`（33 个路由，9,566 行）
- 基线：HEAD = `3737812`，工作区干净，346 个提交；近期提交显示团队在持续收敛测试结构

---

## 一、总体判断

**可以优化，且收益最高的不是重写，而是三件事：收敛重复、补安全边界、补索引与迁移测试。**

架构底座是健康的，主要债务集中在"复制粘贴式增长"：同一套逻辑在多个适配器、多个 store、多个 UI 组件里各写一遍，改一处要同步 N 处。下面所有结论均带 `文件:行号` 证据，并已通过 diff/grep 复核。

---

## 二、结构上的优点（重构时勿破坏）

1. **分层清晰**：`domain/`（纯函数，含领域术语测试）、`server/`（ports 契约 + 实现 + 测试替身）、`ui/`（展示）、`app/`（路由）。领域层无 IO 依赖，`CONTEXT.md` 术语表与代码注释互相印证。
2. **适配器契约优秀**：`AssetSourceRefresher`（`src/server/ports/synchronization.ts:60-74`）单一方法、注入 `signal` 与 `persistCredentials` 回调，seam 意图有注释。
3. **组合根模式**：`src/server/composition.ts` + `src/server/production.ts`，生产/测试服务切换集中在一处，`globalThis` 单例槽位避免 Next.js 多上下文重复初始化。
4. **`asset-source-card/` 是拆分范式**：8 个聚焦组件 + 3 个 model 文件 + 单测，证明团队具备正确的拆分能力——workspace 级组件应对齐此模式。
5. **测试替身有安全底座**：`testGuard()`（`src/server/testing/route-support.ts:4-8`）+ `withTestDirectory` 真临时目录隔离 + 每 shard 独立端口；`route-support.test.ts:51-85` 用递归 import 做契约测试，是少见的严谨做法。
6. **SQLite 连接管理健康**：全进程单一 `DatabaseSync`（`sqlite-database-composition.ts:33`），事务集中在 `SqliteTransactionStore`，组合根失败即关连接。不存在"每操作新开连接"问题。

---

## 三、问题清单（按优先级排序）

### P0-1 测试替身路由随生产 bundle 分发，安全边界仅凭一个环境变量

- 33 个 `route.ts` 共 9,566 行（含 `node:sqlite`、`worker_threads`、完整生产持久化栈）会被 `next build` 编译进生产构建并随部署分发，唯一门禁是运行时 `testGuard()`（`APP_ENV === "test"`，`composition.ts:25-27`）。
- 已核实 `next.config.ts` 无任何排除配置，无 middleware。
- 误配置后果是实质性的：`/test-doubles/reset` 清空全部会话，`/test-doubles/owner-session` 可伪造所有者 cookie，`sqlite-business-data-persistence` 可在服务器文件系统写临时库。
- 当时的基础页面记录将其记为历史决策（知道 `_` 前缀目录可构建期排除，但选了运行时 guard）；历史定位：`git show dda468c:.scratch/active/personal-asset-dashboard/issues/01-public-homepage-foundation.md`。原行号不作为当前源码位置。
- **建议**：目录改名 `_test-doubles`（App Router 下划线目录不参与路由，构建期即排除），同步更新 `route-support.test.ts` 的枚举方式与文档；这是本次审查中唯一的安全性问题，优先级最高。

### P0-2 SQLite 读路径缺二级索引 + 全表加载，随数据量线性劣化

- 整个 schema 只有 2 个 partial unique index（`sqlite-schema.ts:157-160`）+ 1 个在迁移存储里，**0 个普通二级索引**。以下高频查询无索引可用：
  - `source_investment_records(source_id)` — `sqlite-investment-read-store.ts:35-37`
  - `daily_asset_source_snapshots(source_id)` / `daily_asset_source_trend_observations(source_id)` — `sqlite-asset-source-connection-store.ts:113-138`
  - `formal_daily_settlement_sources(source_id)` — `sqlite-asset-source-connection-store.ts:125-129`
  - `investment_cashflows(occurred_at)` — `sqlite-investment-read-store.ts:14`
  - `formal_daily_settlements(scheduled_close_at)` — `sqlite-formal-settlement-read-store.ts:13`
- 全表加载：正式日结三表 `SELECT *` + 内存分组（`sqlite-formal-settlement-read-store.ts:16-33`）、观测列表全表（`sqlite-observation-read-store.ts:71-79`）、`listSourcesSync()` 每次全读三张表（`sqlite-source-read-store.ts:13-22`）。
- 写路径内全量读：`sqlite-manual-asset-source-store.ts:62-78` 一次写入调 3 次全量列表；`sqlite-observation-store.ts:227`、`sqlite-asset-source-connection-store.ts:41-44` 同理。
- 删除来源后逐日重算，M 天 = 2M 次查询往返（`sqlite-asset-source-connection-store.ts:144-150`）。
- **建议**：① 以 migration v21 补上表 6 个二级索引；② 详情查询改带 `WHERE` 的点查；③ 列表按 day/anchor 范围查询，去掉 `SELECT *` 全量分组；④ 删除来源后的重算合并为单条 SQL。个人看板数据量增长慢，但趋势图跨月后 `daily_*` 两表会最先暴露。

### P0-3 schema 迁移链 20 分支线性 if 链，v1→v18 零测试

- `sqlite-schema-migration-store.ts:17-105` 是 20 分支 if 链，17 处逐字重复的 `UPDATE schema_metadata SET value = ?` + 17 处相同的 `transaction(() => {...})` 包装；加一个版本要改 3 处（新方法 + if 分支 + `SQLITE_SCHEMA_VERSION`）。
- `investment_cashflows` 建表 SQL 不在 `sqlite-schema.ts` 而在迁移存储 `:107-129`，schema 定义分裂两处。
- 新库走 fresh-install 分支（`:19-25`）不执行历史迁移，**v1→v18 的 17 个迁移只在真实老库升级时运行，无任何测试**——这是不可验证路径。
- 版本比较用字符串相等（`schemaVersion === "1"`），`"01"` 即失配。
- **建议**：抽 `const MIGRATIONS: Array<{ to: number; up: (db) => void }>` 注册表（事务包裹 + bump 自动化），新增版本只追加一条数据；每个迁移补"建旧库 → migrate → 断言新结构"回放测试，至少 v1→v20 全链一次。

### P1-1 交易所适配器系统性重复（约 10,500 行中估计 1,500+ 行可消除）

**已用 diff 实证的最严重一处**：`preserveNewerPrices` 在 `okx.ts:565-623` 与 `bitget.ts:1037-1095` **59 行中只差 2 行**，且两处差异都是币种口径——okx 版硬编码 `"USDT"`，bitget 版用 `holding.currency`。若 OKX 某持仓报价币种非 USDT，okx 版会把市值错误标成 USDT。这既是重复也是潜在 bug。

其余重复模式（均有证据）：

| 重复项 | 份数 | 位置 |
|---|---|---|
| 签名 HTTP 客户端（URL→HMAC→fetch→错误码包装，外壳相同、签名方案不同） | 4 | `binance.ts:1469-1520`、`okx.ts:644-688`、`bitget.ts:1122-1195`、`bit.ts:600-660` |
| USDT/USD 报价读取链（查交易对→ticker→时间戳→5 分钟新鲜度） | 3 | `binance.ts:987-1027`、`okx.ts:346-391`、`bitget.ts:778-824` |
| 分页 + total 校验 + Set 查重 + 100 页上限 | 7 | `binance.ts` ×4、`bit.ts:700-725`、`bitget.ts` ×2、`ethereum.ts:402-436` |
| 手写 JSON 校验器（record/text/decimal） | 5 | `bit.ts:82-131`、`ethereum.ts:78-106`、`longbridge.ts:48-60`、serve 系 ×2；`json.ts` 只服务了 3 家 |
| 可中断 sleep | 3 | `bitget.ts:44-62`、`bit.ts:44-62`（逐字相同）、`asset-sync-diagnostics.ts:187` |
| 时钟同步 + 时间戳错误码重试 | 3 | `binance.ts`（-1021）、`okx.ts`（50102）、`bitget.ts`（40005/40008） |
| `addPosition` 聚合 / `scopeLabel` / prices 模式重建 | 各 3 | 见原报告 |

其他发现：
- **5 分钟报价新鲜度魔法数散落 7 处**（okx ×2、bitget ×4、valuation-policy.ts:23），同一业务规则四文件硬编码。
- **刷新注册表无编译期穷尽性**：`production.ts:106-114` 用 `Record<string, AssetSourceRefresher>`，新增来源 kind 拼写错误只能运行时抛错；且 6 个 refresher 各自在 `refresh()` 开头手写 kind 检查，与 `router.ts:16-18` 重复。
- **测试覆盖倒挂**：最大的四个适配器（binance/bitget/longbridge/okx 合计 6,158 行，占 59%）核心映射逻辑零单测；`bit.ts` 是唯一有端到端 preview 测试的，可作范式。`valuePositions` 在三家各出现一次且都超 170 行，但输入是 `unknown`、输出是 `AssetSnapshot`，是无需网络的纯函数，补表驱动单测成本极低。

**建议**：
- 立即做（低风险）：提取 `preserveNewerPrices` 到共享模块并统一币种口径（顺带修 okx 的 USDT 硬编码）；三份 `abortableSleep` 收敛为 `asset-sync-diagnostics.ts` 一份；`QUOTE_MAX_AGE_MS`/`PAGE_SIZE`/`PAGE_LIMIT` 集中定义。
- 结构抽取（每项独立 PR）：`SignedExchangeClient` 模板方法基类（签名算法策略注入）；通用 `paginate()`；USDT/USD 报价读取参数化（字段映射表）；扩展 `json.ts` 并迁移 bit/ethereum/longbridge 系。
- 注册表改 `Record<AssetSourceKind, AssetSourceRefresher>` 或显式映射函数，把遗漏提到编译期。
- 为 binance/okx/bitget 的 `valuePositions`/`mapXxxSnapshot` 和 `longbridge.ts:132-203` 的 `selectLongbridgeQuote` 补表驱动单测。

### P1-2 UI 层 fetch 样板 ×6，无统一 API client

- 同一模式 6 处私有实现：`investment-performance-workspace.tsx:218-233`（cashflowRequest）、`asset-source-detail.tsx:66-80`（sourceRequest）、`business-data-backup-settings.tsx:33-57`、`source-investment-record-dialog.tsx:13-17`、`owner-login.tsx` 内联 ×3、`asset-source-flow.tsx` 内联 ×8（`:226,248,283,337,359,384,423`）。
- **401 处理不一致**：只有 `asset-refresh-provider.tsx:63-66` 统一派发 `OWNER_LOCK_EVENT`，其余各自为政——会话过期时多数页面不跳锁定页。
- **建议**：建 `src/ui/api/client.ts`，统一 JSON 解析 + `{ error }` 提取 + 401 → `OWNER_LOCK_EVENT` + 成功后 `router.refresh()` 约定；一次性替换约 30 处内联 fetch。顺带消灭 `window.location.reload()` 三种写后刷新策略的混用。

### P1-3 e2e 认证助手复制 33 份（已 grep 复核）

- `loginAsOwner` 在 30 个 spec 各写一遍，`attachPasskey` 在 32 个文件各写一遍，互相只差最后一个断言（如 `e2e/smoke/valuation-distribution-truth.spec.ts:18-26` 与 `archive/bit-source.spec.ts` 逐字相同仅 testid 不同）。
- 48 个 spec 在 `beforeEach` 重复 reset + seed 组合；`chooseOption` 另有 5 份拷贝。
- 登录入口文案一变（`owner-login.tsx:814` 按钮名）→ 30+ 文件同时红。
- **建议**：`e2e/fixtures/owner.ts` 导出 `attachPasskey`/`loginAsOwner`/`provisionOwner` 并包装成 Playwright fixture；`e2e/fixtures/reset.ts` 把 reset+常用 seed 参数化为 `seedScenario(name)`。纯机械重构，当天可完成，当天可验证。

### P1-4 UI 超大组件：拆分不彻底

- `investment-performance-workspace.tsx`（1,025 行）：590 行主组件 + 9 个 `useState` + 8 个 `useMemo` + 3 个子组件 + 13 个模块级函数，业务规则（`reasonForCurrent`/`reasonForInterval`）混在 UI 文件里。
- `asset-source-flow.tsx`（699 行）：595 行单组件同时驱动 3 步流程 × 4 种模式，10 个 `useState`，8 处 async fetch。
- `asset-source-detail.tsx`（830）、`assets-holdings-workspace.tsx`（677）：同类问题。
- `owner-login.tsx`（881 行）中 670 行是纯视觉 SVG 动画数据与组件（`:24-670`），与登录态机（`:672-881`）混居。
- **建议**：主组件只保留装配，4 个 section 提为同级文件；子组件 dialog 移到子目录；`owner-login.tsx` 的 illustration 整体抽到 `locked-screen-illustration.tsx`（零业务依赖）。目标每个文件 ≤ 300 行，对齐 `asset-source-card/` 范式。

### P2-1 重复"轮子"：四类，均有低成本收敛点

| 重复项 | 份数 | 说明 |
|---|---|---|
| 确认弹窗模式（取消/确认/pending/error notice） | 6 | `asset-source-detail.tsx:421-479`、`investment-performance-workspace.tsx:382-433` 等；应抽 `vibe-confirm-dialog` |
| USD/CNY/HKD 选项数组 | 6 | 其中 `asset-source-detail.tsx` 同文件内两份（`:50` 与 `:194-198`） |
| 千分位金额格式化 | 6 | **共享实现已存在**：`src/ui/asset-source-card/holding-detail-model.ts:5` 的 `amount()` 已 export 却无人复用 |
| 自定义分析区间弹窗 | 2 | `investment-performance-workspace.tsx:975-1022` vs `asset-source-detail.tsx:782-827` 近乎逐行相同 |

另有：`INTERVAL_OPTIONS` ×2、`formatTime` 重复实现已有 `shanghai-date-time.ts`、`command-menu.tsx:213-276` 自建 portal + focus trap 未复用 `VibeDialog`。

### P2-2 持久化层 store 间系统性样板重复（25 个 store）

- 11 处逐字相同的 `constructor(private readonly database: DatabaseSync)` + 9 处相同类注释。
- 三币种 total 映射块重复 6 次（`sqlite-observation-read-store.ts:44-48,98-102` 等）；`status ?? (complete ? ...)` 同文件重复 7 次（`sqlite-observation-store.ts`）；11 列 upsert SQL 同文件重复 3 次；JSON payload 读取模式 ×4。
- 动态 WHERE 三种风格并存（conditions 数组 / 字符串拼接 / 模板字符串）。
- 裸 `Error("资产来源不存在")` ×10，而投资记录用专用错误类——错误体系不一致。
- 位置压缩逻辑两处逐字相同（`sqlite-asset-card-store.ts:62-71` vs `sqlite-asset-source-connection-store.ts:156-166`）。
- 测试白盒：4 个测试文件 12 处 `(database as unknown as { database: DatabaseSync }).database` 取私有连接；fixture 样板重复 8+ 处。
- **建议**：抽 `SqliteStoreBase`（all/get/run/exec 四薄包装）+ 行解码工具（`sqliteBool`/`readTotal`/`readStatus`）+ `compactPositions` + `buildWhere` + `withDatabase` 测试 fixture。收敛后 25 个 store 每个可瘦 10-20%。

### P2-3 其他

- **魔法数字**：页大小 `"100"` 10 余处、100 页上限 7 处；binance 对账容差内联 `"0.001"`/`"1"` 无命名（bitget 已提为 `BITGET_RECONCILIATION_RATE`，同概念两种风格）。
- **test-doubles 内部**：30 个 action 白名单手写 `&&` 链（`sqlite-business-data-persistence/route.ts:504-536`，bitget 已进化到 `Set.has()`）；敏感环境变量暂存/恢复样板 7 处（应 `withPatchedEnv(vars, run)`）；测试加密密钥 `Buffer.alloc(32, N)` 填充字节 5 处各不相同无注释。
- **1982 行的 `sqlite-business-data-persistence/route.ts`**：30 个 action 的集成测试 harness，镜像了约 20 处生产 schema 细节——生产每加一个 schema 版本必须手动同步此处降级 SQL，漏同步即"假通过"。建议按 action 拆模块 + 表驱动 registry。
- **e2e 顺序依赖**：`workers: 1` + 文件名字母序 + 9 个 spec 无 reset（其中部分靠 `withTestDirectory` 真隔离，设计良好；但 API 级 spec 依赖全局 DB 既有状态无显式声明）。建议加 CI 检查：无 reset 且无 withTestDirectory 的 spec 即失败。
- `hardenFiles()` 每事务 6 次 syscall（`sqlite-transaction-store.ts:17,44-54`）；`synchronous=FULL` + WAL 每次 commit fsync——可评估移到启动/checkpoint 时加固，但掉电场景需谨慎，个人金融数据不建议轻动。

---

## 四、优化路线图

每个阶段独立可交付、独立验证（`pnpm typecheck && pnpm test:unit && pnpm test:smoke`，基线：typecheck 通过、单测 261、浏览器回归 51）。

### 第 1 阶段：止血（低风险高收益，预计 1-2 天）

1. `test-doubles` → `_test-doubles` 构建期排除（P0-1，唯一安全项）
2. 提取 `preserveNewerPrices` + 修 okx USDT 口径（P1-1）
3. 统一 `abortableSleep`、集中 `QUOTE_MAX_AGE_MS`/`PAGE_SIZE`/`PAGE_LIMIT`（P1-1）
4. `e2e/fixtures/owner.ts` + reset/seed 工厂（P1-3，消除 60+ 份拷贝）

### 第 2 阶段：结构抽取（每项独立 PR）

5. SQLite 二级索引（migration v21）+ 迁移回放测试框架（P0-2/P0-3）
6. `src/ui/api/client.ts` 统一 fetch + 401（P1-2）
7. `vibe-confirm-dialog`、`analysis-range-dialog`、币种选项/金额格式化收敛（P2-1）
8. 持久化层 `SqliteStoreBase` + 行解码工具 + `withDatabase` fixture（P2-2）

### 第 3 阶段：架构级（改动大，需逐项充分测试）

9. 拆分 4 个超大 UI 组件 + 剥离 owner-login illustration（P1-4）
10. 迁移注册表替换 20 分支 if 链（P0-3）
11. 签名客户端基类 / 通用分页器 / 报价读取参数化（P1-1）
12. 拆分 1982 行 sqlite 替身路由 + action 表驱动（P2-3）
13. 补适配器纯函数单测（valuePositions/mapSnapshot/selectLongbridgeQuote）

---

## 五、明确不建议做的事

1. **不要重写适配器层**：映射逻辑经过真实账户调教，重写风险远高于收益；只抽重复、补测试。
2. **不要把测试替身移出仓库**："mock HTTP 边界 + 真生产类"是替身体系的核心价值，移出即失去意义。
3. **不要统一四家签名算法**：HMAC 输入格式确实不同（hex/base64、query 串 vs path+timestamp），只抽 URL/fetch/错误包装的外壳。
4. **不要动 `synchronous=FULL`**：本地个人金融数据，掉电保护优先；如要改需专门评估。
5. **不要为消警告改运行方式**：`--experimental-transform-types` 与 ESM 类型提示是已知取舍（当前基线文档明确记录），不为整洁度回退。

---

## 六、验证方式

- 每阶段完成后：`pnpm typecheck && pnpm test:unit && pnpm test:smoke`。
- 涉及持久化的阶段：先跑 `sqlite-business-data-persistence` 相关 e2e（29 个用例覆盖迁移/回滚/并发），再做一次"旧版本库 → 升级 → 校验"的手工回放。
- 涉及替身目录改名的阶段：跑 `e2e/archive/test-doubles.spec.ts`（生产环境 404 断言）+ `route-support.test.ts` 契约测试。
- 涉及 UI 拆分的阶段：跑对应 workspace 的全部 e2e（拆分是纯机械重构时不应有任何断言变化）。
