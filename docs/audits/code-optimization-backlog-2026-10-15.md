# 代码优化待办清单（核对修订版）

- 日期：2026-10-15
- 基线：HEAD = `37378125d4c6292546a7a5673ab33398fb7df51e`（分支 `codex/publish-kanban`）
- 规模：`src/` 349 个 TS/TSX 文件、64,443 行（按换行数统计）；`e2e/` 57 个 `*.spec.ts`；`src/app/test-doubles/` 33 个路由
- 工作区：修订前 `.workbuddy/` 与本文未跟踪；实施阶段未新增无关改动
- 状态：**已于 2026-10-15 按执行顺序实施 P1 与满足条件的 P2 项；下方各节末尾标注实施结果。改动按组拆分为原子提交，未推送、未部署**
- 提交记录：P1 回归保障 `08299b3`、局部收敛与 SQLite/持久化 `a07e965`、UI 会话锁定 `397073b`；本清单为第 4 个提交

> [前一日的独立审查报告](code-structure-maintainability-review-2026-10-14.md)（原位于 `output/`）尚未同步本次修正。本文以当前源码、测试和配置的复核结果为准，不沿用原清单中未经证实的 bug、P0 或低风险结论。

## 总体判断与优先级

架构底座较健康：`domain/`、`server/`、`ui/`、`app/` 分层清晰，ports 与组合根提供稳定边界；`asset-source-card/` 已有按职责拆分的范式；测试替身有运行时门禁；SQLite 连接与事务由组合根集中管理。

有依据的优化主要是：补齐关键回归证据、收敛语义相同的小段重复、针对实际查询优化读取，以及按职责拆分复杂组件。重复或文件较大本身不证明存在 bug，也不能直接决定修复优先级。

| 优先级 | 判定依据 | 本次归类 |
|---|---|---|
| P0 | 已确认的生产安全失守、数据损坏或核心功能阻断 | 当前核对未证实此类问题，暂不列实施项 |
| P1 | 安全边界与关键数据逻辑的回归保障 | 测试路由边界、适配器映射测试、历史迁移覆盖 |
| P2 | 有代码依据，但收益或抽象边界需验证的优化 | SQLite 查询、局部重复、e2e 助手、UI 请求处理与组件、持久化辅助逻辑、前端性能 |
| P3 | 不影响当前功能的维护事项 | 分支、工作区文件、备份和工具链治理 |

证据边界：核对包含源码、配置、现有测试及内存 SQLite 查询计划。文档核对阶段未重跑测试；实施阶段的验证结果集中记录在下方「实施结果总览」及各节末尾。现存 `.next` 构建时间早于基线提交，不能证明当前 HEAD 的构建结果、实际部署内容或首屏性能；实际生产响应头尚未核实。

## 实施结果总览（2026-10-15 执行）

| 项 | 状态 | 实施内容 | 验证 |
|---|---|---|---|
| P1-1 测试路由边界 | 已完成（生产未验证） | 33 个路由逐项核对门禁；不改动源码 | 静态核对 + 既有 `route-support.test.ts`、`test-doubles.spec.ts`、`playwright.production.config.ts` 44/44；本地 `next start` 窄证据 |
| P1-2 适配器映射与注册表类型 | 已完成 | 新增 OKX/Bitget 边界单测 12 例；`router.ts` 收紧为可刷新来源穷尽映射 | `pnpm typecheck`、`pnpm test:unit` 460/460 |
| P1-3 历史迁移覆盖 | 已完成 | 新增 `sqlite-schema-migration-store.test.ts`（v1 原始形状 → 当前版本回放、重开、列补齐） | 单元测试 3 例 + 既有 smoke v2/v4/v6/v8/v12/v14/v15 回放 |
| P2-1 SQLite 查询 | 已完成（最小改动） | 临时代表性数据测量后不加索引，仅把手工记录读写改为按 `sourceId` 定向读取 | 临时库查询计划与耗时测量（毫秒级）；`pnpm test:unit` |
| P2-2 局部语义重复 | 部分完成 | 抽取 `abortable-sleep.ts`、`preserveNewerPrices`（币种口径参数化） | 单元测试 460/460；OKX/Bitget 边界用例 |
| P2-3 e2e 助手 | 已完成 | 新增 `e2e/owner-auth-helpers.ts`，全部既有 spec 均已迁移（仅 `daily-snapshots-asset-change` 保留本地变体） | 迁移后逐 spec 重跑通过：archive 50/50、smoke 103/103；`binance-source` 按 production 配置 12/12 |
| P2-4 UI 请求与会话响应 | 已完成（范围收敛） | 新增 `owner-request-lock.ts`，接入 3 个受保护业务请求的 401 即时锁定 | 新增 `owner-request-lock.spec.ts` 3/3 |
| P2-5 大文件拆分 | 暂缓 | 未实施 | 见该节依据 |
| P2-6 持久化辅助逻辑 | 部分完成 | 抽取 `compactPositions` 供卡片与来源共用 | `pnpm test:unit` + 相关 e2e |
| P2-7 CSS 与图表加载 | 暂缓 | 未实施 | 动态类已证在用；无当前构建性能证据 |
| P2-8 生产响应头 | 未验证 | 未实施 | 无真实部署只读访问 |
| P3 维护事项 | 未实施 | 按执行要求跳过 | — |

