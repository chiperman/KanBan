# 02 — 钱包守恒与统计不完整

**What to build:** 使用 Binance 官方钱包总览对已解释持仓进行来源级守恒，让所有者在出现未知 Earn 残差或正余额排除钱包时看到明确的“统计不完整”，而不是可信度不足的同步成功。

**Blocked by:** 01 — 扩展 Binance 产品与覆盖状态合同

**Status:** resolved

- [x] onboarding 预览和 holdings 刷新都执行钱包守恒检查。
- [x] 在精度容差内的残差视为守恒，超出容差的残差保留聚合证据并标记不完整。
- [x] Margin、Futures、Options、Trading Bots 等排除钱包为正时被披露但不加入投资资产总额。
- [x] Binance 卡片、资产分布与总资产概览传播不完整状态。
- [x] 钱包汇总不会与逐仓明细重复计入本金。

实现说明：以 Spot/Funding/Earn 钱包 BTC 汇总做 0.1%（最低 1 USDT）守恒，对残差和排除钱包 fail closed；卡片、总览和日快照均传播 partial。
