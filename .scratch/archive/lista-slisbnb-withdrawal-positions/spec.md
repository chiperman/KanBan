# Lista slisBNB 提现申请

在 BNB Smart Chain 观察钱包中，将 Lista `slisBNB` 赎回后尚未领取的原生 BNB 申请作为只读链上协议仓位读取；不改变 Lido 和普通 BEP-20 余额读取。

## 验收边界

- 每次 BSC 持仓刷新读取 `ListaStakeManager` 的未领取申请，不依赖剩余 slisBNB 余额。
- 每笔申请以稳定 uuid 作为独立 BNB 仓位，状态为“锁仓中”或“可领取”，并使用 BNB/USD 参考价。
- 普通 slisBNB 余额保留，不与提现申请重复计价。
- 空申请明确覆盖；读取失败保留普通资产并标记未知/部分覆盖。
- 受控 RPC 覆盖空申请、锁仓中、可领取、残留 slisBNB、多地址多申请和读取失败；来源详情展示覆盖一个状态仓位。
