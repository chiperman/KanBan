# 01 — 接入只读 Lista slisBNB 提现申请适配器

**What to build:** 在 BNB Smart Chain 观察钱包的已知合约协议仓位适配器中读取 Lista 未领取 slisBNB 赎回申请，并按独立 BNB 仓位展示。

**Blocked by:** None — can start immediately

**Status:** ready-for-human

- [x] 每次 BSC 持仓刷新读取 `getUserWithdrawalRequests(address)` 与逐项状态，不依赖 slisBNB 余额。
- [x] 每笔申请保留 uuid、`redeeming` 状态、BNB/USD 定价及“锁仓中”/“可领取”状态。
- [x] 普通 slisBNB 保留；空申请与读取失败分别输出明确覆盖信息。
- [x] 受控 RPC 和来源详情浏览器验收通过。

## 答案

- 已增加 BSC 专用 `lista-slisbnb-withdrawal-request` 适配器；空申请、锁仓中、可领取、残留 slisBNB、多地址多申请、读取失败与完整持仓刷新均由受控 RPC 覆盖。
- 当前本机运行实例尚未载入本工作树代码，且可用浏览器没有所有者会话；真实已接入来源的单来源刷新需在合入并登录后完成。

## 评论

- 2026-08-21：委托已确认自动化验收边界为生产 EVM 适配器的受控 RPC 与来源详情；真实已接入来源另做不暴露地址的手动刷新验证。
