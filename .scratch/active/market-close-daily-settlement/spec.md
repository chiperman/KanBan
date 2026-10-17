Status: ready-for-agent

# 证券正式收盘与跨资产日结

## Problem Statement

所有者的个人资产看板同时包含证券和加密资产。证券在常规交易时段结束后会有可确认的正式收盘价，但盘前、盘后和夜盘报价仍会继续变化；加密资产全天交易，没有天然收盘价。

当前资产刷新由已打开且可见的浏览器触发。它会持续更新当前资产快照和每日趋势观测，因此盘后报价、任意刷新时间和一次偶发失败都可能影响当天趋势。该记录适合反映“当天看到过什么”，但不等于“市场正式收盘时资产是多少”，也无法保证浏览器关闭后仍会执行。

所有者需要一份可信、可追溯、不会被盘外报价覆盖的正式日结：证券使用对应市场的正式收盘价，加密资产使用同一日结窗口的价格，同时保留实际采集时间、市场交易日和不完整原因。

## Solution

在现有实时资产快照、日初基准和每日趋势观测之外，增加独立的正式日结能力。

- 实时资产快照继续刷新，证券允许显示盘前、盘后和夜盘行情；这些报价不得写入正式日结。
- 每日趋势观测继续按上海自然日记录最佳已有观测；它不改名为收盘，也不被正式日结覆盖。
- 正式日结由本机后台任务独立执行。持有证券时，它等待所有相关证券市场中最后一个可确认的常规交易时段收盘，再采集一次跨资产数据。
- 证券持仓使用对应市场和交易日的正式日 K 收盘价；加密资产使用同一采集窗口内的市场价格；现金和来源汇率保留自身的采集证据。
- 每个正式日结批次固定保存。后续实时刷新、盘后报价或重复任务只能读取、验证或补充缺失状态，不能改写已确认数值。
- 后台任务未运行或某个来源无法读取时，系统如实记录错过或不完整；不得把之后的实时数据伪装成当时的日结。

本规格补充现有“日初基准与每日趋势观测”决策，不改变其用途。

## User Stories

1. As an 所有者, I want to keep seeing current securities prices, so that intraday, pre-market and after-hours changes remain visible.
2. As an 所有者, I want an after-hours securities price excluded from the formal daily close, so that daily history is not overwritten by off-session trading.
3. As an 所有者, I want each securities holding valued with its market’s confirmed regular-session close, so that its daily value has a clear market basis.
4. As an 所有者, I want each securities close to retain its market and trading day, so that a US close and a Hong Kong close are never confused by Shanghai time.
5. As an 所有者, I want crypto valued at the same daily-settlement capture window as securities, so that the cross-asset total is comparable at one practical point in time.
6. As an 所有者, I want crypto prices described as capture-time market prices rather than “official close”, so that 24-hour trading is represented truthfully.
7. As an 所有者, I want the final settlement anchored to the last relevant securities market close, so that all holdings share one daily review point.
8. As an 所有者, I want a crypto-only dashboard to use a documented Shanghai daily cutoff, so that it still has one stable daily record without claiming an exchange close.
9. As an 所有者, I want the daily settlement task to run when the browser is closed, so that the record does not depend on whether I visited the dashboard.
10. As an 所有者, I want regular client refreshes to remain responsive and independent, so that daily settlement does not slow ordinary dashboard use.
11. As an 所有者, I want the existing daily trend observation retained, so that historic intraday observations and formal closes are not silently merged.
12. As an 所有者, I want formal daily settlement shown separately from the existing trend view, so that I understand which history represents a market close.
13. As an 所有者, I want a settlement record to show its actual capture time, so that I can judge whether a crypto price was taken minutes after a securities close.
14. As an 所有者, I want a settlement record to show complete, incomplete, missed or expired evidence, so that a plausible total is not mistaken for a verified one.
15. As an 所有者, I want the task to wait for confirmed daily-close data rather than infer a close from a live quote, so that delayed market-data publication is handled safely.
16. As an 所有者, I want market holidays and non-trading days to produce no fictional securities close, so that dates without a session do not appear as zero or unchanged.
17. As an 所有者, I want daylight-saving changes handled without editing a fixed Shanghai clock time, so that US-market settlement remains correct year round.
18. As an 所有者, I want a repeated task invocation to create at most one settlement batch, so that retries and service restarts cannot duplicate history.
19. As an 所有者, I want a completed settlement batch to be immutable, so that later data refreshes cannot revise its historical meaning.
20. As an 所有者, I want a partial source response retained with its reason, so that known values remain inspectable without hiding missing evidence.
21. As an 所有者, I want a missed batch explicitly marked when it can be detected later, so that a gap is not silently presented as a valid close.
22. As an 所有者, I want a later daily-K recovery to be marked as recovered securities evidence only, so that it does not fabricate historical crypto prices, cash balances or account quantities.
23. As an 所有者, I want source cash included according to the account value observed during the settlement window, so that a securities account is not reduced to its equity positions.
24. As an 所有者, I want settlement-time exchange-rate observations saved with historical totals, so that reporting-currency displays do not use today’s FX rate.
25. As an 所有者, I want disconnected sources to preserve already completed settlements, so that historical records remain meaningful after disconnecting a credential.
26. As an 所有者, I want deleting source data to remove its formal-settlement evidence through the existing confirmed deletion boundary, so that deletion semantics remain consistent.
27. As an 所有者, I want the background task to use only existing read-only source access, so that daily settlement never broadens trading, transfer or withdrawal authority.
28. As an 所有者, I want Longbridge OAuth material to remain in the macOS Keychain when the task runs, so that no token is copied into SQLite, task arguments, logs or browser data.
29. As an 所有者, I want keychain access failure surfaced as a settlement failure, so that a background process never silently records stale securities data.
30. As an 所有者, I want normal dashboard refresh failures and daily-settlement failures reported independently, so that one status does not hide the other.
31. As an 所有者, I want a new securities source to join future settlements only after it has a valid current holding snapshot, so that an incomplete onboarding state does not corrupt a batch.
32. As an 所有者, I want no individual holding-level historical chart added unless explicitly requested, so that the first release stays focused on credible source and total history.
33. As an 所有者, I want all formal-settlement amounts and quantities to retain decimal precision, so that small crypto balances and fractional securities are not rounded into false differences.
34. As an 所有者, I want unauthenticated pages and APIs to expose no settlement records, so that the new historical data follows the existing owner-only boundary.
35. As an 所有者, I want existing daily baselines and trend observations to remain readable after migration, so that adding formal settlement never destroys earlier history.

