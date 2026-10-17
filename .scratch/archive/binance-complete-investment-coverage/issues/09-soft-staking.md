# 09 — Soft Staking 收益叠加

**What to build:** 让 Soft Staking 奖励可以归因到 Binance 平台收益，同时保证符合条件的 Spot/Funding 本金不会被复制成第二份持仓。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] Soft Staking 当前列表只用于覆盖与奖励证据，不创建额外本金。
- [x] 历史奖励与当前本金清晰分离。
- [x] 启用/停用设置端点不进入 allowlist，任何同步路径都不能调用。
- [x] 当前无质押本金但存在历史奖励时不制造当前资产。
- [x] Binance 卡片能说明 Soft Staking 为间接覆盖。

实现说明：allowlist 仅含 `/soft-staking/list`；列表不生成本金，卡片以 indirect 展示，测试明确拒绝 `/set`。
