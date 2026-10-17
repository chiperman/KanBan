# 03 — Dual Investment 当前仓位

**What to build:** 将 Binance Dual Investment 的未结算本金完整纳入个人资产看板，并在结算前后保持产品状态、预计收益和返回 Spot 的本金只出现一次。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] positions 完整分页，已结算历史不会掩盖后续页面的当前仓位。
- [x] 仅未结算本金进入当前资产，settled/refund 记录不重复计入。
- [x] 预计收益与已实现平台盈亏分离。
- [x] 未知状态 fail closed 并使产品覆盖不完整。
- [x] 账户汇总只用于对账，逐仓明细是本金主源。

实现说明：兼容官方 `list + total` 分页，以 `id` 保留精确仓位身份；当前本金不把 APR/预计收益写成已实现盈亏。
