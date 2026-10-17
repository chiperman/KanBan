# 06 — 按来源和日期限制历史读取并消除逐行子查询

Status: resolved
Type: task
Priority: 中
Phase: 本迭代处理
Evidence: 确定存在查询放大；实际交互时延需测量
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 08](../../../active/project-health-hardening-delivery/issues/08-bound-single-day-observation-write.md)、[执行 09](../../../active/project-health-hardening-delivery/issues/09-bound-source-detail-reads.md)、[执行 10](../../../active/project-health-hardening-delivery/issues/10-batch-formal-settlement-history.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

来源、每日趋势观测和正式日结读取逐条查子记录；写入单日观测先读全部历史寻找当天。来源详情也读取所有来源及完整历史，超出当前页面所需。

**审查证据：** 审查静态查询形态为来源 2N+1、每日观测 D+1、正式日结 2D+1；3650 天合成样例读取准备了 3651 条语句，单日更新 3657 条。单次暖缓存约 26ms 不构成性能 SLO 或线上体验结论。

**位置（模块/函数）：** listSourcesSync、listDailyObservationsSync、listFormalDailySettlements、recordDailyAssetObservation，以及来源详情页的数据加载。

## Solution

避免历史规模增长时读取和单日写入成本持续线性放大。

**修改风险：** 低至中：涉及查询接口与结果组合。

## User Stories

1. 作为所有者，我希望按来源和日期限制历史读取并消除逐行子查询，以便避免历史规模增长时读取和单日写入成本持续线性放大。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 先将单日存在性/读取改成按日定位，并批量读取本次父集合对应子记录；避免为一日更新读取全部历史。
- 再给查询端口加入来源和连续日期范围，详情页的重型记录仅请求当前来源与选定区间；汇率和统一刷新注册确需全局信息时提供最小摘要，不能因缩小查询而改变汇率选择或刷新行为。全历史导出仍有显式完整路径。
- 保持排序、金额精度、历史汇率、空日期与不完整观测语义；本轮不引入敏感页面公共缓存。

## Testing Decisions

优先现有 SQLite 持久化和来源详情 HTTP/浏览器测试；用合成临时库做对比基准。SQL 数量用于诊断，不将特定内部语句数写成脆弱验收。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 相同样例优化前后业务输出等价，包括缺口、端点、手工记录阶梯状态、断开来源和历史汇率。
- [ ] 单日更新工作量不再随不相关历史天数增长；批量历史读取不再为每个日期或来源单独追加子查询。
- [ ] 30/365/3650 天及多个来源样例记录前后耗时、读取量和内存趋势，说明冷暖缓存和运行环境。
- [ ] 详情的重型记录读取范围受所选来源和日期限制，必要全局摘要仍保持汇率和刷新注册正确；备份、恢复及正式日结完整读取不被截断。

## Out of Scope

不重新计算历史金额、不更换数据库、不默认加缓存或分页截断导出。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [src/server/production.ts](../../../../src/server/production.ts)
- [src/server/ports.ts](../../../../src/server/ports.ts)
- [src/ui/asset-source-detail.tsx](../../../../src/ui/asset-source-detail.tsx)
- [src/app/asset-sources/[id]/page.tsx](../../../src/app/asset-sources/[id]/page.tsx)
- [e2e/sqlite-business-data-persistence.spec.ts](../../../../e2e/sqlite-business-data-persistence.spec.ts)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
