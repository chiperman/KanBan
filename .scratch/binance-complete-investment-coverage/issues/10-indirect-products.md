# 10 — RFQ、Smart Arbitrage 与间接产品覆盖

**What to build:** 对没有公开专用当前仓位合同的 Dual Investment RFQ、Smart Arbitrage、BNB Vault、Launchpool 和 Megadrop 提供诚实的间接覆盖状态，并用钱包残差发现未知本金。

**Blocked by:** 02 — 钱包守恒与统计不完整；03 — Dual Investment 当前仓位；04 — Discount Buy 当前仓位；05 — BFUSD 与 RWUSD 当前敞口；06 — ETH Staking 经济资产去重；07 — SOL Staking 经济资产去重；08 — On-chain Yields 当前仓位；09 — Soft Staking 收益叠加

**Status:** resolved

- [x] RFQ 不被默认视为普通 Dual Investment 已覆盖。
- [x] Smart Arbitrage 可能出现的 Earn/Trading Bots 正余额会触发不完整提示。
- [x] BNB Vault、Launchpool、Megadrop 不复制底层 BNB 或 Simple Earn 本金。
- [x] 资格、积分、预计空投不作为当前资产，实际到账奖励只在权威钱包计一次。
- [x] 没有公开明细时不使用历史或私有接口猜仓位。

实现说明：RFQ 为 unsupported；Smart Arbitrage/BNB Vault/Launchpool/Megadrop 为 indirect，全部依赖钱包守恒而不制造仓位。