验证汇总（2026-10-15 执行）：

- `pnpm typecheck` 通过；`pnpm test:unit` 460/460；
- `pnpm test:browser:build` 基于当前工作区成功生成构建，未复用旧 `.next`；
- archive：`owner-request-lock` 3/3，`card-layout-responsive` + `source-list-detail-lifecycle` 9/9，迁移助手后 spec 分批 33/33、13/13、18/18、8/8、13/13；
- smoke 全量 169/169；`playwright.production.config.ts` 44/44（含生产环境拒绝测试端点）；
- 本地 `next start` 窄生产证据：`/` 返回 307 跳转 localhost 且带 `Cache-Control: no-store`，`POST /test-doubles/reset` 返回 404，未认证 `PUT /api/asset-cards/layout` 返回 401；
- 以上测试与本地进程证据不等价于真实生产验证：未访问任何真实部署与反向代理。

## P1-1 测试路由的生产边界与构建分离评估

**已确认**：源码有 33 个测试路由，现存 `.next/app-path-routes-manifest.json` 也包含 33 条对应路由。`testGuard()` 仅在精确 `APP_ENV === "test"` 时放行，否则返回 404；契约测试与 `e2e/archive/test-doubles.spec.ts` 已覆盖非测试环境的拒绝行为。

证据：`src/server/testing/route-support.ts:4-25`、`src/server/composition.ts:25-27,57-81`、`src/server/testing/route-support.test.ts`、`playwright.production.config.ts:11-25`。

**风险范围**：误设 `APP_ENV=test` 会启用测试服务与测试端点。reset 重建测试替身并清空进程会话；owner-session 创建测试所有者 cookie；持久化测试端点可在临时目录写库。不能据此推断会清空真实金融数据库，也不能仅凭旧 `.next` 断言当前版本已随生产部署分发。

**先核实，再选择方案**：

1. 核实实际部署环境与测试端点响应，保留现有运行时门禁和生产 404 契约。如确认生产公开放行，再升级为 P0。
2. 若目标是增加运行时拒绝保护，可评估部署层或独立于 `APP_ENV` 的第二道门禁；必须说明其信任来源及配置冲突时的行为。同一变量控制两道判断不构成独立保护。
3. 若目标是让生产产物完全没有测试路由，先设计独立的生产、测试构建及启动流程。当前 Playwright 两套服务复用同一构建产物，不能直接加“不含路由”断言并称零风险。
4. 只有实现构建分离后，才为生产产物增加无测试路由断言，并验证测试产物仍保留全部替身功能。

**构建约束**：`_test-doubles` 私有目录会在所有环境退出 App Router 路由发现，不能仅靠改名实现生产排除。middleware/Proxy 或配置中的请求拦截也不会移除构建路由；构建后只删除源码目录不会移除已生成的路由。若采用构建前目录剥离，需保证隔离、恢复及并行构建安全。

本地 Next.js 依据：`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`、`node_modules/next/dist/build/route-discovery.js`。源码中 56 个 spec 共 539 处 `/test-doubles/` 文本引用；这只是依赖规模统计，不代表真实请求次数。

**实施结果**：33 个测试路由逐项核对，均经由 `testGuard()` 或包一层调用的 `resetTestStateResponse` / `createTestOwnerSessionResponse` 拒绝非测试环境请求；未改源码。既有 `route-support.test.ts` 与 `e2e/archive/test-doubles.spec.ts`、`playwright.production.config.ts`（44/44）继续覆盖拒绝行为，未重复补同类断言。本地 `next start`（3199 端口，已停止）只得到 `POST /test-doubles/reset` → 404 的窄证据。**未验证范围**：无真实部署或反向代理的只读访问条件，未核实生产公网响应头、CSP、HSTS、`X-Frame-Options`；误设 `APP_ENV=test` 的风险仍只能靠该单变量门禁。构建分离未实施，也未加产物断言。

## P1-2 适配器映射回归与刷新注册表类型

**已确认**：Binance、OKX、Bitget 的 `valuePositions` 等映射逻辑较大，尚未找到针对这些函数的直接表驱动单测。现有端到端测试已有 Binance、OKX、Bitget 的 preview 与保存流程，Longbridge 也有 preview 流程及 serve 系列单测；不能称 BIT 是唯一有 preview 测试的适配器，也不能概括为所有核心逻辑零测试。

