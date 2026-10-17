# 03 — 工作台刷新接线与旧代码清理

**What to build:** 将统一刷新 Coordinator 接入所有实际页面入口，提供一致、克制且可访问的刷新反馈，并删除已经被统一流程取代且确认无引用的旧刷新代码。

**Blocked by:** 02 — 统一资产刷新 Coordinator

**Status:** resolved

**Reference:** [资产刷新机制重设计](../spec.md)

## 设计约束

- 实现前重新阅读仓库根目录 `DESIGN.md` 及其固定 commit 对应的上游 `SPEC.md`、`index.html`、`DESIGN.md` 和样式证据。
- 复用 `src/ui/vibe/`、现有 `WorkbenchPageHeader` 与运行时 Token，不新增第二套视觉语言。
- 刷新属于次要操作，使用现有 outline 控件；保留其他页面 primary 主操作的视觉优先级。

## 范围

- 在高于各工作台页面生命周期的位置挂载唯一刷新 Provider，页面切换不销毁在途状态、反馈或下一次计划。
- 总览、`/assets` 与 `/performance` 在各自页面标题操作区使用同一个全量刷新入口。
- 命令菜单直接提交 `manual-global` 意图，不再广播或监听 `pad:asset-manual-refresh` 浏览器事件。
- 来源详情页保留单来源刷新按钮，改为提交 `manual-source(sourceId)`，不在详情页重复提供全量刷新入口。
- `canRefresh=false` 时同步隐藏三个核心页面的刷新按钮和命令菜单项；资产来源管理入口始终保留。
- 刷新期间保留现有金额与页面内容，只禁用对应操作，不显示骨架屏或乐观修改金额。
- 每个实际批次结束后只重读用户当前所在路由一次；页面切换不会产生额外刷新请求。
- 删除旧 `AssetRefreshControls` 中休眠的 30 秒行情与 5 分钟持仓调度。
- 删除不再使用的刷新自定义事件及重复监听器。
- 删除确认无路由和无运行时引用的 `OwnerDashboard` 组件链。
- 保留并改造仍有调用方的 `AssetSourceRefreshButton`、`AssetSourceCard`、`AssetSourceView` 与服务端 sourceId 定向刷新。
- `ProductionLongbridgeSourceRefresher` 只有在测试替身完成迁移且引用搜索证明无调用方后才可删除，否则保留。

## 交互反馈

- 默认按钮文案为“立即刷新资产”；进行中显示“刷新中…”并禁用。
- 进行中状态只显示“正在刷新…”，不显示来源数量、名称、百分比或进度条。
- 手动全部成功显示“刷新完成”；部分失败显示“部分来源刷新失败”；全部失败显示“刷新失败”。
- 手动结果在短暂展示后收起；自动刷新成功、部分失败或全部失败均不弹出提示。
- 状态静态显示在刷新入口附近，不使用浮动 Toast 作为主要反馈。
- `superseded` 不显示错误；同步成功但存在未估值资产仍显示“刷新完成”，估值完整性由现有界面单独表达。
- 总资产卡继续显示已有金额，不因同步失败持续显示“含旧数据”；来源级和数据健康继续承担失败原因与最后成功时间。
- 状态使用 `role=status`，错误摘要可被辅助技术读取；按钮保持键盘操作、可见焦点和至少 40px 可点击区域。

## 验收标准

