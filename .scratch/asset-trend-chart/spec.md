Status: ready-for-agent

# 首页资产趋势图

## Problem Statement

首页已经保存并展示每日资产数据，但目前以逐日列表为主，所有者难以快速判断总资产和各资产来源在不同时间跨度内的变化方向。现有历史口径还把“今日资产变动”所需的稳定日初基准与持续更新的趋势观测混在一起，无法同时满足当天比较和历史走势。

所有者需要在同一首页中查看总资产及各资产来源的折线趋势，自由调整区间，并在 USD、CNY、HKD 之间切换。趋势必须真实反映缺失、不完整、过期和汇率状态，不能通过补零、跨日复制或使用当前汇率重算历史制造连续或精确的假象。

## Solution

在首页现有总资产趋势区域和资产来源卡片内增加直线折线图，不新增页面或卡片：

- 首页展示总资产趋势，每个资产来源展示自身总额趋势，不展示单项持仓历史。
- 支持 7 日、30 日、90 日、1 年和全部区间，默认 30 日并记住上次选择。
- 图表下方保留默认展开、每页 30 条的每日明细。
- 将不可改写的日初基准与可随成功刷新更新的每日趋势观测分开。
- 历史金额使用观测当时的可靠汇率，支持 USD、CNY 和 HKD。
- 缺失日期断线；不完整或过期观测可以展示已知金额，但必须明确标记。
- 隐藏敏感信息时，同时隐藏金额、坐标和可推断资产变化的曲线形状。

本规格补充并覆盖个人资产看板总规格中与每日快照、趋势区间及计价货币有关的旧描述。

## User Stories

1. As an 所有者, I want to see a total-asset line chart on the homepage, so that I can understand the overall direction without reading every daily row.
2. As an 所有者, I want each asset source to have its own total-value line chart, so that I can compare source-level changes.
3. As an 所有者, I want individual holdings excluded from historical charts, so that the homepage remains focused and understandable.
4. As an 所有者, I want the trend chart to reuse the existing total overview and source cards, so that the homepage structure remains familiar.
5. As an 所有者, I want a 30-day default range, so that the initial view balances detail and context.
6. As an 所有者, I want to switch between 7 days, 30 days, 90 days, 1 year, and all history, so that I can inspect short- and long-term changes.
7. As an 所有者, I want my last selected range remembered, so that I do not need to restore it on every visit.
8. As an 所有者, I want all trend charts to share the same selected range, so that total and source views remain comparable.
9. As an 所有者, I want trend ranges calculated by consecutive Shanghai calendar days, so that missing observations do not silently shorten the period.
10. As an 所有者, I want missing dates rendered as gaps, so that absent data is never mistaken for unchanged or zero assets.
11. As an 所有者, I want straight line segments without smoothing or area fill, so that the chart does not imply data that was never observed.
12. As an 所有者, I want the vertical axis fitted to visible data rather than forced to zero, so that meaningful changes remain readable.
13. As an 所有者, I want normal point details to contain only date and amount, so that the chart remains low-noise.
14. As an 所有者, I want abnormal point details to add only a short status, so that I understand the limitation without unnecessary metadata.
15. As an 所有者, I want clock time omitted from chart details and interval summaries, so that daily trends stay focused on dates.
16. As an 所有者, I want incomplete and expired observations visibly distinguished, so that I do not treat them as fully reliable.
17. As an 所有者, I want a daily detail list below the chart, so that I can inspect exact recorded amounts.
18. As an 所有者, I want daily details expanded by default and sorted newest first, so that recent records are immediately available.
19. As an 所有者, I want daily details paginated by 30 rows, so that a long history does not make the homepage unwieldy.
20. As an 所有者, I want detail pagination independent from the chart range, so that browsing rows does not alter the visual comparison.
21. As an 所有者, I want the daily baseline fixed after the first successful refresh of each Shanghai day, so that today asset change has a stable reference.
22. As an 所有者, I want the daily trend observation updated after later successful price or holding refreshes, so that the trend reflects the best available observation for that day.
23. As an 所有者, I want the first successful observation to remain usable when it is the only observation that day, so that a day-end refresh is not required.
24. As an 所有者, I want existing first-daily snapshots accepted as trend observations, so that adopting the new model does not require clearing history.
25. As an 所有者, I want failed refreshes to preserve the same day’s last successful observation without writing zero, so that transient failures do not corrupt history.
26. As an 所有者, I want a day with no successful refresh to remain a gap, so that yesterday’s value is not copied into a new date.
27. As an 所有者, I want interval asset change calculated from the first and last complete observations inside the selected range, so that incomplete endpoints do not create false precision.
28. As an 所有者, I want the actual covered start and end dates shown when range boundaries lack complete data, so that I understand what was compared.
29. As an 所有者, I want interval change shown as both amount and percentage, so that I can understand absolute and relative scale.
30. As an 所有者, I want fewer than two complete observations reported as insufficient data, so that no change is fabricated.
31. As an 所有者, I want changes called asset change rather than return or profit, so that deposits, withdrawals, and transfers are not misrepresented as investment performance.
32. As an 所有者, I want USD, CNY, and HKD as reporting currencies, so that the dashboard matches how I review my assets.
33. As an 所有者, I want total charts, source charts, interval changes, and daily details to follow one reporting currency, so that displayed values remain consistent.
34. As an 所有者, I want each historical amount converted with its observation-time exchange rate, so that past values are not rewritten by today’s rate.
35. As an 所有者, I want exchange-rate observations displayed as USD/CNY and USD/HKD, so that the direction is consistent.
36. As an 所有者, I want missing reliable exchange rates reported as incomplete rather than guessed, so that historical amounts remain trustworthy.
37. As an 所有者, I want sensitive mode to hide amounts, axes, tooltips, and curve shape, so that the trend cannot be inferred visually.
38. As an 所有者, I want the existing mobile “查看分布与趋势” entry retained, so that the mobile hierarchy does not change.
39. As an 所有者, I want the chart and details expanded after opening the mobile trend area, so that no second expansion is required.
40. As an 所有者, I want empty, single-point, missing, incomplete, and expired states explained truthfully, so that every chart state remains understandable.

