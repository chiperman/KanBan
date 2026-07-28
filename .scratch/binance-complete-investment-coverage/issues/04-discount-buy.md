# 04 — Discount Buy 当前仓位

**What to build:** 将 Discount Buy 尚未结清的结构化产品本金纳入 Binance 来源，并用账户汇总校验而不重复计算。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] position list 按官方页码完整读取并拒绝不完整或重复页面。
- [x] 仅尚未结清状态进入当前资产，结算后返回的钱包资产不重复。
- [x] sum-holding 只作为守恒证据。
- [x] 当前零仓位与接口不受支持是不同覆盖状态。
- [x] 未知状态明确标记产品不完整。

实现说明：完整读取 `list + total`，当前状态白名单与 Dual 分离；单产品端点失败降级为 unknown，不抹掉其他产品快照。
