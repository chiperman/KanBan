# 28 — 完成中心化资产来源当前总额守恒

**What to build:** 将“总额估值完整性”与“持仓明细覆盖”作为两个独立事实；优先让 OKX、Bitget 通过官方只读账户/产品汇总与已纳入资产守恒，覆盖会占用本金的 P0 产品，并保持 Binance 现有完整状态不回归。

**Blocked by:** None

**Priority:** P0

**Status:** ready-for-human

**Adjusted by:** `.scratch/archive/personal-asset-dashboard-rebuild/issues/04-overview-confidence-and-today-judgment.md`, `.scratch/archive/personal-asset-dashboard-rebuild/issues/05-assets-holdings-and-source-observation.md`

## 范围

- OKX：
  - 使用官方只读账户资产估值汇总作为当前总额守恒哨兵。
  - 读取 On-chain Earn 当前 Active Orders。
  - Trading、Funding、Simple Earn Flexible、On-chain Earn 与平台总额在明确容差内守恒时，允许总额完整。
- Bitget：
  - 读取 SharkFin 当前资产。
  - 读取 On-chain Elite 当前资产。
  - 优先使用受支持且不混入本 Ticket 排除资产/负债的账户汇总；否则按 Spot、Funding、Savings、SharkFin、On-chain Elite、Futures Bot 的产品账户汇总逐项守恒。
  - 普通 Futures 只使用平台总额层的汇总覆盖，不展开仓位、保证金或未实现盈亏，也不与 Futures Bots 重复相加。
  - Savings 总览与逐仓不一致时保留平台汇总本金，持仓明细降级为仅汇总，不把总额标记为缺失。
- Binance：
  - 不扩产品范围，仅验证现有钱包守恒与 `complete` 快照不回归。

## 完整性规则

- “总额估值完整性”只由可靠来源总额、明确折算、未知残差、排除的正余额账户和同步新鲜度决定。
- “持仓明细覆盖”描述产品能否逐仓展开；`aggregate-only` 可以与总额完整同时成立。
- 平台总额与产品明细/汇总是同一经济资产的不同视图，不重复相加。
- 守恒残差必须保留来源、币种、差额及未覆盖产品证据；不能只输出笼统的“不完整”。
- 单个 P0 产品读取失败时整次来源余额更新 fail-closed；不得用空数组或旧产品明细伪装余额为零。

## 精确只读边界

- 生产请求只允许官方文档确认的精确 `method + path`。
- 所有新增生产端点必须为只读查询；拒绝下单、申购、赎回、转账、提现及其他写操作。
- 官方资料记录在：
  - `../research/okx-readonly-api.md`
  - `../research/bitget-readonly-api.md`
  - `../research/binance-product-coverage-audit.md`
  - `../research/cex-current-total-coverage-2026-07-30.md`

## 测试 seam

- 生产资产来源适配器公开边界：`ProductionOkxReadOnly.preview()`、`ProductionBitgetReadOnly.preview()` 和价格/全量刷新返回的 `AssetSnapshot`。
- 确定性官方响应 fixture 驱动的 HTTP 边界：精确 method/path、签名、分页、失败与残差。
- 所有者浏览器边界：总资产概览与资产卡片展示的总额完整性、产品明细覆盖和仅汇总状态。

## 验收标准

- [x] OKX 当前平台总额与已纳入 P0 产品在容差内守恒时，`coverage.status=complete`。
- [x] OKX On-chain Earn Active Orders 纳入当前本金；分页、未知状态或请求失败不会被解释为零。
- [x] Bitget SharkFin 与 On-chain Elite 当前资产纳入当前本金。
- [x] Bitget Savings 总览与逐仓不一致时保留总览金额，相关产品标记 `aggregate-only`，但已完成产品级总额守恒时 `coverage.status=complete`。
- [x] Bitget 任一 P0 产品汇总失败、存在 Margin/未知正余额或残差超容差时，`coverage.status` 动态降级并保留具体证据；普通 Futures 汇总不因缺少逐仓明细降级。
- [x] 总额守恒但有 `aggregate-only` 产品时，UI 显示“当前估值：完整”及“部分产品仅汇总”，不显示“当前估值：不完整”。
- [x] 存在未知残差时，UI 显示具体来源、差额和未覆盖产品。
- [x] 所有生产请求均属于精确只读 allowlist。
- [x] Binance 现有完整钱包守恒和产品覆盖回归通过。
- [x] 定向适配器测试、总览浏览器回归和 `pnpm typecheck` 通过。

## 非目标

- 历史资产快照、日初基准和每日趋势观测。
- Longbridge 期权行情与期权估值。
- Margin、普通 Futures、Options、Loan 等资产负债净值。
- 下单、申购、赎回、转账、提现。
- 无官方稳定当前仓位合同的产品猜测。

## 评论

