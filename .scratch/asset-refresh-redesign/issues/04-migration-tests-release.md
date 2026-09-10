# 04 — 刷新迁移、回归与发布验收

**What to build:** 完成旧刷新机制到统一每小时全量刷新的兼容迁移，更新所有现行文档与自动化合同，并在不访问真实凭证的前提下形成可发布的验收证据。

**Blocked by:** 03 — 工作台刷新接线与旧代码清理

**Status:** resolved

**Reference:** [资产刷新机制重设计](../spec.md)

## 范围

- 验证现有 SQLite 数据、来源快照、同步状态、每日历史和来源身份可原地升级，不清空、不重建、不伪造历史。
- 覆盖已有自动来源但不存在统一周期元数据的升级场景：首次满足自动条件时视为到期，首次失败也建立一小时周期。
- 覆盖旧版本升级后页面未打开、隐藏、失焦、重载、多标签和服务重启行为。
- 更新 `docs/research/asset-refresh-lifecycle.md`，使其在代码落地后准确描述实际的一小时完整刷新机制。
- 更新 `docs/current-baseline.md` 的刷新现状，不再将休眠的 30 秒/5 分钟逻辑描述为生产行为。
- 审核既有已解决 Ticket 08、Ticket 29 及相关来源 Ticket；保留历史验收记录，通过 `Adjusted by` 或评论指向本次重设计，不倒改当时已经完成的事实。
- 重写 `e2e/refresh-stale-data.spec.ts` 中“登录后立即刷新”和固定 30 秒/5 分钟轮询合同。
- 增加数据库、Coordinator、服务端批次和浏览器边界的聚焦回归。
- 汇总删除证据、迁移证据、自动化结果、未执行的真实来源验收和已知限制。

## 自动化验收矩阵

- 完整成功、部分成功、全部失败、单来源失败、60 秒超时和服务异常中断。
- 当日基准冻结、完整趋势更新、部分失败不写组合历史、断开来源不参与新历史。
- 页面首次进入、周期未到期、周期到期、隐藏、失焦、恢复前台和浏览器重启。
- 自动、手动全量、手动单来源、定时器和前台恢复意图重叠。
- 多页面与多标签竞争，确认来源 Adapter 只执行一轮。
- 来源在途断开、删除、更换凭证、恢复或重新连接，以及 `superseded` 结果。
- 无可刷新来源、最后一个来源消失和重新连接第一个来源。
- 总览、`/assets`、`/performance`、来源详情与命令菜单的按钮、反馈、路由切换和单次数据重读。
- 锁定、退出登录、演示模式、键盘操作、辅助技术状态、桌面与手机宽度。

## 验收标准

- [x] 使用包含既有来源、当前快照、同步状态和每日历史的旧版数据库夹具完成升级，升级前后业务数据数量与关键金额保持一致。
- [x] 升级不根据旧来源各自的 `lastAttemptAt` 推算统一周期，也不在页面关闭、隐藏或失焦时后台刷新。
- [x] 旧 E2E 中固定 30 秒/5 分钟和登录后无条件刷新的断言已经删除或改写为智能到期合同。
- [x] 新回归覆盖成功、失败、超时、意图合并、多标签、生命周期变化和历史写入边界。
- [x] 三个核心页面及来源详情在开发模式和生产构建边界完成聚焦浏览器验收。
- [x] 文档、当前基线、代码、类型、数据库合同和 E2E 对刷新机制的描述一致。
- [x] 旧刷新组件、事件和 OwnerDashboard 的删除均有最终引用搜索、类型检查和浏览器回归证据。
- [x] 自动测试全部使用受控 Adapter 或测试替身，不读取真实账户、不记录授权材料或原始私密响应。
- [x] 如执行真实只读来源人工验收，单独记录来源、时间和可见结果，不把凭证写入日志、截图、SQLite 备份或仓库；未执行时明确标记为待人工验收。
- [x] `pnpm typecheck`、相关 Node/数据库测试、聚焦 Playwright、`pnpm build` 与 `git diff --check` 通过。
- [x] 与本次范围无关的既有失败单独报告，不顺手修改。

## 非目标

- 不扩大任何来源 Adapter 的资产覆盖范围。
- 不新增真实账户凭证、后台 cron、通知或实时模式。
- 不修改正式日结、现金流、收益计算或交易功能。
- 不自动提交、推送或发布；这些外部动作需要所有者另行确认。

## 答案

已完成旧刷新机制到统一每小时完整刷新的迁移验收：旧 SQLite 数据可原地升级且业务数量、来源身份和关键金额不变；旧登录后无条件刷新与 30 秒/5 分钟轮询合同已改写；生命周期、多标签、服务重启、失败/超时、意图重叠和历史边界均有受控回归。现行文档、基线、生产注释与代码合同一致，旧组件和事件已无调用方。全部聚焦门禁通过，真实来源人工验收明确未执行。

## 评论