证据：`src/server/asset-sources/{binance,okx,bitget,longbridge}.ts`、`src/server/asset-sources/bit.test.ts`、`src/server/asset-sources/longbridge-serve-*.test.ts`、`e2e/archive/{binance-source,okx-source,bitget-source,longbridge-source-loop}.spec.ts`。

**建议**：

- 优先补真实边界场景：缺失报价、过期报价、币种、缺失估值不能归零、产品覆盖证据，以及保留较新价格时的总额重算。通过现有依赖注入或最小测试入口验证，不为测试重写适配器。
- Longbridge 的 `selectLongbridgeQuote` 可补针对性测试；先区分 serve 系列已覆盖的内容与该选择逻辑的缺口。
- **P2 类型收紧**：`src/server/asset-sources/router.ts:9` 的注册表使用 `Record<string, AssetSourceRefresher>`，可收紧为可刷新来源的穷尽映射。`AssetSourceKind` 包含 `manual`，而 `asset-synchronization.ts:197-202` 排除手工来源；不能直接要求全来源 `Record` 或为 `manual` 添加虚假刷新器。运行时未知来源与凭证类型检查仍需保留。

**OKX 结论更正**：`preserveNewerPrices` 与 Bitget 的实现高度相似，存在共享候选；但 OKX 当前只选择 USDT 现货报价（`okx.ts:405-410`），持仓、价格、来源金额与权威总额也按 USDT 构造（`:465,498,534-551,772-774`）。尚无可达的非 USDT 计价路径支持原文的币种 bug 判断。保留重复收敛项，撤销“修 OKX bug”及优先立即改币种的建议。

**实施结果**：

- 新增 `src/server/asset-sources/okx-bitget-value-positions.test.ts`（12 例），通过生产类 + 注入 fetch 覆盖：缺失报价不归零、过期报价不产出估值、非 USDT 计价对不参与、保留较新价格的总额重算与计价货币、旧快照缺少来源资产分区、刷新器拒绝非本来源等边界。断言先锁住现有口径，未改业务结果。
- `preserveNewerPrices` 抽取到 `valuation-policy.ts`，计价货币由调用方显式传入（OKX 恒 `USDT`；Bitget 跟随持仓 `currency` 与来源总额货币），并接入两个刷新器；OKX/Bitget 单测证明抽取前后结果一致。
- `router.ts` 注册表由 `Record<string, AssetSourceRefresher>` 收紧为 `Record<RefreshableAssetSourceKind, AssetSourceRefresher>`（`manual` 排除），运行时对未知持久化类型保留 fail-closed。
- Longbridge `selectLongbridgeQuote` 的可达路径已由 `longbridge-serve-assets.test.ts` 覆盖（盘外最新报价、Normal 常规盘、时间戳缺失），未重复补测。
- Binance `valuePositions` 仍无直接表驱动单测，本次未新增：其映射口径与 OKX/Bitget 差异大，缺少等价性证据前不扩展。

## P1-3 历史迁移覆盖补齐

**已确认**：`sqlite-schema-migration-store.ts:17-105` 用连续分支逐版迁移；前 17 个迁移方法重复事务及版本更新模式。新库直接初始化当前版本，不走完整历史链。

**已有覆盖**：`e2e/smoke/sqlite-business-data-persistence.spec.ts` 包含 v2、v4、v6、v8、v12、v14、v15 → v20 的回放。测试路由会修改结构、降低版本号、重新打开数据库并校验数据，例如 `src/app/test-doubles/sqlite-business-data-persistence/route.ts:1267-1283`。因此“历史迁移无任何测试”不成立。

**实际缺口与建议**：

1. 尚未找到 v1 → v2 的测试；先增加符合历史结构的 v1 fixture，回放至当前版本并校验凭证引用、业务数据和版本号。
2. 现有部分 fixture 从当前 schema 降级生成，不能自动证明与每个历史版本完全一致。优先校验涉及重建表、回填数据和约束变化的历史结构，避免只改版本号或依赖当前 schema 掩盖缺口。
3. 核对并补齐关键迁移失败、回滚、重开数据库及再次启动的验证，断言数据与版本保持一致。
4. 回归证据补齐后，才评估迁移注册表抽取（P2）。保留每步事务、版本更新和异常行为；新增迁移仍可能需要更新版本常量与新库 schema，不能承诺“只追加一条数据”。

`investment_cashflows` 的 schema 位于迁移模块，新库与相应迁移均调用其创建逻辑，可评估职责归属，但不构成已证实功能故障。`"01"` 版本值没有找到正常写入来源，严格拒绝非规范值也不能直接定为 bug。

**实施结果**：新增 `src/server/persistence/sqlite-schema-migration-store.test.ts`（3 例），用一个按历史 `STRICT` 表形状与 `credential_reference NOT NULL` 约束手工构造的 v1 产品库回放全部迁移到当前版本，断言凭证引用、业务数据与版本号，并在关闭重开后再次写入、校验投入历史分表；另覆盖日观测子表补齐状态、HKD 与观测汇率列。既有 smoke 的 v2/v4/v6/v8/v12/v14/v15 → v20 回放继续保留，不再重复。迁移注册表抽取未实施：回放证据刚补齐，且每步事务与版本写入语义需要在不改行为前提下单独设计。

