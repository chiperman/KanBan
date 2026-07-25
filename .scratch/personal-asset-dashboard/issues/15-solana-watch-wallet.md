# 15 — Solana 观察钱包

**What to build:** 让所有者只凭公开 Solana 地址读取 SOL 与 SPL Token，并将其接入与 EVM 观察钱包一致的估值、刷新和历史体验，同时保持 Solana 独立的资产身份语义。

**Blocked by:** 13 — Ethereum 观察钱包与参考定价

**Status:** ready-for-agent

- [ ] 所有者可以通过统一来源流程添加并预览一个或多个公开 Solana 地址。
- [ ] 系统只接受公开地址，不请求任何助记词、私钥、签名或钱包连接。
- [ ] 同步读取 SOL 和 SPL Token 余额，并以 mint 地址标识代币。
- [ ] CoinGecko 按 Solana mint 提供参考价格，并记录来源与更新时间。
- [ ] 无价格代币遵循未估值资产规则，不被当作零资产。
- [ ] NFT、质押、LP、借贷和其他 DeFi 仓位不进入结果。
- [ ] Solana 观察钱包完整接入总资产、分布、详情、刷新、过期数据和每日快照流程。
- [ ] 自动测试覆盖 SOL、SPL Token、同符号不同 mint、空钱包和 RPC 部分失败。

