# 01 — 刷新状态与组合历史基础

**What to build:** 建立统一全量刷新所需的持久化状态与组合历史写入规则，使同步新鲜度、资产完整性、当前资产事实和每日组合历史互不混淆。

**Blocked by:** None — can start immediately

**Status:** resolved

**Reference:** [资产刷新机制重设计](../spec.md)

## 范围

- 在现有 `schema_metadata` 中持久化 `asset_full_refresh_attempted_at` 与 `asset_full_refresh_in_progress_at`，不新增专用表。
- 每个来源继续使用一套 `lastAttemptAt`、`lastSuccessfulAt` 与 `error`；不新增 prices/holdings 两套状态。
- 将资产估值完整性与同步新鲜度拆开：网络失败只使数据变旧，不把已有完整快照改成 incomplete。
- 全量批次成功来源立即更新当前快照；失败来源保留最后成功快照，且不回滚同批次成功来源。
- 只有同一批次完整取得全部当前已连接自动来源且总额估值完整时，才能建立当日基准或更新每日趋势观测。
- 部分成功、全部失败、单来源刷新、后续单独接入来源以及断开来源的旧快照均不得写入新的组合历史。
- 断开来源的最后成功快照继续计入当前总资产并保留断开前历史；重新连接并进入完整统一批次后才恢复参与组合历史。
- 首次连接第一个自动来源时，允许使用连接确认阶段保存的完整快照建立当日基准与趋势。
- 兼容旧版本：已有自动来源但不存在统一周期元数据时视为已到期，不使用旧来源各自的 `lastAttemptAt` 推算新周期。

## 验收标准

- [x] 完整快照刷新失败后，金额、持仓、完整性和 `lastSuccessfulAt` 不变，只更新尝试时间、错误与新鲜度。
- [x] incomplete 只代表真实漏读、未估值或覆盖缺口，不能代表普通网络失败。
- [x] 全量批次开始前原子写入两个周期元数据；正常结束清除进行中标记，异常退出后保留诊断事实。
- [x] 完整批次形成当天第一份当日基准，后续完整批次不覆盖基准，但可更新当天最新趋势观测。
- [x] 部分成功时成功来源当前快照保存、失败来源旧快照保留，且不建立或更新组合级基准和趋势。
- [x] 全部失败时不改变当前资产事实，也不写组合历史。
- [x] 手动单来源刷新只更新目标来源当前事实与状态，不读写统一周期，不写组合历史。
- [x] 断开来源继续计入当前总资产，但不参与断开后的新组合历史；永久删除后才移除其当前值和历史。
- [x] 首个自动来源的连接快照可形成基准与趋势；已有来源后新增、恢复或重新连接单个来源不能单独形成组合历史。
- [x] 旧版本升级时不从各来源旧时间推算统一周期；首次全量尝试无论成功或失败都建立新的统一周期锚点。
- [x] 数据库与领域层回归覆盖完整批次、部分失败、全部失败、断开/恢复、旧版本升级和异常中断。
- [x] 现有快照与历史数据无需清空或重建即可继续读取。
- [x] 相关 Node 测试、数据库测试、`pnpm typecheck` 与 `git diff --check` 通过。

## 非目标

- 不实现浏览器定时器、页面可见性或焦点判断。
- 不实现请求意图合并、多标签协调或来源并行读取。
- 不修改总览、资产、收益或来源详情的刷新按钮与反馈。
- 不删除旧刷新组件、事件总线或 OwnerDashboard。

## 答案

- 在 `schema_metadata` 持久化全量刷新尝试时间与进行中诊断；全量批次开始原子写入，正常完成清除进行中标记，组合历史写入异常则保留诊断。
- 刷新失败仅更新来源同步新鲜度、尝试时间与错误，保留最后成功的完整快照、金额、持仓与成功时间。只有同一完整全量批次且当前自动来源集合未变化、总额完整时，才写入当日基准和趋势。
- 首个自动来源的连接流程按单实例队列串行化，凭证提交和补偿删除完成后才处理下一项；统一周期锚点仅首次条件写入，且不会清除既有中断诊断。因此并发双成功只由首个成功来源建立基准/趋势，首项提交失败时由随后唯一成功来源建立。
- `DatabaseAssetSourceConnections` 只接受显式注入的 `AssetFullRefreshState`：生产 SQLite 路径使用 `DatabaseAssetFullRefreshState` 持久化 `schema_metadata`，FileDashboard 测试路径使用独立 `InMemoryAssetFullRefreshState`，不再进行不安全的 SQLite 类型伪装。
- 单来源刷新、部分/全部失败、断开来源旧快照及已有来源后的单独接入均不写组合历史；恢复来源须经历下一次完整统一批次后才恢复参与。旧数据库缺少统一状态时保持 `null`/视为到期，首次全量尝试（包括全部失败）建立新锚点。
- 测试通过：`NEXT_DIST_DIR=.next-ticket-01 pnpm build`；`NEXT_DIST_DIR=.next-ticket-01 pnpm exec playwright test e2e/longbridge-persistence.spec.ts`（1 passed，真实 `FileDashboardDatabase` 首次连接端点返回 200 且原响应不变）；`node --experimental-transform-types --import ./scripts/register-ts-alias.mjs --test src/domain/daily-trend-observations.test.ts src/server/asset-synchronization.test.ts`（11 passed）；`NEXT_DIST_DIR=.next-ticket-01 pnpm exec playwright test e2e/sqlite-business-data-persistence.spec.ts`（26 passed）；`pnpm typecheck`；`git diff --check`。
- 未实现 Ticket 02、03、04；未访问真实账户或输出凭证；未提交、未推送。

## 评论

- 复核修正：补齐并发首连（双成功及首项凭证提交失败）、断开/恢复、旧周期元数据缺失及异常中断的领域/SQLite 回归，并按实际通过结果完成验收勾选。
- 独立复核修正：移除 FileDashboard 首连时将通用数据库强转为 SQLite 的 fallback；所有构造点显式提供刷新状态 seam，并新增长桥持久化 HTTP 回归覆盖 `POST /test-doubles/longbridge/persistence` 的 FileDashboard 首次连接。