## Implementation Decisions

- Maintain two daily records under the Shanghai calendar-day boundary:
  - an immutable daily baseline used only for today asset change;
  - an updatable daily trend observation used for historical trends.
- The first successful refresh creates both records. Later successful price or holding refreshes update only the trend observation.
- A refresh failure never writes zero. If the day already has a successful trend observation, retain it and mark the relevant status; if the day has no successful observation, leave a gap.
- Existing first-daily observations are accepted as initial trend observations. Do not require historical deletion or automatic backfill.
- Do not expose history clearing, rebuilding, or editing controls.
- Store total and source-level observation amounts for USD, CNY, and HKD using reliable exchange rates available at observation time.
- Preserve the provider’s original exchange-rate direction internally when needed, while presenting USD/CNY and USD/HKD consistently.
- Treat a missing reliable reporting-currency amount as incomplete. Never substitute a fixed rate, current rate, or zero.
- Use one global trend-range preference for the total chart and all source charts. Supported values are 7 days, 30 days, 90 days, 1 year, and all; default to 30 days.
- Calculate ranges as consecutive Shanghai dates. “All” starts at the first available trend-observation date and extends through the current Shanghai date.
- Render straight line segments with no smoothing and no area fill. Automatically scale the vertical axis to visible valid values without forcing zero.
- Break the line across missing dates. Do not bridge gaps or copy values from another date.
- Clearly distinguish complete, incomplete, and expired observations using the existing visual status vocabulary and runtime tokens.
- Normal point details contain only date and reporting-currency amount. Abnormal points add one concise status. Do not display clock time.
- Place daily details below the total chart, expanded by default, newest first, with 30 rows per page.
- Daily-detail pagination does not change the chart range. Changing range or reporting currency resets the detail list to its first page.
- Calculate interval asset change from the earliest and latest complete observations within the selected range. Do not search outside the range.
- Show the actual covered dates, amount difference, and percentage difference. With fewer than two complete observations, show insufficient data.
- Use “区间资产变动” and “资产变化比例”; do not call these values profit, return, P&L, yield, or rate of return.
- Add a source-total trend to each existing source card. Do not build holding-level history.
- Keep the existing mobile trend entry. Once opened, show both chart and details expanded.
- When sensitive information is hidden, do not render asset values, amount-bearing axes, point details, or trend geometry. Masking labels while retaining a readable curve is insufficient.
- Treat owner authentication as the data-isolation boundary: unauthenticated HTML, serialized state, APIs, and network responses contain no historical asset data.
- Reuse the adopted design system, shared visual components, existing homepage composition, runtime tokens, financial typography, state colors, focus treatment, and responsive layout.
- Range controls and pagination retain accessible names, keyboard operation, visible focus, and at least a 40px interaction target.
- Reduced-motion mode disables nonessential chart animation without removing state communication.

