# Lido 提现申请仓位

## 问题

Lido `unstETH` 是提现申请 NFT，不是 ERC-20。现有 Ethereum 观察钱包按 ERC-20 metadata 读取它时无法取得 `decimals`，因此把真实资产留在“读取受限资产”中，不计入来源总额。

## 方案

在发现 Lido Withdrawal Queue 合约痕迹时，通过现有 Ethereum RPC 的只读 `eth_call` 调用 `getWithdrawalRequests(address)` 与 `getWithdrawalStatus(uint256[])`。每笔未领取申请成为独立持仓：排队中按申请时的 stETH 数量和 ETH 参考价估值；可领取状态通过 `getLastCheckpointIndex`、`findCheckpointHints` 和 `getClaimableEther` 读取精确的预留 ETH 数量后估值。合约读取失败时不删除其他 ETH/ERC-20 持仓，且将该合约继续标记为未估值，使总额明确不完整。

## 不在范围内

- 钱包连接、签名、领取、转移或任何写链交易。
- 其他 DeFi 协议、全量 NFT/DeFi 扫描、历史事件回放。
- 借贷、LP、杠杆或负债估值。

## 测试边界

1. 生产 EVM 适配器在受控 RPC 下输出 Lido 独立持仓、覆盖状态，并且只发 JSON-RPC 读取调用。
2. 来源详情页展示“Lido 提现申请”的数量、状态与市值；不再显示为无法读取的 ERC-20。
