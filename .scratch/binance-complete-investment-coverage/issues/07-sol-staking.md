# 07 — SOL Staking 经济资产去重

**What to build:** 展示 Binance SOL Staking 的真实当前敞口和赎回状态，同时保证 SOL 等值、BNSOL、Boost 奖励与 Spot 包装代币只代表一份经济资产。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] SOL Staking 当前账户通过精确只读端点读取。
- [x] holdingInSOL、BNSOL 与 Spot 余额按一个本金主源去重。
- [x] 待赎回资产保持可见且不重复。
- [x] 普通奖励、Boost 奖励与本金分开。
- [x] 无法证明包装代币归属时显示不完整而不是猜测。

实现说明：无 Spot BNSOL 时以 `holdingInSOL` 为主源；存在 BNSOL 时使用 Spot 包装币并跳过账户 SOL 等值，奖励字段不进入本金。