## Implementation Decisions

- Maintain three distinct historical concepts:
  - the immutable Shanghai-day 日初基准 used only for 今日资产变动;
  - the updatable Shanghai-day 每日趋势观测 used for ordinary historical trends;
  - the immutable 正式日结 used for market-close-based cross-asset history.
- A formal-settlement batch has an anchor. When connected securities holdings exist, the anchor is the latest confirmed regular closing session among their markets. The batch stores the anchor market, its trading day, scheduled close time and actual capture window.
- A batch also stores every securities component’s own market and trading day. This avoids treating a Hong Kong market day and a US market day as the same calendar day merely because their final capture occurs in one Shanghai-time window.
- When no connected securities source exists, create one crypto-only formal-settlement batch shortly after the Shanghai daily cutoff. It is explicitly a crypto price cutoff, not a securities close.
- Determine securities eligibility and completion from market/session-aware official daily-candle data, not from `lastDone`, `prevClose`, quote timestamps or a hard-coded wall-clock schedule. The implementation must tolerate weekends, holidays, half-days and daylight-saving changes.
- Extend the Longbridge native read boundary so the application can request the required official daily-candle close and its trading-session metadata. Existing live, pre-market, after-hours and overnight quote reads remain the current-price path only.
- A settlement run first obtains the source quantities and cash evidence required for the capture window, then values securities with confirmed official daily closes and crypto with fresh provider prices from the same run. Each item retains its price source and observed time.
- Persist a settlement batch, source-level result, holding-level valuation evidence and exchange-rate observations additively. A completed batch is immutable; status transitions may add diagnostics or mark an unresolved batch missed, but must not replace confirmed values.
- Use one idempotency identity per anchor. Retried, overlapping or restarted jobs must converge on one batch without duplicate source or holding records.
- Do not reuse the current `AssetSynchronization.refresh()` record-writing behavior for formal settlement. The new application service may reuse source adapters and source snapshots, but must have its own persistence contract and lifecycle.
- Add a local, non-browser daily-close runner that boots the same production service composition and invokes the formal-settlement application service directly. It must not require an owner web session or a running browser.
- Install the runner as a per-user macOS `launchd` agent that wakes at a short regular interval. The runner decides whether a close is due; `launchd` does not encode market hours. Installation, status inspection and removal are explicit local actions, not side effects of build or dashboard startup.
- The background agent runs only in the logged-in user context. Keychain unavailability, unavailable local data, source authorization failure, timeout and incomplete market data result in recorded failure evidence rather than interactive prompts or secret fallback.
- The settlement task remains strictly read-only. It may use existing read-only provider APIs, existing encrypted secret storage and existing Keychain references only.
- Source-level and total-level completion require all required components to have current evidence, reliable reporting-currency conversion and no unresolved in-scope valuation gap. A known partial amount remains visible but is never upgraded to complete.
- If a missed historical securities day can later be located through an official daily candle, retain it only as recovered price evidence. Do not reconstruct the former account quantity, account cash, crypto price, FX observation or full portfolio total.
- Preserve completed formal settlements after source disconnect. Extend the existing source-data deletion workflow so explicitly deleting a source also removes its associated settlement evidence.
- The dashboard presents formal settlement as a separately named history/summary with market-day and capture-time provenance. Existing 每日趋势观测 remains available and keeps its current semantics; the default must not silently switch from one to the other.
- Reuse the existing owner-only data boundary, decimal arithmetic, source coverage vocabulary, stale-data vocabulary and visual tokens. This feature must not introduce a second asset model or a second visual language.

