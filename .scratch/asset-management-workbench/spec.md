Status: ready-for-agent

Adjusted by: `../personal-asset-dashboard-rebuild/spec.md`

# 个人资产看板：资产管理工作台重组

## Problem Statement

当前个人资产看板已经具备来源接入、持仓读取、手工资产、同步、历史、布局、备份和安全设置等能力，但大部分能力堆叠在同一个已认证页面和长弹窗中。所有者在日常查看资产时会同时看到来源生命周期、危险操作、配置入口和复杂明细，难以快速判断资产全貌，也难以定位低频管理动作。

问题不是缺少新的资产能力，而是现有能力缺少清晰的职责边界和稳定入口。产品必须继续是本地优先、单所有者、私有、只读的个人资产看板；本次不能把它扩展成多人后台、交易平台或新的资产业务系统。

## Solution

将已认证后的单页看板重组为单人使用的“资产管理工作台”，并保留现有来源、快照、布局和凭证生命周期。

- 总览只服务于日常查看：总资产、资产变化、资产分布、简洁趋势、来源摘要、显示币种、金额隐藏和全局刷新。
- 资产来源统一管理证券账户、交易所、观察钱包和手工资产组；来源列表、来源详情和独立接入流程承载深入查看与管理。
- 数据健康只负责诊断同步、估值、失败和历史覆盖，不承担刷新或自动修复。
- 设置与安全承载 Passkey、TOTP、备份恢复、本机数据和默认偏好。
- 桌面端使用显式左侧导航，移动端使用显式底部导航；Command-K 保留为快捷方式，不再承担唯一导航职责。

## User Stories

1. As an 所有者, I want to enter the total asset overview after authentication, so that I can immediately understand my overall assets.
2. As an 所有者, I want the overview to show current total value, today asset change, distribution, compact trend, and source summaries, so that daily viewing stays focused.
3. As an 所有者, I want to switch display currency and hide or reveal values from the overview, so that I can adjust my current viewing context without opening settings.
4. As an 所有者, I want to manually refresh all connected sources from the overview, so that I can request a current reading when needed.
5. As an 所有者, I want the overview not to permanently display source connection forms, credential settings, or destructive actions, so that management noise does not obscure asset reading.
6. As an 所有者, I want to explicitly enter and leave 布局管理模式, so that normal reading and card editing are visually and behaviorally distinct.
7. As an 所有者, I want card ordering, width, forced row breaks, and hidden state to save immediately in 布局管理模式, so that layout editing has no separate save or draft state.
8. As an 所有者, I want a source summary card to lead to its source detail, so that complete holdings and source management do not expand inside the overview.
9. As an 所有者, I want visible navigation to 总览、资产来源、数据健康、设置与安全 on desktop and mobile, so that every major task has an obvious entrance.
10. As an 所有者, I want Command-K to remain available for navigation and common actions, so that keyboard use remains fast without hiding normal navigation.
11. As an 所有者, I want one 资产来源 list for accounts, exchanges, observation wallets, and 手工资产记录, so that I do not need to remember different management locations.
12. As an 所有者, I want to filter and recognize source types and lifecycle states in the source list, so that I can find the source I need to inspect.
13. As an 所有者, I want a source detail to show the source identity, holdings or hand-recorded values, current status, timestamps, and relevant source actions, so that I can understand one source without returning to the overview.
14. As an 所有者, I want to start adding a source from the source list, so that adding a source is a deliberate management action rather than a dashboard interruption.
15. As an 所有者, I want source onboarding to proceed through source selection, read-only authorization input, permission validation and range preview, then confirmation, so that I understand what will be connected before it is saved.
16. As an 所有者, I want validation failure to leave no source or credential behind, so that a failed attempt does not create misleading management state.
17. As an 所有者, I want to manage a 手工资产记录 through the same source detail model, so that it remains an explicit credential-free source rather than a separate financial subsystem.
18. As an 所有者, I want to manually refresh a specific automatic source from its source detail, so that source-specific recovery remains close to that source.
19. As an 所有者, I want source details to distinguish hidden, disconnected, and permanently deleted data, so that layout visibility and lifecycle operations are never confused.
20. As an 所有者, I want disconnect and permanent deletion to appear only in a clearly separated dangerous-action area with the existing confirmation safeguards, so that normal management does not cause accidental loss.
21. As an 所有者, I want a saved source detail to show authorization state, validation time, and permission summary but never credential values, so that inspecting a source does not expose secrets.
22. As an 所有者, I want to replace or reauthorize a source by explicitly providing authorization material again, so that no stored secret needs to be revealed.
23. As an 所有者, I want 数据健康 to show source synchronization state, last successful update, stale data, valuation completeness, and human-readable failure information, so that I can assess whether totals are trustworthy.
24. As an 所有者, I want to inspect historical observations in 数据健康 by time range, source, and completeness, so that I can distinguish an ordinary trend from a data gap.
25. As an 所有者, I want 数据健康 to diagnose and link me to the relevant source without becoming an automatic repair center, so that its scope stays understandable.
26. As an 所有者, I want Passkey, TOTP, backup and restore, local data, and default preferences grouped under 设置与安全, so that low-frequency configuration does not compete with daily asset reading.
27. As an 所有者, I want backup and restore to continue excluding credentials, so that workbench reorganization does not weaken credential separation.
28. As an 所有者, I want every authenticated workbench page to remain protected by the owner session and every locked response to remain free of asset data, so that route expansion does not create a privacy regression.
29. As an 所有者, I want the workbench to preserve all existing connected sources, hand-recorded values, snapshots, source identities, card layouts, and credential references, so that I do not need to reconnect accounts after the reorganization.
30. As an 所有者, I want current read-only provider permissions and source lifecycle semantics to remain unchanged, so that a navigation project never broadens platform authority.
31. As an 所有者, I want the workbench to be usable with keyboard navigation, visible focus, and phone-sized screens, so that management remains practical on each supported form factor.

