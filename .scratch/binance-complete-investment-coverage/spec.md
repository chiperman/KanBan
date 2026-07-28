Status: resolved

# Binance 理财产品完整覆盖与来源守恒

## Problem Statement

所有者需要个人资产看板展示 Binance 中全部约定范围内的投资资产，而不是只展示现货、资金钱包和 Simple Earn。

当前 Binance 来源虽然显示“同步成功”，实际只读取 Spot、Funding、Simple Earn Flexible 和 Simple Earn Locked。真实只读账户验收已经证明，Binance 官方接口返回一条尚未结算的 Dual Investment 持仓，但该本金没有进入 Binance 卡片、总资产或资产分布。相同问题未来还会影响 Discount Buy、BFUSD、RWUSD、ETH Staking、SOL Staking 和 On-chain Yields。

只逐个增加已知接口仍不足以解决问题。Binance 还存在 Dual Investment RFQ、Smart Arbitrage、BNB Vault、Launchpool 和 Megadrop 等没有公开专用当前仓位接口、复用底层资产或只提供间接证据的产品。若产品继续新增，个人资产看板仍可能静默漏数，同时把来源标成同步成功。

此外，一个经济资产可能同时出现在逐仓明细、账户汇总、钱包汇总或包装代币余额中。若直接相加，会把同一本金重复计入总资产；若全部忽略汇总，又无法证明资产来源是否完整。

## Solution

把 Binance 来源从固定四分区读取器升级为“产品明细 + 钱包守恒 + 覆盖状态”的完整只读适配器。

- 读取并展示所有具有官方当前账户或持仓接口的约定范围内产品。
- 使用逐仓明细作为本金主源，账户汇总只做产品内对账。
- 使用 Binance 钱包总览对 Spot、Funding、Earn 及其他相关钱包进行来源级守恒校验。
- 对没有公开明细接口的产品保留聚合证据并明确显示“统计不完整”，不伪造币种、数量或产品归属。
- 明确区分当前本金、结算中资产、赎回中资产、预计收益、已到账奖励和历史记录。
- 为每个产品记录覆盖能力与数据新鲜度，使“当前但不完整”和“过期但已知”不再被压成同一个同步状态。
- 继续严格拒绝任何交易、申购、赎回、划转、提现、杠杆或其他写能力；全部读取使用精确的 HTTP method + path allowlist。

## User Stories