- [x] 总览、`/assets`、`/performance` 的页面按钮和命令菜单都只调用同一个 `manual-global` 路径。
- [x] 从任一入口开始刷新后切换页面，不取消请求、不重置周期、不重复调用来源，并继续显示共享状态。
- [x] 刷新中只显示“刷新中…”与“正在刷新…”，不显示来源数量。
- [x] 三个页面对全部成功、部分失败和全部失败显示一致的手动结果；自动结果保持静默。
- [x] 每个实际服务端批次结束只重读当前路由一次，同批多个来源完成不会重复重读。
- [x] 来源详情只刷新当前来源；重复点击、在途全量覆盖、离开详情页和周期不变均符合 Coordinator 合同。
- [x] 无可刷新来源时三个页面按钮和命令菜单项同时隐藏；恢复第一个来源后同时重新出现。
- [x] 锁定、退出登录和演示模式不显示真实来源刷新状态，不触发页面重读。
- [x] 刷新失败不清空或隐藏已有金额；从未成功的来源继续显示“暂无数据”，不能伪装为零资产。
- [x] 页面入口与反馈在桌面和手机宽度下无溢出，键盘、焦点、`role=status` 与 40px 点击区域符合现有设计合同。
- [x] `OwnerDashboard`、旧 30 秒/5 分钟调度和自定义事件删除前均有引用搜索证据，删除后无类型错误或运行时调用方。
- [x] 现有来源详情、总览、资产、收益与命令菜单聚焦浏览器回归通过。
- [x] `pnpm typecheck`、相关 Node 测试、聚焦 Playwright、`pnpm build` 与 `git diff --check` 通过。

## 非目标

- 不改变一小时周期、服务端批次、历史写入或失败保留规则。
- 不新增实时模式、通知中心、浮动 Toast、来源数量进度或后台刷新。
- 不重新设计工作台布局、来源卡片或数据健康页面。
- 不删除仍有生产或测试调用方的组件与 Adapter。

## 答案

已完成工作台统一刷新接线与旧代码清理：

- 在根布局挂载唯一 `AssetRefreshProvider`；Coordinator、周期计划和在途状态跨工作台路由保持稳定。
- 全量网络请求直接失败时，以客户端本次尝试开始时间建立一小时保守锚点；页面重新注册只接受更新的服务端锚点，不会被旧值或 `null` 倒退，满一小时后的重复前台事件仍只触发一次请求。
- 锁定、退出登录等 `clear()` 新会话边界会清除客户端锚点，手动全量刷新仍可绕过一小时周期。
- 页面首次注册时同步读取当下 `document.visibilityState` 与 `document.hasFocus()`，再提交 `page-entry`；不再依赖父子 Effect 的执行顺序。
- `visibilitychange` 恢复可见与 `window.focus` 重新聚焦都会重新判断到期批次，重复前台事件仍由同一个全量 Promise 合并。
- 总览、资产、收益页面复用同一 outline 全量刷新控件，命令菜单直接提交 `manual-global`；来源详情仅提交 `manual-source(sourceId)`。
- Coordinator 分别维护全量活动与各来源活动；A→B、A→全量和全量覆盖当前来源时，只有对应 Promise 结束才显示终态，其他请求完成不会提前解除“刷新中…”或禁用状态，单来源失败固定显示“刷新失败”。
- 来源按钮优先展示在途全量，其次展示当前来源自己的在途或终态；旧全量终态不会遮住后来提交的来源意图。
- `canRefresh=false` 时同步隐藏页面按钮和命令菜单项；锁定、退出登录或进入演示模式后清除真实刷新状态，并与旧在途请求脱离。
- 刷新期间保留已有金额，仅显示“刷新中…”和“正在刷新…”；手动成功、部分失败、全部失败反馈一致，自动结果静默。
- 每个实际批次只触发当前路由一次重读；站内 `VibeLink` 使用 Next 路由，页面切换不销毁 Provider。
- 删除无引用的 `OwnerDashboard`、旧 `AssetRefreshControls` 调度和刷新自定义事件；`ProductionLongbridgeSourceRefresher` 仍由生产启动测试替身调用，因此按 Ticket 约束保留。

测试证据：

