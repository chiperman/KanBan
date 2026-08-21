# Lido 提现申请仓位

## Notes

Ethereum 观察钱包目前会将 Lido Withdrawal Queue 的 `unstETH` 申请 NFT 当成缺少 ERC-20 `decimals` 的合约，导致真实提现申请不进入持仓或总额。

## Decisions-so-far

- 使用已配置 Ethereum RPC 的 `eth_call`；不需要 Lido API Key、钱包连接或签名。
- 建立已知 EVM 合约的协议仓位适配器；第一项是 Lido 提现申请，不做全量 DeFi 扫描。
- 测试边界为生产 EVM 适配器的受控 RPC 输出，以及来源详情页可见的持仓与完整性状态。
- 01 已实现并解决：可领取申请以 `getClaimableEther` 的精确 ETH 数量估值；受控生产适配器回归 17/17、来源详情展示验收 1/1 通过。详见 `issues/01-readonly-lido-withdrawal-adapter.md`。
- 02 已解决：验证 2026-08-20 只有 Ethereum 观察钱包因 Lido 缺失而不完整后，以原趋势时间前的历史区块和距快照 146 秒的已核验 CoinGecko ETH/USD 样本回补每日趋势；趋势已完整，日初基准保持原始事实。详见 `issues/02-backfill-2026-08-20-trend-observation.md`。

## Fog

- 真实地址的首轮只读验收将在自动化完成后由所有者确认；不在自动化中请求真实链上数据。