1. As an 所有者, I want every supported Binance investment product included, so that the source does not silently omit locked principal.
2. As an 所有者, I want Binance synchronization success to mean the agreed product scope was actually checked, so that a green status is trustworthy.
3. As an 所有者, I want the Binance source to say “统计不完整” when a product cannot be explained, so that missing data is never presented as zero.
4. As an 所有者, I want the Binance source total reconciled against official wallet totals, so that future products cannot disappear silently.
5. As an 所有者, I want unexplained wallet residuals identified separately, so that known holdings remain usable without pretending the detail is complete.
6. As an 所有者, I want Spot balances retained as independent holdings, so that ordinary Binance assets continue to be visible.
7. As an 所有者, I want Funding Wallet balances retained as independent holdings, so that Pay, C2C and funding assets remain covered without double counting valuation fields.
8. As an 所有者, I want Simple Earn Flexible positions retained, so that flexible principal remains part of total assets.
9. As an 所有者, I want Simple Earn Locked positions retained, so that locked principal remains part of total assets.
10. As an 所有者, I want Dual Investment positions included, so that structured-product principal is not missing before settlement.
11. As an 所有者, I want all Dual Investment pages read, so that old history volume cannot hide a current position on a later page.
12. As an 所有者, I want only unsettled Dual Investment principal counted as current assets, so that settled records do not duplicate returned Spot assets.
13. As an 所有者, I want Dual Investment settlement state displayed, so that I can distinguish active, settling and settled positions.
14. As an 所有者, I want Dual Investment projected return separated from realized platform profit, so that future income is not presented as earned cash.
15. As an 所有者, I want Discount Buy positions included when present, so that future structured-product participation is covered without another redesign.
16. As an 所有者, I want Discount Buy account totals used only for reconciliation, so that position detail and account totals are not added twice.
17. As an 所有者, I want BFUSD current exposure included when present, so that yield-bearing futures assets are not silently omitted.
18. As an 所有者, I want RWUSD current exposure included when present, so that real-world-yield assets are not silently omitted.
19. As an 所有者, I want ETH Staking exposure represented once, so that ETH equivalents, BETH and WBETH do not duplicate the same economic asset.
20. As an 所有者, I want SOL Staking exposure represented once, so that SOL equivalents and BNSOL do not duplicate the same economic asset.
21. As an 所有者, I want pending staking redemptions identified, so that assets in transition do not disappear or appear twice.
22. As an 所有者, I want On-chain Yields locked positions included, so that principal moved out of Spot remains visible.
23. As an 所有者, I want On-chain Yields account totals reconciled with position detail, so that an undisclosed flexible portion is reported as incomplete.
24. As an 所有者, I want Soft Staking treated as a reward overlay, so that eligible Spot principal is not copied into a second holding.
25. As an 所有者, I want Soft Staking rewards distinguished from principal, so that platform profit can be attributed without inflating current assets.
26. As an 所有者, I want Dual Investment RFQ recognized as a separate coverage risk, so that large RFQ positions are not assumed to exist in ordinary Dual Investment responses.
27. As an 所有者, I want Smart Arbitrage recognized as a separate coverage risk, so that assets appearing only in Earn or Trading Bots are not silently ignored.
28. As an 所有者, I want BNB Vault, Launchpool and Megadrop participation treated as indirect coverage, so that the same BNB principal is not copied into several products.
29. As an 所有者, I want actual Launchpool or Megadrop rewards counted only after they arrive in a supported wallet, so that eligibility and points are not treated as assets.
30. As an 所有者, I want unsupported product detail labeled honestly, so that the dashboard does not invent positions from history or marketing data.
31. As an 所有者, I want account summaries separated from holding detail, so that totals and distributions have distinct evidence.
32. As an 所有者, I want each Binance holding to retain its product identity, so that the same coin in Spot, Earn and Dual Investment remains distinguishable.
33. As an 所有者, I want each position to retain its provider identifier when available, so that pagination, refresh and settlement cannot create duplicates.
34. As an 所有者, I want each product to expose coverage and freshness separately, so that fresh incomplete data differs from stale complete data.
35. As an 所有者, I want unknown product states to fail closed, so that a new Binance status cannot be interpreted as settled or zero by default.
36. As an 所有者, I want failed product refreshes to preserve the last successful evidence, so that temporary API failures do not erase assets.
37. As an 所有者, I want wallet reconciliation performed during onboarding preview, so that a new source is not saved with unexplained material balances.
38. As an 所有者, I want wallet reconciliation repeated during holdings refresh, so that later product participation is detected automatically.
39. As an 所有者, I want price-only refreshes to reuse stored quantities, so that private product endpoints are not polled every 30 seconds.
40. As an 所有者, I want Binance product reads to use only the dedicated read-only credential, so that broadening product coverage does not broaden authority.
41. As an 所有者, I want every private request constrained to an exact allowlist, so that USER_DATA endpoints with write behavior cannot be called accidentally.
42. As an 所有者, I want no subscription, redemption, transfer, order or settings endpoint called, so that the personal asset dashboard remains strictly read-only.
43. As an 所有者, I want API Key, Secret, signatures and raw private responses excluded from snapshots and browser data, so that broader coverage does not weaken credential privacy.
44. As an 所有者, I want Margin, Futures, Options, Portfolio Margin, Loan, Trading Bots and Copy Trading positive wallets detected, so that excluded partitions are visible as coverage gaps.
45. As an 所有者, I want excluded liability-bearing accounts kept outside numeric investment totals, so that borrowed funds are not mistaken for owned assets.
46. As an 所有者, I want the Binance card to list covered, indirect and unsupported product families, so that I can understand what “complete” means.
47. As an 所有者, I want the total asset overview to propagate Binance incompleteness, so that a missing product cannot be hidden inside a plausible aggregate.
48. As an 所有者, I want asset distribution to state when detailed holdings do not explain the official source total, so that distribution percentages are not overstated.
49. As an 所有者, I want existing Binance snapshots to remain readable after the product model expands, so that historical data is not lost.
50. As an 所有者, I want real-account acceptance repeated after I first join RFQ or another unsupported product, so that indirect coverage assumptions are tested against reality.

## Implementation Decisions