## Testing Decisions

- Use one primary automated acceptance seam: the authenticated homepage in Playwright, driven by the existing deterministic daily-observation test source.
- Exercise the real application flow through owner login, refresh, persistence, server rendering, client interaction, and visible output rather than testing chart-library or storage implementation details.
- Extend the controlled test source so scenarios can set Shanghai time, successful and failed refreshes, missing days, multiple same-day observations, incomplete and expired sources, USD/CNY and USD/HKD rates, and enough history for pagination.
- Verify through browser-visible behavior:
  - default and remembered ranges;
  - synchronized total and source charts;
  - same-day trend updates without baseline mutation;
  - cross-day gaps and no zero or copied values;
  - observation-time currency conversion;
  - interval endpoints, amount, percentage, and insufficient-data state;
  - tooltip information density;
  - daily-detail ordering and pagination independence;
  - empty, single-point, incomplete, and expired states;
  - sensitive-value and trend-geometry hiding, plus unauthenticated history-data isolation;
  - desktop, medium, and mobile interaction behavior.
- Use the existing production-persistence test path through the same acceptance fixture to verify schema migration, idempotency, legacy first-daily compatibility, same-day updates, reload persistence, and backup/restore compatibility.
- Assert external behavior and durable records, not SVG path implementation, internal component state, chart-library APIs, or private helper functions.
- Keep visual acceptance separate: manually inspect straight segments, gap rendering, automatic vertical scaling, dense labels, focus visibility, light/dark themes, and reduced-motion behavior.
- Treat real Longbridge USD/CNY and USD/HKD observations as separate owner-authorized manual acceptance. Automated tests must not require real credentials or network access.
- Reuse the existing daily-snapshot browser tests and test-source conventions as prior art rather than creating a second independent testing framework.

## Out of Scope

- Individual holding history.
- Transaction, deposit, withdrawal, or transfer event annotations.
- Investment return, internal rate of return, time-weighted return, or cross-platform profit calculation.
- Historical transaction import or automatic backfill before first successful synchronization.
- User-visible history clearing, rebuilding, or editing.
- A new trend page, new card system, or second visual language.
- Real-time streaming charts or intraday chart ranges.
- Automated tests that connect to a real Longbridge account.

## Further Notes

- “今日资产变动” continues to use the immutable daily baseline.
- “区间资产变动” uses complete daily trend observations and can include deposits, withdrawals, or transfers; it is not investment performance.
- Observation timestamps remain part of the data record for ordering, exchange-rate provenance, and diagnostics, but ordinary chart details and interval summaries display dates only.
- Missing data, zero assets, incomplete observations, and expired observations are distinct states and must remain distinct.
- The approved domain terminology and architectural rationale are recorded in the project glossary and the ADRs for daily observations and historical exchange rates.