## P2-1 SQLite 查询计划、范围读取与重复查询

**已确认**：没有普通非唯一二级索引，但存在 3 个显式唯一索引及主键、UNIQUE 自动索引。当前新库 schema 的内存核对得到 2 个 UNIQUE 自动索引与 17 个主键自动索引；不能称整个数据库只有 3 个索引或查询均无索引可用。

内存 `EXPLAIN QUERY PLAN` 显示：来源投资记录筛选存在扫描与临时排序；部分按 day 或 source 主键查询可使用索引；日观测子表仅按 source 查询可能扫描复合主键索引。这是查询计划证据，尚无生产数据量与耗时基线，不能定为 P0 性能故障。

**保留的优化候选**：

- `sqlite-investment-read-store.ts:35-37`：按来源筛选并排序的投资记录查询，评估匹配筛选与排序的复合索引。
- `sqlite-asset-source-connection-store.ts:113-138`：按来源清理日观测及日结证据，评估现有复合主键的列顺序是否匹配。
- `sqlite-investment-read-store.ts:11-15`、`sqlite-formal-settlement-read-store.ts:9-33`：排序读取及正式日结三表全读、内存分组，评估调用方是否真正需要完整历史。
- `sqlite-source-read-store.ts`、`sqlite-observation-read-store.ts`：无过滤参数时的全量读取。详情链已通过来源、日期条件查询（`sqlite-read-model.ts:78-94`），不要重复提出已存在的点查改造。
- `sqlite-manual-asset-source-store.ts:62-78` 等写路径中的重复列表读取，以及 `sqlite-asset-source-connection-store.ts:144-150` 的逐日重算，评估减少读取或批处理。

**实施条件**：先用临时库构造代表性来源数、天数、记录数，记录查询计划、耗时和返回行数；按瓶颈选最小索引或范围查询。索引需兼顾写入成本，通过新迁移维护，不预定“v21 必须新增约 6 个索引”。批量重算须保持无来源、缺失金额、跨币种及事务结果等价，不预设一定能合为单条 SQL。

**实施结果**：用 `/tmp` 临时库（未入库）构造代表性来源数、天数与投资记录数，记录 `EXPLAIN QUERY PLAN`、耗时与返回行数。结论：本机数据规模下候选查询均为毫秒级，新增索引未显示可测收益，因此**不加索引、不改日观测表列顺序**，避免写入成本与迁移风险。唯一采纳的优化是 `sqlite-manual-asset-source-store.ts` 的 `recordManual` / `deleteManualRecord`：由「全表读取 + 内存 filter」改为向读模型传 `sourceId` 的定向读取，去掉重复全表扫描。重估条件：来源/天数/投资记录规模显著增长，或出现可复现的耗时基线。

## P2-2 适配器中语义相同的小段重复

| 候选 | 当前依据 | 抽取边界 |
|---|---|---|
| `preserveNewerPrices` | `okx.ts:565-623` 与 `bitget.ts:1037-1095` 形状高度相似 | 先覆盖币种、价格时序及总额重算，再参数化差异；不附带修改估值口径 |
| 可中断等待 | `bit.ts:44-62` 与 `bitget.ts:44-62` 相同；`asset-sync-diagnostics.ts:187` 另有实现 | 核对可选 signal、已取消、取消原因及监听清理；不直接替换为不同签名的实现 |
| USDT/USD 报价链 | `binance.ts:987-1027`、`okx.ts:346-391`、`bitget.ts:778-824` | 核对字段、时间戳、缺失值和未来报价策略后，只共享一致的判定 |
| JSON 字段校验 | `bit.ts`、`ethereum.ts`、`longbridge.ts` 与 serve 系列有类似工具 | 对齐可选字段、数值格式、错误信息后，逐步复用现有 `json.ts` |
| 分页与去重 | 多家有页数限制、total 校验和重复检测 | 核对页码、游标、退出条件、去重键与重试语义后，先抽一个相同场景 |
| 报价时效、页大小与对账容差 | 多处存在同值常量或内联阈值 | 相同数值不等于相同业务规则；只合并语义一致的常量 |

签名请求外壳有相似之处，但 BIT 含白名单、节流及特殊解析，Binance 含 GET/POST 与时钟重试，差异超出签名算法。**暂不列 `SignedExchangeClient` 继承基类为实施项**；只有局部抽取已证明降低复杂度，才评估组合式共享请求工具。保留各家的签名输入、编码、时钟纠偏和错误策略。

**实施结果（逐项）**：

