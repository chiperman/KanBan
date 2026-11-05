# 领域决策索引

先读 [CONTEXT](../../CONTEXT.md) 中相关术语与业务边界，再按主题读取下列决策。本文只提供导航，状态、替代范围和例外以各篇原文为准；实现入口见 [当前能力与源码导航](../current-baseline.md)。

| 决策 | 阅读重点 |
| --- | --- |
| [0001 · 区分当日基准与每日趋势观测](0001-separate-daily-baseline-and-trend-observation.md) | 部分被后续规则替代；保留记录隔离与不补造历史的原则。批次写入门槛差异见 [backlog](../backlog.md#组合趋势写入合同与实现核定) |
| [0002 · 历史趋势使用观测时汇率](0002-use-observation-time-exchange-rates-for-history.md) | 历史汇率、缺失货币对与展示方向；“日初基准”术语按 CONTEXT 的“当日基准”理解 |
| [0003 · 趋势图采用 Recharts](0003-adopt-recharts-for-total-asset-trend-ui.md) | 已采用；缺失值、金额精度、键盘交互与历史验收范围 |
| [0004 · 从外部资金进出派生投资盈亏](0004-derive-portfolio-performance-from-external-cashflows.md) | 资金与资产独立的原则保留；全局资金归属和 USD 展示规则被 0007 替代 |
| [0005 · 已知 EVM 合约使用协议仓位适配器](0005-use-protocol-position-adapters-for-known-evm-contracts.md) | 只读协议仓位的识别、估值、去重与覆盖边界 |
| [0006 · 独立来源的投资历史与收益曲线](0006-keep-imported-investment-history-source-scoped.md) | 原件、身份校验和原币种原则保留；来源本金与资金维护规则被 0007 替代 |
| [0007 · 统一三本投资账](0007-unify-investment-books.md) | 已采用；美股、A股、虚拟货币的资金归属、历史衔接、收益及备份合同 |

不要仅按编号或文件名决定效力；被替代的部分用于理解历史，不能作为恢复旧行为的依据。尚未核定的问题统一进入 [backlog](../backlog.md)，不在索引中维护第二份待办。新增或替代决策时同步本索引，维护规则见 [文档入口](../README.md)。
