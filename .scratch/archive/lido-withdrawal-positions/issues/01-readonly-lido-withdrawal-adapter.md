# 01 — 接入只读 Lido 提现申请适配器

**What to build:** 在 Ethereum 观察钱包中增加已知合约的协议仓位适配器，先读取 Lido Withdrawal Queue 的未领取提现申请，并在来源详情展示真实 ETH 仓位。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Lido `unstETH` 不再按 ERC-20 `decimals` 读取。
- [x] 每笔未领取申请有稳定仓位标识、数量、ETH 参考价和“排队中/可领取”状态。
- [x] 适配器失败时保留其他钱包持仓，并把已发现的 Lido 合约标为未估值。
- [x] 价格刷新保留该仓位身份，仅重估 ETH 价格。
- [x] 生产适配器和来源详情页的受控测试通过，且请求列表中没有签名、转账、NFT 扫描或写链调用。

## 答案

- 已在 Ethereum 观察钱包实现 Lido Withdrawal Queue 的只读协议仓位适配器。排队中申请按申请时的 stETH 数量估值；可领取申请使用 `getClaimableEther` 返回的精确 ETH 数量估值。
- 受控生产适配器回归通过 17/17，来源详情页展示验收通过 1/1。

## 评论

- 2026-08-21：所有者确认开始实施；自动化边界为生产 EVM 适配器受控 RPC 与来源详情页。