- 可中断等待：新增 `abortable-sleep.ts` 的 `createAbortableSleep(cancelledMessage)`，`bit.ts`、`bitget.ts` 复用；保留「已取消先拒绝、结束/取消清理监听」语义与各自的中文取消文案。`asset-sync-diagnostics.ts` 的 `abortableSyncDelay` 签名与用法不同（signal 必填、直接 reject reason），未合并。
- 价格保留逻辑：见 P1-2 实施结果，已参数化币种口径合并。
- USDT/USD 报价链：暂缓。Binance、OKX、Bitget 的字段、时间戳与未来报价策略未逐一证明一致，缺少等价性证据。
- JSON 字段校验、分页与去重、报价时效常量：暂缓。未找到可证明语义完全一致的最小场景；`SignedExchangeClient` 继承基类按清单要求保持暂缓。

## P2-3 e2e 助手与测试隔离

**已确认**：`loginAsOwner` 有 30 份定义、`attachPasskey` 有 20 份、`chooseOption` 有 5 份。登录入口变化可能触发多处同步调整。

**建议**：先对比助手的副作用、前置条件与断言，抽一个共同助手并迁移少量 spec，再扩展；reset、seed、Passkey 注册与会话建立保留明确边界。需要时使用 Playwright fixture，不预先承诺统一 `seedScenario(name)` 或当天完成。

**隔离结论更正**：单 worker、文件名顺序及 spec 中没有 `reset` 字样不能证明存在顺序依赖。SQLite smoke 的隔离在服务端临时目录完成（`sqlite-business-data-persistence/route.ts:538`），部分其他测试也有临时目录隔离。应沿调用链核对共享 DB、环境变量、时钟和清理契约，对可疑用例单独运行或调换顺序验证；撤销“无 reset 且无 withTestDirectory 即失败”的文本门禁。

测试路由中的环境变量暂存/恢复样板、action 分派和长测试 harness 可局部收敛；需要保存原值与未设置状态、处理异常恢复，并保持历史 fixture 的结构证据。不同测试密钥填充值或白名单写法本身不构成 bug，不为统一形式批量改动。

**实施结果**：新增 `e2e/owner-auth-helpers.ts`（`attachPasskey`、`setupOwnerPasskey`、`replaceWithCredentiallessPasskey`、`loginAsOwnerBySession`、`loginAsOwner`），迁移 14 个既有 spec（13 个 archive + 1 个 smoke），删除各自重复的 `attachPasskey` / `loginAsOwner` 定义，保留原有断言与登录前置；新建的 `owner-request-lock.spec.ts` 直接使用共享助手。`loginAsOwner` 支持 `waitForTestId: null` 与 `captureVerification` 两个既有变体，避免改变调用方语义。**随后补齐其余 18 个 smoke/archive spec**：按各自原语义选用共享助手的对应变体（裸默认、`waitForTestId: null`、`captureVerification`、`waitForTestId: "portfolio-overview-workspace"`，或 `loginAsOwnerBySession`——`source-onboarding-page-flow` 为此增加可选路径参数）；`owner-auth`、`recovery-session-lock` 改用共享 `attachPasskey`，本地 `replaceWithCredentiallessPasskey`、`provisionAndLogin`、`unlockWithPasskey` 语义不变。`daily-snapshots-asset-change` 单独处理：保留 `loginAsOwner(page, automaticFailureCount?)` 与 `unlockAsOwner` 的 refresh-report 语义，函数体改为复用 `attachPasskey` + `setupOwnerPasskey`。除该变体外，全仓已无本地 `loginAsOwner` / `attachPasskey` 定义。迁移后逐 spec 重跑通过：archive 迁移文件 50/50、smoke 103/103，`binance-source` 按 `playwright.production.config.ts` 12/12。测试隔离结论未改，未新增文本门禁。

## P2-4 UI 请求处理与会话响应

**已确认**：`investment-performance-workspace.tsx:218-233`、`asset-source-detail.tsx:66-80`、`business-data-backup-settings.tsx:33-57` 等有重复 JSON/错误处理；不同业务请求对 401 的即时反馈存在差异。

**保护已存在**：受保护页面使用 `SessionGuard`。`session-activity.ts:28-42` 按 30 分钟期限在本地锁定，并在活动请求返回 401 时立即锁定；`session-guard.tsx:21-34` 同时监听 `OWNER_LOCK_EVENT`。不能写成“多数页面过期后不会锁定”。优化范围是业务请求被拒绝时更及时、一致地反馈锁定。

**建议**：先共享 JSON 解析与错误提取，再限定受保护业务请求的 401 处理。登录、TOTP、Passkey 与恢复接口的失败语义需单独保留。成功后刷新由调用方及现有刷新协调器决定，不把 `router.refresh()` 加到通用客户端，也不批量消除整页重载。认证和刷新策略的修改属于行为变更，需相应回归。