- The agreed Binance investment scope remains Spot, Funding and Binance Earn-style investment assets. Margin, derivatives, leverage, borrowing and liabilities remain excluded from numeric investment totals, but positive excluded wallets must be detected and disclosed.
- Replace the fixed four-value account partition assumption with a normalized Binance product identity that can represent account partition, product family, provider position identifier and lifecycle state.
- Keep product identity separate from asset identity. The same asset may have independent positions across Spot, Flexible Earn, Locked Earn, Dual Investment and other products.
- Model product coverage separately from freshness. Coverage must distinguish detailed, aggregate-only, indirect, unsupported and unknown; freshness must distinguish current and expired.
- Normalize position lifecycle into active, settling, redeeming, settled and unknown. Preserve the provider’s original status for audit. Unknown statuses make that product incomplete and are never assumed to be zero or settled.
- Read Spot, Funding, Simple Earn Flexible and Simple Earn Locked as the existing baseline.
- Add exact read-only access for Dual Investment account and paginated positions. Current principal comes from unsettled position detail; the account total is reconciliation evidence only.
- Add exact read-only access for Discount Buy account and paginated positions. Current principal comes from unsettled position detail; the account total is reconciliation evidence only.
- Add exact read-only access for BFUSD and RWUSD current accounts. Their account-level current exposure is the principal source unless a future account mode exposes the same economic asset elsewhere.
- Add exact read-only access for ETH Staking and SOL Staking current accounts. Wrapped or liquid-staking tokens and their underlying equivalents share one economic-asset identity and one valuation source.
- Add exact read-only access for On-chain Yields account and locked positions. Position detail is primary; an account aggregate not explained by positions produces partial coverage.
- Soft Staking is an overlay on existing wallet principal. Its current product list and reward history may enrich platform profit but never create a second principal holding. The endpoint described as changing Soft Staking settings is forbidden.
- Dual Investment RFQ and Smart Arbitrage are explicit product families even though the public Developer Catalog does not provide a dedicated current-position contract. Do not assume ordinary Dual Investment or Trading Bots responses include them without real acceptance evidence.
- BNB Vault, Launchpool, Megadrop and Yield Arena are indirect or activity layers. Count underlying principal and received rewards through their authoritative wallet or investment product; never create a second principal from qualification, points or campaign participation.
- Use the official wallet-balance overview as the source-level reconciliation sentinel. Compare each positive wallet with the product and account detail that the adapter can explain.
- The authoritative Binance source total may use official in-scope wallet aggregates, while holdings and distribution use detailed product positions. An unexplained residual is retained as aggregate evidence and makes holdings/distribution incomplete; no synthetic coin quantity or product identity is fabricated.
- Reconciliation uses a documented precision tolerance derived from provider valuation precision. A residual outside tolerance is never rounded to zero.
- During onboarding, preview both detailed holdings and product coverage. A material unexplained in-scope balance must be shown before confirmation.
- During holdings refresh, update the complete product set and reconciliation evidence. Preserve the last successful product evidence when a private product endpoint fails, and propagate partial/expired state to the Binance card and total asset overview.
- Price-only refresh reads no private balance, product, history or account endpoint. It revalues the last accepted position quantities using the existing Binance-native price path.
- Extend persistence additively so existing snapshots without product metadata remain readable as legacy Spot/Funding/Simple Earn evidence. Do not rewrite historical snapshots to invent product coverage.
- Keep numeric quantities and amounts as decimal strings. Never use binary floating point for principal aggregation, residual reconciliation or settlement amounts.
- Account summaries, wallet summaries, position detail, wrapped-token equivalents, pending redemption amounts and reward history are evidence views, not independent assets. Each economic asset has exactly one principal source.
- The private request allowlist includes only the documented read endpoints required by this specification. It explicitly excludes subscribe, redeem, auto-subscribe, settings, transfer, withdrawal, order, margin, futures and loan mutation endpoints.
- Continue rejecting API Keys with known write permissions or incomplete permission proof. Expanding readable product families does not relax the credential contract.
- Store only normalized holdings, coverage evidence, provider timestamps and safe error summaries. Credentials, signatures and unnecessary raw private responses remain outside business data, backups and browser payloads.
- The Binance card shows product labels, product-level coverage, last successful update and any unexplained wallet or unsupported product warning. The total asset overview propagates expired data, unvalued assets and incomplete source coverage as distinct conditions.

## Testing Decisions