- 2026-07-30：开始前已检查脏工作区；Binance、OKX、Bitget、估值领域和 E2E 均有用户/主线程未提交改动。本 Ticket 仅在明确范围内增量编辑，不清理、不覆盖、不重置这些改动。
- 2026-07-30：测试 seam 采用生产适配器公开快照边界、确定性官方响应 HTTP fixture 与所有者浏览器总览/资产卡片边界。
- 2026-07-30：已核对本仓库固定的 Vibe-Nothing-UI revision `46661e55ae04537215a229be49f2ac1bd37a4255`；如需调整状态文案，仅复用现有 `VibeStatusTag`、`VibeNotice`、`vibe-coverage` 与运行时 Token。
- 2026-07-30：官方资料复核确认 OKX `asset-valuation`、Bitget `all-account-balance` 只作总额/分区守恒锚点，不与产品明细相加；OKX Active Orders、Bitget SharkFin/Elite 是明细或产品汇总证据。官方未公开聚合 Earn 与各产品的完整包含矩阵，因此不以差额补造持仓。
- 2026-07-31：真实页面核对发现 Bitget 平台总额已覆盖全部当前资产，但适配器仅因官方全账户总览中的 `futures` 分区为正就降级为 partial，混淆了总额覆盖与普通合约逐仓明细。重新认领本 Issue：仅将 `futures` 作为平台总额层的 aggregate-only 分区纳入；Margin、Loan、普通合约逐仓与资产负债模型仍不在范围内。
- 2026-07-31：修正后保持已核对的 Bitget 权威总额不变；`futures` 仅作为 aggregate-only 产品能力展示，不再次加回金额，也不再自动触发 partial。Margin 和未知正余额账户仍 fail-safe 降级。
- 2026-07-31：生产隔离构建及 24 项 Bitget/估值回归通过。当前 3000 仍持有修改前缓存的生产服务实例，落盘快照仍为 7 个产品并排除 `futures`；必须重启 `pnpm dev` 后执行一次完整资产刷新，不能直接改写 SQLite 伪造验收。
- 2026-07-31：所有者确认 Bitget 平台总额已经覆盖全部资产；重新认领本 Issue，修复分区微小估值偏差被绝对值累加并错误降级为“当前总额不完整”的问题。总额完整性改按整体净残差判断，产品分区偏差不再冒充资产漏算。
- 2026-07-31：Bitget 对账改为先汇总各已覆盖分区的有符号差额，再判断整体净残差；容差为 `max(0.50 USDT, min(平台总额 × 0.01%, 5 USDT))`。Spot `+0.06` 与 Funding `-0.05` 不再累加为 `0.11`，整体净差 `0.11` 也保持总额完整；`100 USDT` 的实质残差仍降级。
- 2026-07-31：隔离 webpack 生产构建通过；Bitget 全流程与估值总览 `24/24 passed`；`pnpm typecheck` 与 `git diff --check` 通过。未请求真实私有账户、未改写 SQLite、未调用外部写端点。

## 答案

- 已将 `coverage.status` 收敛为“当前总额估值完整性”，产品级 `capability` 独立表达逐仓明细、仅汇总或未覆盖；权威总额守恒时，部分产品只有汇总不会再显示“当前估值不完整”。
- OKX 使用官方只读 `GET /api/v5/asset/asset-valuation?ccy=USDT` 作为总额主源，并读取 `GET /api/v5/finance/staking-defi/orders-active` 的 On-chain Earn 当前订单。平台总额不与 Trading、Funding、Earn 或 Active Orders 重复相加；残差、Classic 正余额和读取失败会动态降级并保留证据。
- Bitget Classic 使用官方只读 `GET /api/v2/account/all-account-balance` 的 Spot、Funding、Earn、Bots 分区守恒，并接入 `GET /api/v2/earn/sharkfin/account` 与 `GET /api/v2/earn/elite/assets`。普通 Futures 作为平台总额已覆盖的 aggregate-only 产品展示，不与 Futures Bots 重复相加；Margin 和未知正余额账户仍触发降级。Savings 明细不守恒时保留 Earn 总览本金并标记 `aggregate-only`。
- Bitget 分区对账的微小价格/舍入偏差按整体净残差和动态容差判断，不再把各分区绝对差累加为“未解释资产”；平台总额仍是当前总资产的权威金额。
- 总资产概览和来源卡片已分别显示“当前估值：完整”“产品明细：部分仅汇总”，或在失败时显示具体差额、来源和排除账户。OKX/Bitget 预览范围文案同步更新。
- 未修改历史快照语义，未接入 Longbridge 期权、普通合约、Margin、Loan 净资产，也未调用写端点。

自动化验收：

- `pnpm typecheck`：通过。
- `git diff --check`：通过。
- 当前源码的隔离 Next.js webpack 生产构建：通过。
- OKX、Bitget、估值总览、隐私边界及 Binance 守恒定向回归：`45/45 passed`。
- Futures 汇总语义修正后的 Bitget 全流程与估值总览回归：`24/24 passed`。
- Binance 既有“小额持仓开关”单例单独复跑仍失败：两次 `ArrowRight` 后卡片可访问状态停在宽度 2 格，因此只在 3 格显示的开关不可见。失败位于既有卡片布局/测试时序，不涉及本 Ticket 的适配器、守恒或完整性 UI 文件，本 Ticket 未顺手修改。

人工验收边界：

- 本次未读取真实凭证、未请求真实私有账户，也未记录真实余额。
- 仍需所有者使用确认过的只读 OKX、Bitget 凭证执行一次同一时点刷新，核对平台总额、产品汇总和页面状态后完成真实账户验收。
- 未提交、未推送。
