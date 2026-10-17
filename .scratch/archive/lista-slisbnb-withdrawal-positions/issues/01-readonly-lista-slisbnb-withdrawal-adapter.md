# 01 — 接入只读 Lista slisBNB 提现申请适配器

**What to build:** 在 BNB Smart Chain 观察钱包的已知合约协议仓位适配器中读取 Lista 未领取 slisBNB 赎回申请，并按独立 BNB 仓位展示。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 每次 BSC 持仓刷新读取 `getUserWithdrawalRequests(address)` 与逐项状态，不依赖 slisBNB 余额。
- [x] 每笔申请保留 uuid、`redeeming` 状态、BNB/USD 定价及“锁仓中”/“可领取”状态。
- [x] 普通 slisBNB 保留；空申请与读取失败分别输出明确覆盖信息。
- [x] 受控 RPC 和来源详情浏览器验收通过。

## 答案

- 已增加 BSC 专用 `lista-slisbnb-withdrawal-request` 适配器；空申请、锁仓中、可领取、残留 slisBNB、多地址多申请、读取失败与完整持仓刷新均由受控 RPC 覆盖。
- 已将提交合入实际实例并完成真实 BSC 单来源刷新：读取到 1 笔锁仓中的 Lista 申请；普通 BNB/BEP-20 与残留 slisBNB 仍保留。
- 已按申请在 2026-08-20 的链上创建时间确定修正范围：2026-08-20 至 2026-08-23 的受影响 BSC 基准和趋势均以各观测原有的 BNB 隐含价格重算并同步总资产聚合；未使用今日价格倒灌。

## 评论

- 2026-08-21：委托已确认自动化验收边界为生产 EVM 适配器的受控 RPC 与来源详情；真实已接入来源另做不暴露地址的手动刷新验证。
- 2026-08-23：真实来源刷新确认 Lista 仓位可读；历史修正限定为 BSC 观察钱包 2026-08-21、2026-08-22 两天，SQLite 完整性检查通过。
- 2026-08-23：按链上创建时间复核后，将修正范围扩展至 2026-08-20 的基准和趋势、以及 2026-08-23 的日初基准；更早观测均早于申请创建时间，无需修正。
