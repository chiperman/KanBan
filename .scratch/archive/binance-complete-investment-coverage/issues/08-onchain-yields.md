# 08 — On-chain Yields 当前仓位

**What to build:** 将 On-chain Yields Locked 当前本金纳入 Binance 来源，并在账户汇总存在无法展开的 Flexible 余额时明确显示明细不完整。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] Locked positions 完整分页并按当前状态计入本金。
- [x] account 汇总只用于对账，不与 Locked 明细相加。
- [x] redeeming 资产保持可见且不重复。
- [x] Flexible 汇总无法被逐仓解释时标记 aggregate-only/partial。
- [x] 历史订阅、赎回和奖励记录不当作当前本金。

实现说明：读取 Locked `rows + total` 当前仓位；`totalFlexibleAmountInUSDT` 为正时只保留聚合证据并标记 partial。
