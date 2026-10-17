# Lido 提现申请只读接入调研

调研日期：2026-08-21。范围仅为 Ethereum 观察钱包中 Lido stETH 提现申请的资产识别与估值；不连接钱包、不签名、不发交易、不读取私钥或助记词。

## 结论

**不需要申请 Lido API Key。** Lido 提现申请的数据保存在 Ethereum 主网的 Withdrawal Queue 合约中。看板可通过已配置的 Ethereum RPC 发送只读 `eth_call`，读取公开地址拥有的申请编号和申请状态。

项目已有 Ethereum RPC URL 与 CoinGecko 配置：前者用于读取合约，后者继续提供 ETH/USD 参考价。因此，正常的单地址、按刷新周期读取不需要新增第三方账号或密钥。

## 最小读取流程

1. 对公开地址调用 `getWithdrawalRequests(owner)`，得到该地址持有的提现申请编号。
2. 对编号调用 `getWithdrawalStatus(requestIds)`，得到每笔申请的状态与请求 ETH 数量。
3. 只把尚未领取的申请计入资产：排队中按申请时的 `amountOfStETH` × ETH/USD 参考价估值；可领取状态必须先通过 `getLastCheckpointIndex`、`findCheckpointHints` 和 `getClaimableEther` 读出精确的预留 ETH 数量，再按 ETH/USD 参考价估值。已领取的申请不再计入。
4. 若相应 stETH 仍作为普通 ERC-20 持仓被读到，必须按申请的实际状态处理，避免“stETH 与提现申请”重复计价。
5. RPC、合约响应或 ETH 价格缺失时，保留已知持仓并明确标注“DeFi 仓位数据不足”；不得把总资产伪装为完整。

## 需要建模的状态

Lido 提现申请 NFT 不是普通 ERC-20。它代表一笔正在排队或可领取的 ETH 债权，至少应区分：

- `pending`：申请仍在队列中，按请求的 ETH 数量估值；
- `claimable`：已可领取但尚未领取，按链上 `getClaimableEther` 返回的精确 ETH 数量估值；
- `claimed`：已领取，不再作为仓位计入。

领取操作本身是写链交易，本项目不实现也不调用。

## 何时才需要额外 Key 或服务

以下情形才可能需要升级现有 RPC 服务或增加索引服务，而不是 Lido Key：

- 当前 RPC 不支持或限流 `eth_call`，无法稳定读取合约；
- 需要高频刷新、大量地址，超过现有 RPC 套餐配额；
- 后续要支持很多协议、复杂 LP、借贷、历史事件回放，需要索引服务来降低链上扫描成本。

第一阶段没有必要接入第三方 DeFi 聚合器，更不应为单一 Lido 情况硬编码一个静默兜底。

## 推荐的实现边界

以“链上协议仓位适配器”承接，而不是将 Lido 当作 ERC-20 的特殊补丁。Lido 适配器只负责识别、读取、估值、状态和去重规则；以后真实出现 ERC-4626 金库、LP 或借贷仓位时，再增加对应适配器。借贷必须同时建模资产与负债，LP 必须避免与底层代币重复计价。

调研时产品基线尚未纳入此范围。后续已采用 [协议仓位适配器决策](../adr/0005-use-protocol-position-adapters-for-known-evm-contracts.md)，现行范围见 [CONTEXT](../../CONTEXT.md)；本文保留调研背景，不再作为待立项方案，也不要求补建 Ticket。

## 来源

- Lido 官方合约文档：<https://docs.lido.fi/contracts/withdrawal-queue-erc721/>
- Lido 官方 Withdrawal Queue 合约源码：<https://github.com/lidofinance/core/blob/master/contracts/0.8.9/WithdrawalQueueERC721.sol>
- Ethereum JSON-RPC `eth_call` 规范：<https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_call>
