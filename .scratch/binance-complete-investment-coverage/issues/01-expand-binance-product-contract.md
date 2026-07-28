# 01 — 扩展 Binance 产品与覆盖状态合同

**What to build:** 让 Binance 持仓可以表达产品身份、仓位状态、覆盖能力和数据新鲜度，同时保持旧四分区快照、SQLite 数据与现有界面可读，为后续产品接入提供不中断现有功能的扩展合同。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 新产品元数据能从受控来源贯穿预览、持久化、读取和 Binance 卡片。
- [x] 覆盖能力与数据新鲜度是独立状态，能表达当前但不完整、过期但已知等组合。
- [x] 未包含新元数据的旧快照继续可读，并明确标记为旧版或未知覆盖。
- [x] 现有 Spot、Funding、Flexible Earn、Locked Earn 行为与自动测试保持通过。
- [x] 新合同不把凭证、签名或私密原始响应写入业务数据。

实现说明：新增产品/仓位/覆盖合同、SQLite v3 `coverage_json` 迁移、旧 Binance 快照 `unknown` 兼容状态，以及卡片覆盖提示。验收测试见 `e2e/binance-source.spec.ts` 与 `e2e/sqlite-business-data-persistence.spec.ts`。
