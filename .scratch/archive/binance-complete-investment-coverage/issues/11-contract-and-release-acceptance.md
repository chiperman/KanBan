# 11 — 收缩旧四分区假设并完成跨产品验收

**What to build:** 在所有产品切片完成后移除 Binance 对旧四分区推断的依赖，并从来源预览、刷新、卡片、总资产、持久化、隐私和真实账户完成一次跨产品发布验收。

**Blocked by:** 02 — 钱包守恒与统计不完整；03 — Dual Investment 当前仓位；04 — Discount Buy 当前仓位；05 — BFUSD 与 RWUSD 当前敞口；06 — ETH Staking 经济资产去重；07 — SOL Staking 经济资产去重；08 — On-chain Yields 当前仓位；09 — Soft Staking 收益叠加；10 — RFQ、Smart Arbitrage 与间接产品覆盖

**Status:** resolved

- [x] Binance 不再从旧 sourceAccount 四值推断完整产品范围，旧快照仍保持兼容。
- [x] holdings 刷新只调用批准的完整只读 allowlist，prices 刷新不调用私密产品端点。
- [x] onboarding、失败保留、日快照、卡片和总资产对完整/不完整/过期状态行为一致。
- [x] 自动化覆盖分页、未知状态、去重、钱包守恒、排除钱包、隐私与持久化迁移。
- [x] 使用所有者现有专用只读 Key 完成当前可验收产品的真实同步与钱包对账。
- [x] RFQ/Smart Arbitrage 的未来真实参与验收边界和产品真实性文档同步完成。

实现说明：2026-07-28 用现有专用只读 Key 完成脱敏真实验收：17 个产品覆盖声明、1 条当前 Dual Investment 仓位、钱包守恒、无正余额排除钱包、无未解释残差；RFQ/Smart Arbitrage 实际参与后的复验仍是明确的人工作业边界。