**实施结果**：新增 `src/ui/owner-request-lock.ts`（`readJsonResult`、`lockOnUnauthorizedResponse`、`OWNER_SESSION_EXPIRED_MESSAGE`），接入 `investment-performance-workspace.tsx`、`asset-source-detail.tsx`、`business-data-backup-settings.tsx` 三个受保护业务请求：401 时先派发 `OWNER_LOCK_EVENT` 让 `SessionGuard` 立即收起敏感内容，再抛「所有者会话已失效」作为原有错误兜底前的即时反馈。其余错误路径、JSON 解析失败、成功后的刷新协调器与整页重载策略均未改动；登录、TOTP、Passkey 与恢复接口不接入。新增 `e2e/archive/owner-request-lock.spec.ts` 3/3，分别验证资金请求、来源详情与备份接口 401 后立即锁定；成功响应路径行为不变（仅把重复的 `response.json().catch(() => null)` 收敛为共享函数）。

## P2-5 按职责拆分 UI 与复用现有组件

**已确认**：`investment-performance-workspace.tsx`（1,025 行）、`asset-source-flow.tsx`（699 行）、`asset-source-detail.tsx`（830 行）、`assets-holdings-workspace.tsx`（677 行）包含多个职责；`owner-login.tsx`（881 行）中大型视觉组件、动画数据与登录状态逻辑位于同一文件。

**建议**：从能独立说明职责的模型、section、dialog 或视觉组件开始，一次拆一个边界。保留状态所有权、焦点、动画生命周期和错误反馈；按职责及参数耦合评价拆分效果，撤销“每文件 ≤300 行”目标。先复用 `src/ui/vibe/` 与现有 Token；后续 UI 工作必须遵守 `DESIGN.md` 和固定上游版本核对要求。

其他局部候选：

- 确认弹窗与自定义分析区间有重复结构，可先确认业务和焦点语义，再考虑共享组件。
- USD/CNY/HKD 选项、分析区间选项、时间与金额格式化有重复；确认精度、单位、时区、空值及负数语义一致后再共享。
- `holding-detail-model.ts:5` 的 `amount()` 已被 `holding-detail-row.tsx:6,68` 导入使用；更正“已 export 却无人复用”。不能为共享格式化强迫其他页面依赖资产卡片内部模块。
- `command-menu.tsx` 自建 portal 与焦点管理，不证明可以直接替换为 `VibeDialog`；需先核对键盘搜索、焦点返回、遮罩与滚动行为。

**实施结果：暂缓。** `investment-performance-workspace.tsx`（约 1,025 行）、`owner-login.tsx`（约 881 行）、`asset-source-detail.tsx`（约 830 行）、`asset-source-flow.tsx`（约 699 行）、`assets-holdings-workspace.tsx`（约 677 行）未拆分。依据：本轮先补齐回归与收敛重复，拆分属于结构抽象，需要在职责边界和焦点/动画生命周期有单独验证计划时再做；仓促拆分会把认证、状态所有权与动画改动混入同一批。若续做，建议从 `owner-login.tsx` 的视觉组件与登录状态逻辑之间开始，并按 `DESIGN.md` 固定上游版本核对。确定弹窗、格式化等局部重复同样暂缓，未证明精度、单位与时区语义一致。

## P2-6 持久化辅助逻辑与测试 fixture

**保留候选**：观测行的币种 total、状态和 JSON 解码重复；`sqlite-asset-card-store.ts:62-71` 与 `sqlite-asset-source-connection-store.ts:156-166` 有相同位置压缩逻辑；多份测试通过私有连接断言 schema，临时库与连接清理可评估共享 fixture。

**建议**：只抽语义一致的解码、位置压缩及测试资源清理。相同构造器注入不是增加 `SqliteStoreBase` 的充分依据；四个 `all/get/run/exec` 薄包装暂不列实施项。不同 WHERE 写法也不必统一，除非减少真实维护成本。

来源不存在等错误的类型差异，需要先追踪调用方的状态码和用户反馈，不能仅因一个模块用了专用错误类就全面改错误体系。所有抽取保留现有连接、事务所有权，遵循 `docs/operations/service-composition.md`。

**实施结果**：新增 `sqlite-position-compaction.ts` 的 `compactPositions(database, table)`，供 `sqlite-asset-card-store.ts` 与 `sqlite-asset-source-connection-store.ts` 的删除后压紧逻辑共用，事务仍由调用方持有。观测行解码与测试资源清理未抽取：前者需逐字段核对可选值、错误文案与 JSON 解码失败语义，后者各测试的临时目录与连接清理契约不同；`SqliteStoreBase` 与 `all/get/run/exec` 薄包装按清单保持暂缓。

## P2-7 CSS 候选与图表加载性能验证

**CSS**：原扫描给出 141 个类名、约 241 行规则块，只能作为静态搜索候选，不能当成已确认可删除规模。`vibe-button--primary` 与 `vibe-notice--error` 分别由 `vibe-button.tsx:23`、`vibe-notice.tsx:29` 动态生成并使用，不能删除。`card-dragging`、`card-grid` 的多处定义可能承担层叠覆盖，需要核对加载顺序和最终样式。

