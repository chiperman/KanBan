# 06 — ETH Staking 经济资产去重

**What to build:** 展示 Binance ETH Staking 的真实当前敞口和赎回状态，同时保证 ETH 等值、BETH、WBETH 与 Spot 包装代币只代表一份经济资产。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] ETH Staking 当前账户通过精确只读端点读取。
- [x] holdingInETH、BETH、WBETH 组成和 Spot 余额按一个本金主源去重。
- [x] 待赎回资产保持可见且不与已返回 Spot 的资产重叠。
- [x] staking 奖励与本金分开。
- [x] 无法证明包装代币归属时显示不完整而不是猜测。

实现说明：无 Spot 包装币时以账户 ETH 等值为主源；存在 BETH/WBETH 时保留 Spot 包装币并跳过账户等值，统一经济资产 key。