## Implementation Decisions

- The product remains a single-owner, local-first, private, read-only personal asset dashboard. “资产管理工作台” is the name for its organized authenticated interface, not a new multi-user backend product.
- The authenticated application is reorganized around four primary destinations: 总览、资产来源、数据健康、设置与安全. The authenticated root resolves to 总览.
- Desktop navigation is a persistent left-side workbench navigation; mobile navigation is a persistent bottom navigation. Command-K supplements these routes rather than replacing them.
- The established design contract, runtime tokens, and shared Vibe components remain the only visual language. The workbench adapts the existing design system instead of introducing a second admin theme.
- 总览 contains only reading-oriented information and quick controls: total assets, distribution, concise total trend, source summaries, display currency, amount visibility, global refresh, locking, and entry to 布局管理模式.
- 布局管理模式 is explicit. Changes to ordering, span, forced row breaks, and hidden state continue to use the established persisted-layout behavior and take effect immediately; there is no unsaved draft, separate save action, or cancel flow.
- 资产来源 is the single management aggregate for automatic accounts, observation wallets, and hand-recorded asset groups. Provider-specific behavior remains behind the established read-only source adapter boundary.
- A source card or source-list item opens an authenticated source detail. Full holdings, source state, manual-record editing, source-specific refresh, reconnection, disconnection, and permanent deletion move out of overview cards.
- New-source onboarding and authorization replacement are full-page, stepwise flows: select type, collect read-only authorization material, validate and preview, then confirm. A failed validation persists neither a source nor a credential.
- Source details never retrieve or render stored credential material. They expose only safe authorization metadata and require re-entry for credential replacement.
- 数据健康 is a read-only diagnostic view over existing source status and historical observation concepts. It may filter and link to sources, but it does not introduce server scheduling, autonomous repair, notifications, or a second refresh control surface.
- 设置与安全 consolidates existing owner-authentication, backup/restore, local-data, and preference flows. Display currency and amount concealment remain immediate overview controls.
- All current source identities, asset cards, snapshots, layout records, credential references, backup semantics, provider permission checks, and lifecycle distinctions are preserved. The workbench does not require source reauthorization or a business-data migration.
- Every new authenticated route continues the existing server-enforced owner authorization and unauthenticated privacy boundary. No asset, source, address, snapshot, or credential data may be serialized into a locked response.

## Testing Decisions

- Playwright against the real web application is the primary acceptance seam. Tests assert user-visible routes, controls, content boundaries, and persisted outcomes rather than component internals.
- Browser fixtures continue to use controlled owner authentication, source adapters, time, valuation data, and secret storage. Live providers, hardware Passkeys, and real credentials remain separate human acceptance.
- Browser coverage verifies the locked application exposes no workbench navigation or asset data, and an authenticated owner starts at 总览.
- Browser coverage verifies desktop left navigation and mobile bottom navigation reach all four destinations with accessible names, keyboard operation, visible focus, and no horizontal overflow.
- Browser coverage verifies 总览 contains source summaries and quick viewing controls but does not expose source onboarding, credential configuration, or destructive lifecycle controls.
- Browser coverage verifies entering 布局管理模式 enables layout editing, each layout change persists immediately, a reload preserves it, and leaving the mode returns to normal reading.
- Browser coverage verifies source summaries navigate to source details, source details present full source information, and source-specific refresh remains available only where applicable.
- Browser coverage verifies onboarding and credential replacement are stepwise page flows, reject invalid or write-capable authority, show a safe preview before confirmation, and leave no partial state after failure.
- Browser coverage verifies source details never reveal credential values and retain existing disconnect and permanent-deletion confirmations.
- Browser coverage verifies 数据健康 can expose stale, failed, incomplete, and historical-coverage states without providing automatic repair or a duplicate refresh action.
- Existing persistence, source lifecycle, valuation, refresh, backup/restore, authentication, layout, responsive, and privacy tests remain regression requirements. New route coverage supplements them rather than replacing their business assertions.
- Migration coverage verifies existing source, snapshot, layout, and credential-reference records remain usable without reauthorization after the workbench is introduced.
- Manual visual acceptance covers desktop, medium, and phone widths in supported themes; real-source acceptance remains limited to owner-confirmed minimum read-only authority.

## Out of Scope

- New asset sources, trading, transfers, withdrawals, signatures, portfolio rebalancing, transaction history, tax lots, or any other new financial business capability.
- Multi-user access, roles, teams, public registration, public sharing, audits for multiple operators, or a generic organization admin system.
- Server-side periodic scheduling, background workers, push/email/system notifications, autonomous repair, or operational alerting.
- Replacing source adapters, changing provider scopes, changing credential storage, exposing credentials, or asking the owner to reauthorize existing sources.
- Changing source identity, snapshot semantics, historical calculation, valuation truth rules, manual-record business semantics, backup credential exclusions, or source lifecycle behavior.
- A new visual language, vendoring the upstream design reference, or rewriting unrelated application screens.

## Further Notes

- This specification is a reorganization layer over the existing personal-asset-dashboard specification. Existing financial truth, read-only authority, privacy, and source-lifecycle requirements remain in force unless this document explicitly narrows the authenticated interface responsibility.
- The canonical product term is “资产管理工作台”. It must not be called a generic “后台管理系统”, because that implies multi-user operations and broader authority that are explicitly outside scope.
- The implementation sequence must preserve the accepted browser seam and avoid broad rewrites. Each later Ticket should declare its blockers and preserve unrelated uncommitted work.