## Testing Decisions

- Use one primary automated acceptance seam: execute the local formal-settlement runner against the production-shaped application composition, deterministic source adapters, controlled market-calendar/candle responses and a temporary SQLite database.
- Assert externally meaningful durable outcomes: the batch identity, anchor provenance, market trading days, official securities closes, crypto capture-time prices, totals, exchange-rate observations, completion state and visible diagnostics. Do not test timer callbacks, SQL statement shapes or private helper structure.
- Reuse the existing source-adapter test doubles and SQLite business-data-persistence acceptance path rather than creating a separate fixture architecture.
- Cover a live quote that changes after regular close and assert it changes the current asset snapshot but never the completed formal settlement.
- Cover a US regular close whose capture occurs on the following Shanghai calendar date and assert both the US trading day and actual capture time remain visible.
- Cover multiple securities markets with distinct local trading days inside one anchored batch and assert each component retains its own provenance.
- Cover a crypto source whose price changes between normal refreshes and the settlement run; assert the stored formal value matches the settlement capture window only.
- Cover a crypto-only dashboard at the documented Shanghai cutoff and assert the output never labels crypto price as an official close.
- Cover delayed daily-candle availability, non-trading days, holidays, half-days and daylight-saving transitions. The runner must wait, skip or mark incomplete according to evidence, never guess from a fixed time.
- Cover a source timeout, a Longbridge Keychain failure, missing FX and an incomplete source-coverage response; assert no false complete total is written and existing current snapshots remain intact.
- Cover retries, concurrent runner launches and process restart after a partial attempt; assert at most one batch per anchor and no confirmed value is overwritten.
- Cover missed-run detection and official-candle recovery; assert recovered securities evidence is explicitly limited and never fabricates a cross-asset historical total.
- Cover migration from existing daily baseline and trend data; assert those records remain unchanged and readable, while formal settlements start empty until first valid run.
- Cover source disconnect and explicit source-data deletion using the existing lifecycle contracts.
- Cover credential privacy by inspecting task output, persisted business data and unauthenticated responses for absence of OAuth tokens, API keys, secrets and signatures.
- Add browser acceptance only for owner-visible formal-settlement labels, provenance and incomplete/missed messaging. Visual verification remains separate from automated runner acceptance.
- Treat live Longbridge and real macOS Keychain execution as owner-authorized manual acceptance. Automated tests must not require real credentials, a real account or a loaded `launchd` agent.

## Out of Scope

- Changing the current 30-second/5-minute browser refresh cadence.
- Treating pre-market, after-hours or overnight quotes as a formal securities close.
- Reconstructing historical portfolio quantities, cash, crypto prices, FX rates, deposits, withdrawals or trades after a missed run.
- Transaction history, realized return, time-weighted return, internal rate of return or tax accounting.
- Holding-level formal-close charts, price alerts or automated trading decisions.
- New provider credentials, write-capable provider permissions, orders, transfers, withdrawals, conversions or wallet signatures.
- A cloud scheduler, remote worker, multi-user deployment or remote access to local asset data.
- Automatically loading, unloading or modifying a user’s macOS background services without the owner explicitly running the installation action.
- Redesigning existing dashboard cards, the current/cost display, or the existing daily-trend chart beyond the explicit formal-settlement presentation.

## Further Notes

- The current daily baseline and trend model remains valid for its existing purposes. This specification adds a fourth concept to the dashboard only because “best available observation” and “official market close” answer different questions.
- A US-market example: the US trading day 2026-08-05 can be settled shortly after that regular session closes in Shanghai time on 2026-08-06. The record must display the US trading day and the later capture timestamp instead of collapsing them into one ambiguous date.
- The formal-settlement runner has a deliberately narrow operational role: determine whether a settlement is due, collect read-only evidence, persist one idempotent result, and exit. It is not a general continuous refresh daemon.
- Existing user worktree changes are outside this specification and must not be absorbed, reformatted or committed as part of the feature.