后续先检查动态类名、状态分支、媒体查询与覆盖关系，再对确认未使用的最小规则集做浏览器验证；不按字面引用搜索批量删 CSS。

**图表**：`asset-trend-chart.tsx` 静态导入 Recharts，`daily-overview-workspace.tsx:638` 渲染图表。旧 `.next` 中约 366 KB 的单 chunk 与总量只反映旧产物的磁盘大小，不能当作当前路由下载量、压缩传输量或性能结论。

`next/dynamic` 可拆分客户端代码，但立即渲染的组件仍会立即加载；`ssr: false` 只是取消预渲染，不能单独证明按需加载或首屏变快。依据：`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:46-54,62-71`。

**实施条件**：当前 HEAD 新构建后，先测路由请求、压缩体积和渲染耗时；只有发现瓶颈，再评估拆包、可见性触发或交互触发加载，并保留布局、敏感信息、可访问性及缺失数据反馈。暂不把 `dynamic(..., { ssr: false })` 列为直接修复。

**实施结果：暂缓。** `vibe-button--primary`、`vibe-notice--error` 已确认由组件通过模板字符串动态拼接（`vibe-button.tsx:23`、`vibe-notice.tsx:29`），静态引用搜索会漏判，因此**未删除任何 CSS**；其余候选类未逐一核对媒体查询与层叠覆盖，不做批量清理。图表加载未改动：既有 `.next` 体积属于旧产物，本轮未采集当前构建的路由请求、压缩传输量与渲染耗时，缺乏瓶颈证据，按实施条件暂不引入 `next/dynamic`。

## P2-8 生产安全响应头核实

**已确认**：`next.config.ts:8-28` 仅配置 4 条 `Cache-Control: no-store` 规则，没有应用层 CSP、`X-Frame-Options`、HSTS。**未确认**：实际生产响应和反向代理是否已注入相应策略。

先只读核实部署层与页面响应，按实际缺口单独设计策略及验证。CSP 与 Next.js 脚本、HSTS 与 HTTPS 部署均有兼容边界，撤销“成本很低”的实施判断。若发现可验证的生产安全问题，再按影响调整优先级；不因仓库缺少配置就认定 P0。

**实施结果：未验证，未改配置。** 当前机器没有真实部署进程、launchd 服务或公网 origin 可只读访问，因此未核实生产响应头与反向代理行为。仅有的窄证据来自本地 `next start`：`/` 返回 307 并带 `Cache-Control: no-store`，该结果不代表真实部署。`next.config.ts` 仍未添加 CSP、`X-Frame-Options`、HSTS；在缺少部署层信息（HTTPS 终结位置、CDN/代理是否注入）时不宜盲加。

## P3 仓库与工具链维护

- 原审查记录合并分支、本地与远端 main 差异；清理前重新盘点引用、worktree 和未推送提交，不能仅凭名称或落后数量删除、重置。
- `.workbuddy/` 的未跟踪状态需明确用途后再决定忽略或保留，本次不处理。
- `data/` 的历史备份属于恢复资产，先核实恢复价值与保留策略，空间占用本身不是删除依据，本次不读取或清理金融数据库。
- 未配置 ESLint、Prettier、editorconfig、husky 或 CI 本身不证明代码质量故障；只有出现现有检查无法捕获的实际缺口，才单独评估引入成本与项目约束。

**实施结果：未实施（按执行要求）。** P3 分支、`.workbuddy/`、`data/` 备份、工具链治理均未处理；工作区中 `.workbuddy/` 与本文保持未跟踪状态，未清理任何数据库、备份或分支。

## 建议执行顺序

1. **先核实安全边界**：只读确认测试端点的生产响应、部署环境及响应头；保留现有门禁与 404 测试。确认实际失守时才优先修复；构建分离另行设计，暂不加与现流程冲突的产物断言。
2. **补关键回归证据**：补历史 v1 结构与关键迁移场景、适配器映射边界；核对现有降级 fixture 和测试隔离。优先提升后续重构的可验证性。
3. **做有等价性证据的局部收敛**：先选等待函数、价格保留逻辑或一个 e2e 助手；各项独立验证，保持币种、取消、认证及断言语义。刷新注册表类型收紧也可单独进行。
4. **测量并优化 SQLite**：用临时代表性数据记录查询计划和耗时，再实施最小索引、范围查询或重复读取优化；不按预定索引数量推进。
5. **按职责改进 UI 与持久化辅助逻辑**：一次一个模型、组件、解码器或请求解析边界；401 与刷新行为修改单独验证，不视为纯机械替换。
6. **验证前端性能候选**：有当前构建与网络证据后再改图表加载；有动态类名和样式证据后再清 CSS。
7. **最后评估结构抽象与维护事项**：迁移注册表或通用分页需证明减少复杂度；签名继承基类、SQL 薄包装基类保持暂缓。分支、备份和工具链不与代码优化混做。