- Use one highest-level Playwright seam: the existing Binance production-adapter test entrypoint driven through the real application. Extend the existing Binance source story instead of adding lower-level unit-test seams.
- Tests assert externally meaningful outcomes: source preview, normalized holdings, source total, product labels, coverage state, endpoint allowlist, Binance card warnings and total-overview incompleteness. They do not assert private helper structure.
- Reuse the existing controlled transport that records private requests and returns official-shaped responses. No automated test calls a real Binance account.
- Cover a fully paginated Dual Investment history where the only active position is on a later page; assert that settled records are excluded and the active principal appears once.
- Cover Dual Investment active, settling, settled and unknown statuses. Unknown status must produce incomplete coverage rather than a zero position.
- Cover a future settlement followed by a refresh where the asset returns to Spot; assert no interval contains both the settled product principal and returned Spot principal.
- Cover Discount Buy pagination and lifecycle states, including empty current positions and a later non-zero participation.
- Cover BFUSD, RWUSD, ETH Staking, SOL Staking and On-chain Yields with zero and non-zero current responses.
- Cover wrapped-token duplication: Spot WBETH/BETH or BNSOL plus staking-account equivalents must produce one economic asset value.
- Cover pending staking redemption and On-chain Yields redemption so transition amounts remain visible exactly once.
- Cover Soft Staking with eligible Spot principal and rewards; assert principal is not duplicated and no settings endpoint is requested.
- Cover RFQ or Smart Arbitrage represented only by an unexplained Earn/Trading Bots wallet balance; assert the source and total are marked incomplete without inventing detail.
- Cover wallet reconciliation within tolerance and outside tolerance. The former is complete; the latter preserves aggregate evidence and reports an unexplained residual.
- Cover a newly positive excluded wallet such as Futures or Margin; assert it is disclosed but not added to investment totals.
- Cover product endpoint failure after a previous success; assert last successful evidence remains, product freshness becomes expired and other sources continue refreshing.
- Cover onboarding with an unexplained material balance; assert the preview discloses it and no credential or source is persisted when confirmation does not complete.
- Cover the exact private request list for a full holdings refresh and assert that no subscribe, redeem, settings, transfer, withdrawal, order, margin, futures or loan mutation path appears.
- Cover a price-only refresh and assert that it performs no private product or account request.
- Cover credential privacy by checking unauthenticated HTML, browser responses, stored snapshots and test output for Key, Secret, signature or raw credential content.
- Cover persistence compatibility by loading a legacy four-partition Binance snapshot and confirming it remains visible while coverage is explicitly legacy/unknown.
- Real-account acceptance is separate from automated completion. With the owner’s dedicated read-only Key, verify all newly supported endpoints, compare Binance wallet totals, and repeat after the first actual Dual Investment RFQ or Smart Arbitrage participation.

## Out of Scope

- Placing, modifying or cancelling orders.
- Subscribing to, redeeming from or changing settings for any Binance product.
- Transfers, withdrawals, deposits, conversions, internal account movements or wallet signatures.
- Margin, Futures, Options, Portfolio Margin, Loans, liabilities, Copy Trading or general Trading Bots position accounting. This specification only detects their positive wallet coverage gap.
- Reconstructing realized investment return from historical subscriptions, redemptions, trades or cash flows.
- Automatic historical backfill of the 163 existing Dual Investment records into daily asset snapshots.
- Treating projected APR, campaign points, eligibility, quotas or unclaimed marketing rewards as current assets.
- Scraping Binance App pages, reverse-engineering private APIs or using undocumented endpoints for RFQ, Smart Arbitrage, Launchpool, Megadrop or BNB Vault.
- Expanding OKX, Bitget, Longbridge or observation-wallet product scope.
- Changing the single-owner, local-first or strictly read-only product boundary.

## Further Notes

- The supporting official-endpoint and real-account audit is recorded in [Binance 产品与资产覆盖审计](../personal-asset-dashboard/research/binance-product-coverage-audit.md).
- The 2026-07-28 real acceptance found one current Dual Investment position omitted by the existing snapshot. Other probed current-product endpoints were readable and zero at that time.
- After adding Dual Investment, known product account totals explained the Earn wallet total within a residual below 0.1%; this is evidence for the reconciliation design, not a permanent guarantee.
- The existing Binance Ticket’s phrase “Spot、Funding 和 Earn” is broader than its implemented four-endpoint allowlist. This specification supersedes that completeness claim without reopening write-capable or liability-bearing product scope.
- `ready-for-agent` means the requirements and automated seam are defined. Real RFQ/Smart Arbitrage acceptance remains an explicit human boundary because no public dedicated current-position API was found.