- `node --experimental-transform-types --import ./scripts/register-ts-alias.mjs --test src/ui/asset-refresh-coordinator.test.ts src/server/asset-synchronization.test.ts`：30/30 通过，其中 Coordinator 17 条、服务端 13 条。
- `PLAYWRIGHT_TEST_PORT=3110 pnpm exec playwright test --config=playwright.ticket-03.config.ts e2e/asset-refresh-workbench.spec.ts`：11/11 通过，含首次注册、前台恢复、网络失败锚点跨页面保持、A→B、A→全量、全量覆盖来源，以及旧全量终态后立即发起来源刷新的公开交互回归。
- `NEXT_DIST_DIR=.next-ticket-03 PLAYWRIGHT_TEST_PORT=3111 pnpm exec playwright test e2e/source-list-detail-lifecycle.spec.ts --grep '自动来源详情展示|来源详情内的单来源刷新|锁定状态'`：3/3 通过。
- `NEXT_DIST_DIR=.next-ticket-03 PLAYWRIGHT_TEST_PORT=3112 pnpm exec playwright test e2e/refresh-stale-data.spec.ts --grep '统一刷新批量目标拒绝歧义组合并保留意图目标|单来源刷新拒绝无效目标和范围组合'`：2/2 通过，Ticket 02 API 合同保持。
- `NEXT_DIST_DIR=.next-ticket-03 PLAYWRIGHT_TEST_PORT=3113 pnpm exec playwright test e2e/sqlite-business-data-persistence.spec.ts`：28/28 通过，Ticket 02 SQLite 合同保持。
- `pnpm typecheck`：通过。
- `NEXT_DIST_DIR=.next-ticket-03 pnpm build`：通过。
- `git diff --check`：通过。

引用审计：`OwnerDashboard`、旧 `AssetRefreshControls`、`pad:asset-manual-refresh` 和资产刷新相关的 30 秒/5 分钟调度均为零引用；`src/ui` 唯一剩余 `setInterval` 是本地时钟。

TDD 红绿证据：首次注册测试先以 `coordinator.register is not a function` 失败，前台恢复测试先以 `coordinator.reconsiderForeground is not a function` 失败；并行意图回归先暴露共享状态被较早请求终态覆盖、全量覆盖来源未复用同一 Promise。网络失败跨页面回归先以预期 1 次、实际 2 次请求失败；来源按钮回归先以按钮仍可用且 `aria-busy="false"` 失败。公开 Node/浏览器 seam 补齐后均转绿。完整 Ticket 03 浏览器套件首轮还暴露测试夹具的空/旧周期锚点会合法触发自动刷新，新增显式 `anchor-full-refresh` 测试动作后，手动入口断言稳定为单次请求；未测试私有实现。

遗留基线问题：完整 `source-list-detail-lifecycle.spec.ts` 仍有 3 个与本 Ticket 刷新接线无关的既有失败，分别是旧链接名称断言、HKD 汇率夹具折算断言、以及断开删除凭证后仍要求无凭证恢复的旧合同。旧“登录后立即刷新”和固定 30 秒/5 分钟轮询合同的迁移属于 Ticket 04，本 Ticket 未提前改写。

未提交、未推送，未访问真实账户或输出凭证。

## 评论

2026-08-26：Ticket 03 已按公开交互 seam 完成并标记 `resolved`。完整生命周期套件的 3 个非刷新基线失败与 Ticket 04 的旧轮询合同均已明确隔离，未越界修正；当前工作区全部既有脏改动保持原状。

2026-08-26：完成独立审查要求的三项修正：首次页面进入不再受 Effect 顺序影响；恢复可见或焦点时重新判断且请求去重；全量与来源级并行意图各自保持在途/终态。最终 Node 28/28、Ticket 03 Playwright 10/10、来源详情 3/3、Ticket 02 API 2/2、SQLite E2E 28/28、typecheck、独立构建与 diff check 全部通过。

2026-08-26：完成后续审查修正：客户端网络失败锚点在页面切换时保持单调且 `clear()` 后隔离新会话；旧全量终态不再遮住随后提交的来源刷新。最终 Node 30/30、Ticket 03 Playwright 11/11、typecheck 与 diff check 通过；本轮开始前独立 `NEXT_DIST_DIR=.next-ticket-03 pnpm build` 已通过。
