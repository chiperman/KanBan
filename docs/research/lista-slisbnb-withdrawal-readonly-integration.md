# Lista slisBNB 提现申请只读接入调研

调研日期：2026-08-21。范围仅为 BNB Smart Chain 观察钱包中 Lista `slisBNB` 赎回后、等待或可领取的 BNB 提现申请；不连接钱包、不签名、不发交易、不读取私钥或助记词。

## 结论

Lista 的 `slisBNB` 提现申请是可以由现有 BSC RPC 直接读取的链上协议仓位，不需要 Lista API Key。

部署在 BNB Smart Chain 的 `ListaStakeManager` 为 `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6`。它保存每个地址仍未领取的申请，公开提供：

1. `getUserWithdrawalRequests(address)`：返回该地址尚未领取的申请 `{ uuid, amountInSnBnb, startTime }[]`；
2. `getUserRequestStatus(address, index)`：返回该数组索引的 `(isClaimable, amount)`，其中 `amount` 是实际可领取的 BNB 数量。

已领取申请会从合约中该地址的数组删除，因此只需读取当前数组，不应把已领取 BNB 继续计为仓位。

## 业务语义

这是“链上协议仓位”，不是钱包原生 BNB 余额，也不是普通 `slisBNB` 余额：

- `waiting`：申请存在但 `isClaimable = false`；以 `amount` BNB × BNB/USD 参考价计入资产，状态显示“锁仓中”或“等待释放”；
- `claimable`：申请存在且 `isClaimable = true`；以 `amount` BNB × BNB/USD 参考价计入资产，状态显示“可领取”；
- `claimed`：不在 `getUserWithdrawalRequests` 返回中，因此不再计入。

Lista 文档说明赎回通常需等待 7–15 天，合约并不返回确定解锁时间。界面最多可展示基于 `startTime + 7 天` 的“最早预计可领取时间”，必须继续以 `getUserRequestStatus` 的链上结果作为是否可领取的权威判断。

普通钱包中剩余的 `slisBNB` 是独立的流动性质押代币，仍应按 ERC-20/BEP-20 持仓保留。申请中的 BNB 在请求时已转入 `ListaStakeManager`，所以二者不重复计价；适配器不得把整个 `slisBNB` 合约从普通代币读取中排除。

## 最小实现边界

在 `src/server/asset-sources/ethereum.ts` 的协议仓位适配器中增加 BSC 专用的 `lista-slisbnb-withdrawal-request`：

1. 对每个 BSC 观察地址通过现有 `eth_call` 读取 `getUserWithdrawalRequests`；
2. 为每个数组索引读取 `getUserRequestStatus`；
3. 创建独立 BNB 持仓：
   - `sourceAsset`: `evm:56:lista-slisbnb-withdrawal:<uuid>`
   - `sourceProduct`: `lista-slisbnb-withdrawal-request`
   - `providerPositionId`: `uuid`
   - `providerPositionState`: `锁仓中` 或 `可领取`
   - `positionState`: `redeeming`
   - `priceAsset`: `evm:56:native`
4. 该适配器应在 BSC 每次持仓刷新时运行，不能仅以钱包仍有正数 `slisBNB` 余额作为触发条件；用户可在申请后持有零 `slisBNB`。
5. RPC 或 ABI 读取失败时，保留普通 BNB/BEP-20 持仓，把 `lista-slisbnb-withdrawal-request` 的覆盖状态标为 `unknown`，并把整份快照标为部分覆盖；不得把缺失仓位默认为零。

## 验收场景

1. BSC 地址没有申请：持仓为空，产品覆盖显示“未发现未领取申请”。
2. 一个等待申请：显示一笔 BNB 仓位，状态“锁仓中”，由 BNB/USD 估值。
3. 一个可领取申请：显示一笔 BNB 仓位，状态“可领取”。
4. 同时剩余 `slisBNB`：普通 `slisBNB` 与提现申请同时显示，金额分别计价。
5. 多地址、多申请：按 `uuid` 独立显示，不重复计价。
6. 合约读取失败：普通余额保留，数据健康明确显示 Lista 仓位读取不足。

## 与现有 Lido 的关系

Ethereum 的 Lido 提现申请与此处 Lista 提现申请同属“等待/可领取的原生币债权”，但合约数据模型不同：

- Lido 使用 `unstETH` ERC-721 请求 NFT，按请求 ID 查询；
- Lista 使用地址上的申请数组和数组索引查询，不使用 NFT。

两者应共用“链上协议仓位”的展示与覆盖语义，但各自保留独立读取、ABI 解码和去重规则。

## 一手资料

- Lista 官方开发者文档，合约地址：
  https://docs.bsc.lista.org/for-developer/liquid-staking-slisbnb/smart-contract
- Lista 官方开发者文档，提现/解绑流程：
  https://docs.bsc.lista.org/for-developer/liquid-staking-slisbnb/mechanics
- Lista 官方用户文档，赎回等待 7–15 天：
  https://docs.bsc.lista.org/user-guide/liquid-staking-slisbnb/redeem-bnb-from-slisbnb
- Lista DAO 官方合约源码：
  https://github.com/lista-dao/synclub-contracts/blob/master/contracts/ListaStakeManager.sol
- Lista DAO 官方接口源码：
  https://github.com/lista-dao/synclub-contracts/blob/master/contracts/interfaces/IStakeManager.sol
- Lido 官方 Withdrawal Queue 文档：
  https://docs.lido.fi/contracts/withdrawal-queue-erc721/