2026-09-10 提交整理补记：以下 2026-08-26 的通过与 resolved 状态是当时的聚焦验收记录，不代表当前整库 E2E 全绿。本次默认单测 83/83、生产构建通过；105 项组合浏览器回归首轮 103 通过、2 失败，修正早期来源历史夹具及对比度背景取值后，两项定向复测通过，未将其写成一次整组全绿。SQLite 当前回归校验 v17，原 v16 描述保留为历史。当前仍有正式日结汇率/完整性、已删除旧看板入口及部分旧趋势布局断言失败，未与基准提交对比，不能确定为既有失败。详见 `docs/current-baseline.md` 的 2026-09-10 记录；真实来源与完整人工视觉验收未执行。所有者已另行授权本地提交，未授权推送或发布。

2026-08-26：Ticket 04 完成并标记 `resolved`。旧版 SQLite v15 夹具原地升级到 v16，升级前后保持 2 个来源、2 个当前快照、2 个同步状态、2 天基准、2 天趋势、基准与趋势各 4 条来源历史；来源身份保持 `binance:legacy-binance-account` 与 `longbridge:legacy-longbridge-account`，关键金额保持当前快照 `123.45`/`678.90`、基准 `790.00`/`802.35`、趋势 `795`/`802.35`。旧来源各自的 `lastAttemptAt` 未被推算成统一锚点；首次完整刷新全部失败后仍建立一小时周期，服务重启后立即请求返回 `not-due`。

旧刷新 E2E 已改写为统一周期合同，覆盖可见且聚焦、隐藏、失焦、恢复前台、重载、多标签和意图重叠；成功、部分失败、全部失败、单来源失败、60 秒超时、服务异常中断、来源生命周期和历史写入边界由现有 Node、SQLite 与浏览器回归共同覆盖。TDD 红灯证据：改写后的 `refresh-stale-data.spec.ts` 首轮为 6/9 通过，暴露 3 处绑定已删除总览资产卡片/旧文案的断言；随后为 8/9 通过，暴露来源详情路由进入时合法 `page-entry` 记录；改为只断言手动操作新增调用后转为 9/9。

文档已更新 `docs/research/asset-refresh-lifecycle.md` 与 `docs/current-baseline.md`；Ticket 08、29 及来源 Ticket 06、10、11、12、13 保留历史验收事实，并通过 `Adjusted by`/评论指向本重设计。`docs/research/bit-wallet-integration.md` 明确为历史调研语境，现行行为为统一每小时完整刷新与手动单来源刷新；长桥刷新器注释同步移除“30 秒价格周期”现行表述。

测试证据：

- `node --experimental-transform-types --import ./scripts/register-ts-alias.mjs --test src/ui/asset-refresh-coordinator.test.ts src/server/asset-synchronization.test.ts src/domain/daily-trend-observations.test.ts`：35/35 通过（Coordinator 17、服务端 13、趋势 5）。
- `NEXT_DIST_DIR=.next-ticket-04 pnpm exec playwright test e2e/refresh-stale-data.spec.ts --config=playwright.config.ts`：9/9 通过。
- `NEXT_DIST_DIR=.next-ticket-04 pnpm exec playwright test e2e/asset-refresh-workbench.spec.ts --config=playwright.config.ts`：11/11 通过。
- `NEXT_DIST_DIR=.next-ticket-04 pnpm exec playwright test e2e/source-list-detail-lifecycle.spec.ts --config=playwright.config.ts --grep \"自动来源详情展示|来源详情内的单来源刷新|锁定状态\"`：3/3 通过。
- `NEXT_DIST_DIR=.next-ticket-04 pnpm build`：通过。
- 构建后合并复跑 `e2e/sqlite-business-data-persistence.spec.ts`、`e2e/refresh-stale-data.spec.ts`、`e2e/asset-refresh-workbench.spec.ts`：49/49 通过，其中 SQLite 29/29。
- `pnpm typecheck`：通过。
- `git diff --check`：通过。

最终引用审计：生产代码中 `OwnerDashboard`、`AssetRefreshControls` 与 `pad:asset-manual-refresh` 均为零引用；`src/ui` 唯一 `setInterval` 是本地时钟。旧 30 秒/5 分钟命中仅保留于总规格、历史 Ticket 和明确说明“已移除/已替代”的现行文档。`ProductionLongbridgeSourceRefresher` 仍由受控生产启动测试替身调用，因此保留。

自动化全程使用受控 Adapter/测试替身；未访问真实账户、真实凭证或网络来源 Adapter，未输出授权材料。真实只读来源人工验收本次未执行，待所有者另行安排。未发现需要顺手修正的无关基线失败；未提交、未推送、未发布。

2026-08-26：独立验收发现批量目标 API 回归在 `loginAsOwner()` 返回后立即清空指标，可能与尚未完成的登录后 `page-entry` 刷新竞态。测试现已在 `reset-schedule` 前通过公开指标明确等待 2 次 Adapter 调用完成且 `active=0`，再清空指标；产品刷新逻辑与非法请求断言均未修改。`NEXT_DIST_DIR=.next-ticket-04 pnpm exec playwright test e2e/refresh-stale-data.spec.ts --config=playwright.config.ts --grep "统一刷新批量目标拒绝歧义组合并保留意图目标" --repeat-each=5`：5/5 通过；随后 SQLite、刷新、工作台三文件组合：49/49 通过。