顺序服务于风险和依赖，不要求把全部项做完。每项达到明确目标后停止，不扩展为整层重写。

## 实施约束

1. 保留适配器现有的映射与估值口径；不以消除重复为由重写或顺带改业务结果。
2. 保留“mock HTTP 边界 + 真生产类”的替身体系；若分离构建，替身源码仍保留在仓库内。
3. 保留各交易所签名、分页、时钟纠偏和重试差异，只抽已确认一致的部分。
4. 保留 SQLite `synchronous=FULL`、WAL、文件权限加固与事务边界；耐久性或权限调整需专门证据与评估。
5. `--experimental-transform-types` 与 ESM 提示是 `docs/audits/baseline-2026-10-02.md` 保留的当时取舍，不为消警告改变运行方式。
6. 实施改动按组拆分原子提交，未推送、未部署、未清理数据库；P3 未实施。

## 后续实施的验证方式

按实际改动选择验证范围，不对文档编辑运行应用构建或完整测试。

| 改动 | 最小验证及边界 |
|---|---|
| 文档 | 检查事实、优先级、执行顺序和引用；确认工作区其他文件不变 |
| 适配器及共享逻辑 | `pnpm typecheck` 与相关单测；涉及映射、凭证、分页或重试时补对应来源的 preview/刷新回归 |
| SQLite、迁移 | 临时库查询计划与数据断言；相关持久化/迁移用例；保留新库、旧库升级、失败回滚及重开验证 |
| 测试路由或构建流程 | `src/server/testing/route-support.test.ts`、`e2e/archive/test-doubles.spec.ts`；如分离产物，分别核实生产排除与测试保留 |
| e2e 助手与隔离 | 跑迁移后的 spec，保持原有断言；疑似共享状态的用例独立运行并验证顺序变化 |
| UI 请求、组件或 CSS | 类型检查及对应行为/浏览器回归；涉及会话、焦点、刷新、视觉或动画时验证相关边界 |
| 图表加载 | 当前构建的路由请求、压缩体积和渲染指标对比，加对应浏览器验收 |

Playwright 使用 `next start`，源码修改后需先生成当前构建，避免复用旧 `.next`：`pnpm test:browser:build`，再按配置运行目标 spec（例如 smoke 使用 `pnpm exec playwright test e2e/smoke/sqlite-business-data-persistence.spec.ts`，archive 使用 `--config=playwright.archive.config.ts`）。生产 404 测试使用 `playwright.production.config.ts`。实施阶段已先执行 `pnpm test:browser:build` 再运行上述套件。

共同接口或多条核心链路受到影响时，再扩大到完整单测与相应浏览器套件；检查通过且没有新改动、失败或未解疑点时，不重复全量验证。

## 剩余待办与暂缓依据（2026-10-15 实施后）

暂缓或未验证项：

1. **测试路由生产响应头**：无真实部署/反向代理访问条件，仅有本地 `next start` 404 与 `Cache-Control` 窄证据；未验证公网响应、CSP、HSTS、X-Frame-Options 与 `APP_ENV` 误配风险。
2. **构建分离（生产产物无测试路由）**：涉及生产/测试构建与启动流程拆分，且 Playwright 两套服务复用同一产物，本轮未设计，也未加冲突断言。
3. **SQLite 索引**：代表性临时数据测得收益为毫秒级，无瓶颈证据；重估条件为来源/天数/投资记录规模显著增长或出现可复现慢查询。
4. **USDT/USD 报价链、JSON 校验工具、分页去重抽取、`SignedExchangeClient` / `SqliteStoreBase` 基类**：字段、时间戳、缺失值、错误文案或 WHERE 语义未证明一致，缺少等价性证据。
5. **P2-5 大文件拆分**：`investment-performance-workspace.tsx`（约 1,025 行）、`owner-login.tsx`（约 881 行）、`asset-source-detail.tsx`（约 830 行）、`asset-source-flow.tsx`（约 699 行）、`assets-holdings-workspace.tsx`（约 677 行）未拆分；需要独立验证焦点、动画生命周期与状态所有权。
6. **CSS 清理**：动态类已证在用，其余类未核对层叠覆盖，未删除。
7. **图表加载优化**：缺当前构建的路由请求、压缩体积与渲染耗时证据。
8. **P3 维护事项**：按执行要求未实施。

剩余风险：

- 测试端点的唯一保护仍是 `APP_ENV === "test"` 单变量门禁，误配时测试服务会启用；生产响应头仍未知。
- 生产运行验证仅限本地 `next start` 窄探针，不代表真实部署、反向代理与真实金融数据路径。
- Binance `valuePositions` 无直接表驱动边界单测，本次未新增。
- 仅 `daily-snapshots-asset-change` 保留本地 `loginAsOwner(page, automaticFailureCount?)` 变体（refresh-report 场景），登录入口变更时需与共享助手同步确认。
