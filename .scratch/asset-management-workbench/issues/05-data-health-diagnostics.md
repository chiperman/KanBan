# 05 — 数据健康诊断页

**What to build:** 提供只读的数据健康入口，让所有者按时间范围、来源和数据完整性诊断同步、估值与历史覆盖，并能进入相关来源详情处理已有的手动操作。

**Blocked by:** 03 — 资产来源列表、详情与生命周期.

**Status:** resolved

**Adjusted by:** `.scratch/personal-asset-dashboard-rebuild/issues/06-source-health-and-recovery-experience.md`

- [x] 数据健康显示来源同步状态、最后成功时间、过期数据、估值完整性和人可理解的失败原因。
- [x] 所有者可按时间范围、来源和完整性查看既有历史观测与数据缺口，而总览仍只呈现简洁总资产趋势。
- [x] 数据健康可进入相应来源详情，但不提供全局刷新、单来源刷新、自动修复、调度或通知能力。
- [x] 诊断页面不将未估值、过期或不完整数据伪装为零资产或完整历史。

## 答案

数据健康已作为受所有者会话保护的只读诊断页交付。页面复用既有来源同步状态、估值真相与每日趋势观测，筛选只改变展示；刷新、重新授权和生命周期操作仍仅在来源详情中提供。

## 评论

- 2026-08-07：新增 `e2e/data-health-diagnostics.spec.ts` 与 `test:ticket-05`，覆盖同步正常/失败/过期、估值完整/未估值、历史范围/来源/完整性筛选、数据缺口、来源详情跳转、桌面/手机键盘焦点、无横向溢出及锁定态隐私。
- 2026-08-07：修复单来源诊断未复用长桥 `CNY → USD` 汇率的问题；手工 CNY 来源在有长桥汇率观测时保持估值完整。
- 验证：`pnpm typecheck`、`pnpm build`、`pnpm test:ticket-05:quick`（3/3）与 `pnpm test`（单元 8/8、smoke 8/8）通过。未运行 `pnpm test:regression`。
- 既有相关审计：`e2e/source-list-detail-lifecycle.spec.ts` 5/5 通过；`e2e/refresh-stale-data.spec.ts` 与 `e2e/valuation-distribution-truth.spec.ts` 合计 14 通过、13 失败，均为旧总览资产卡片/旧选择器断言，与 Ticket 02 已收口总览的既有契约冲突，未在本 Ticket 修改。
