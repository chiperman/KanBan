# 05 — BFUSD 与 RWUSD 当前敞口

**What to build:** 让 BFUSD 与 RWUSD 的官方当前账户敞口在存在时进入 Binance 来源，并在多账户模式下避免与 Futures 或 Portfolio Margin 重复。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] BFUSD 与 RWUSD 当前账户端点均纳入精确只读 allowlist。
- [x] 非零敞口显示为独立产品持仓，零敞口不制造零资产卡片。
- [x] 收益字段不与本金重复相加。
- [x] 检测到可能重复的账户模式时覆盖状态变为不完整而非盲加。
- [x] 价格缺失时保留身份和数量并遵循未估值资产规则。

实现说明：本金只读取 `bfusdAmount`/`rwusdAmount`，收益字段不相加；Futures/Portfolio 等正余额通过排除钱包提示 partial。
