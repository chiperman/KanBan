# 13 — Ethereum 与 BNB Smart Chain 观察钱包

**What to build:** 用一个共享的 EVM 观察钱包闭环支持所有者实际使用的 Ethereum 与 BNB Smart Chain。所有者只凭公开地址读取 ETH、BNB、ERC-20 与 BEP-20 余额，并通过独立参考价格纳入总资产；不连接钱包、不签名、不接触任何密钥。Base、Arbitrum 与 Solana 不进入当前版本。

**Blocked by:** 07 — 估值与资产分布真实性；08 — 自动刷新与过期数据

**Status:** ready-for-human

- [x] 所有者可以通过同一个统一来源流程选择 Ethereum 或 BNB Smart Chain，并添加、预览一个或多个公开地址。
- [x] 系统只接受公开地址，不提供粘贴助记词、私钥、MPC 材料或连接钱包的入口。
- [x] 一个共享 EVM 适配器通过链配置支持两条链，不为 Ethereum 与 BNB Smart Chain 复制两套业务流程；配置固定 Ethereum mainnet chain ID `1` 与 BNB Smart Chain mainnet chain ID `56`。
- [x] Ethereum 同步 ETH 与 ERC-20；BNB Smart Chain 同步 BNB 与 BEP-20，并以 `chain ID + native` 或 `chain ID + contract address` 标识资产，不仅依赖符号。
- [x] 相同地址、同名或同符号代币在不同链或不同合约上保持独立，不被错误合并。
- [x] CoinGecko 作为观察钱包初始参考价格来源，价格结果记录来源与更新时间。
- [x] 无可靠参考价格的代币按未估值资产显示，保留数量但不计入数值总额。
- [x] NFT、质押、LP、借贷和其他 DeFi 仓位不进入结果。
- [x] 30 秒价格周期只更新参考价格，5 分钟余额周期才读取链上原生币和同质化代币余额。
- [x] EVM 观察钱包卡片接入总资产、分布、详情、刷新、过期数据、每日快照和访客隐私边界；每条链是独立来源，单链失败不破坏另一来源。
- [x] 自动测试分别使用 Ethereum、BNB Smart Chain RPC/索引与参考价格样本验证原生币、同质化代币、精度、分页、跨链同名资产、空钱包、缺价和部分失败，不调用真实地址或付费 API。
