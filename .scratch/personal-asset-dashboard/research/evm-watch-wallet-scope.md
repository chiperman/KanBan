# EVM 观察钱包范围决策

- 决策日期：2026-07-26（Asia/Shanghai）
- 对应 Ticket：13 — Ethereum 与 BNB Smart Chain 观察钱包
- 决策性质：根据所有者真实使用范围收缩首版，不是新增技术承诺

## 结论

当前版本只支持所有者实际使用的两条链：

- Ethereum：ETH 与 ERC-20
- BNB Smart Chain：BNB 与 BEP-20

两条链都属于 EVM 生态，应由一个链配置驱动的观察钱包适配器实现。链配置至少隔离 chain ID、RPC、原生币、CoinGecko 网络标识与合约地址空间；相同十六进制地址、同名或同符号代币不得跨链合并。

Base、Arbitrum 与 Solana 不进入当前版本。BNB Smart Chain 从原 Ticket 14 合并到 Ticket 13；Ticket 14 不再单独实施。Solana 需要独立的账户与 SPL Token 模型，在没有真实使用需求时不承担其实现和维护成本，因此 Ticket 15 延后。

## 复杂度判断

- EVM 原生币余额读取较简单。
- 同质化代币的发现、元数据、合约精度、垃圾代币、分页和参考定价才是主要复杂度。
- Ethereum 与 BNB Smart Chain 可以共享大部分领域映射、未估值规则、刷新、过期数据、快照和浏览器验收；不应复制两套业务代码。
- Solana 无法复用 EVM 的地址、RPC 与代币账户模型，提前支持会显著增加首版范围。

## 官方能力核对

### 普通 JSON-RPC 的边界

Ethereum 标准 JSON-RPC 的 `eth_getBalance` 可以读取指定地址的原生币余额，`eth_call` 可以读取指定合约状态，但标准方法没有“列出此地址持有的全部 ERC-20/BEP-20”能力。因此不能只靠一个普通公共 RPC 自动发现全部同质化代币，也不能让 CoinGecko 反向充当余额索引器。[Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)

BNB Smart Chain mainnet 的官方 chain ID 是十进制 `56`（十六进制 `0x38`），其 JSON-RPC 与 Go-Ethereum API 基本兼容；Ethereum mainnet chain ID 固定为 `1`。适配器以这些 chain ID 作为资产身份的一部分。[BNB Chain JSON-RPC](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)

### 最终 RPC / 索引选择

首版使用 Alchemy 的链级 HTTPS endpoint：Ethereum `eth-mainnet` 与 BNB Smart Chain `bnb-mainnet`。共享适配器对两条链执行同一套读取流程：

1. 标准 `eth_getBalance(address, "latest")` 读取 ETH 或 BNB。
2. `alchemy_getTokenBalances(address, "erc20", options)` 发现 ERC-20/BEP-20 余额。
3. 按返回的 `pageKey` 连续读取，直到没有下一页；设置单页上限与总页安全上限，任何中途失败都不提交部分快照。
4. 对正余额合约调用 `alchemy_getTokenMetadata` 取得 symbol、name 与 decimals，再以十进制安全算法还原数量。

Alchemy 官方说明 Token API 可返回地址交互过的 ERC-20 余额；BNB Smart Chain 官方 Alchemy 能力页明确支持 Token API，链 endpoint 为 `https://bnb-mainnet.g.alchemy.com/v2/API_KEY`。[Token Balances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances) · [Token API](https://www.alchemy.com/docs/reference/token-api-overview) · [BNB Smart Chain API](https://www.alchemy.com/docs/bnb-smart-chain/bnb-smart-chain-api-overview) · [支持链与 endpoint](https://www.alchemy.com/docs/reference/node-supported-chains)

Alchemy API Key 只通过服务端环境配置进入完整 RPC URL。浏览器响应、HTML、日志、普通来源记录和快照都不得包含完整 RPC URL 或 Key。自动测试只使用受控传输替身，不调用真实地址或付费 API。

### CoinGecko 的职责

CoinGecko 只负责独立参考定价：原生币按 coin id 查询，合约代币按 network + contract address 查询。它不提供本实现所需的钱包余额枚举，因此不能替代 RPC/索引层。Ethereum 使用 CoinGecko network `eth`，BNB Smart Chain 使用 `bsc`；缺失或异常价格只让对应资产标记未估值，不抹掉数量，也不把价格当成零。[CoinGecko Onchain Token Pricing](https://docs.coingecko.com/docs/defi-onchain-analytics) · [Token Data by Address](https://docs.coingecko.com/reference/token-data-contract-address)

## 限流、分页与失败处理

- 同一来源内顺序读取地址和分页，元数据请求使用受控并发，避免无界请求风暴。
- 服务端对单页数量、总页数、地址数量和合约数量设置上限；遇到重复 page key、无效数量/decimals、429、超时或 RPC error 时整次余额同步失败。
- 30 秒价格周期只请求 CoinGecko，不重新读取 RPC/Token API；5 分钟余额周期才执行原生币与代币余额发现。
- 每条链保存为独立来源。Ethereum 的 RPC/索引/定价失败不阻止 BNB Smart Chain 更新，反之亦然；余额读取失败保留最后成功快照并标记过期。
- CoinGecko 单个报价缺失是资产级未估值；整个价格请求失败时保留数量，价格周期不得把来源误置为零。
- 只消费原生币与同质化代币余额，不调用 NFT、staking、LP、lending 或协议仓位 API，也不解析协议底层资产。

## 当前验收边界

- 只接受公开地址，不出现钱包连接、签名、助记词、私钥或 MPC 材料入口。
- 只解析原生币与直接持有的 ERC-20/BEP-20 数量；NFT、质押、LP、借贷和其他 DeFi 仓位仍排除。
- CoinGecko 作为独立参考价格来源；缺价资产保留数量并标记未估值，不按零计入总额。
- Ethereum 与 BNB Smart Chain 分别覆盖正常、空钱包、同名代币、不同 decimals、分页、定价缺失和 RPC/索引失败样本。
- Base、Arbitrum、Solana 与 SPL Token 不属于当前完成条件，也不得阻塞 Ticket 18 发布验收。
