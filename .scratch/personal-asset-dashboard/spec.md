Status: ready-for-human

# Personal Asset Dashboard

## Problem Statement

所有者的证券、中心化平台资产和链上资产分散在长桥、Binance、OKX、Bitget 与观察钱包中。不同来源具有不同的持仓结构、计价方式、更新时间和权限模型，难以快速获得可信的总资产、资产分布、来源状态和历史变化。

产品的核心问题只有一个：让唯一所有者安全、准确、快速地查看自己的投资资产。个人主页、身份介绍、Now、外部链接、Markdown 内容和公开分享不属于资产看板，应从产品、领域模型、界面和接口中删除。

## Solution

构建一个本地优先、单所有者、只读的个人资产看板。

- 未认证首页只显示所有者登录入口，不展示资产数据、资产布局或设计化占位。
- 所有者验证身份后查看总资产、今日资产变动、资产分布、各来源持仓、数据状态和历史趋势。
- 页面只存在资产卡片；卡片可以排序、调整一格/两格/三格宽度和隐藏，高度始终随内容自适应；卡片不能发布，也没有公开/私密访问级别。
- 产品不执行交易、划转、提现、签名、调仓或任何资产写操作。
- 首版资产来源为长桥、Binance、OKX、Bitget、Ethereum 与 BNB Smart Chain 观察钱包。
- 资产按来源原生定价，默认折算为 USD，可切换为 CNY 或 HKD；系统分别保存不可改写的日初基准和可随成功刷新更新的每日趋势观测，并明确区分今日资产变动、区间资产变动、平台盈亏、过期数据和未估值资产。

实现、自动化验收与待人工确认事项见 [`docs/current-baseline.md`](../../docs/current-baseline.md)。

## User Stories

### 总览与持仓

1. As an 所有者, I want all supported investment assets on one page, so that I do not need to open several products.
2. As an 所有者, I want the total asset overview to be the first visual focus.
3. As an 所有者, I want current value, today asset change, and asset distribution shown together.
4. As an 所有者, I want USD as the default valuation currency and CNY or HKD as optional display currencies.
5. As an 所有者, I want each holding to preserve its native currency and source values.
6. As an 所有者, I want distribution views by asset class, source, and currency.
7. As an 所有者, I want each source card to show its total, status, update time, and compact holding summary.
8. As an 所有者, I want full holding details with name or symbol, quantity, price, market value, price source, and available platform profit.
9. As an 所有者, I want to hide or reveal sensitive amounts without ending the authenticated session.

### 资产来源

10. As an 所有者, I want Longbridge securities and funds read through exact `account.read` OAuth scope and a private read-only official SDK extension.
11. As an 所有者, I want Binance spot, funding, and Earn assets included.
12. As an 所有者, I want OKX spot, funding, and Earn assets included.
13. As an 所有者, I want Bitget spot, funding, Earn, and futures-bot aggregate equity included.
14. As an 所有者, I want margin, futures, leverage, borrowing, and other write-capable or liability scopes rejected.
15. As an 所有者, I want Ethereum and BNB Smart Chain observation wallets added through public addresses only.
16. As an 所有者, I want observation wallets to remain independent of wallet brand and incapable of signing.
17. As an 所有者, I want one consistent onboarding flow: choose source, provide read-only authorization, validate permission, preview scope, and confirm.
18. As an 所有者, I want failed validation to save no source or credential.
19. As an 所有者, I want source credentials kept outside browser-readable storage.

### 估值与数据真实性

20. As an 所有者, I want platform assets to use source-native valuation.
21. As an 所有者, I want observation-wallet assets to use an identified independent reference price.
22. As an 所有者, I want stablecoins valued at actual market prices rather than a fixed peg.
23. As an 所有者, I want the same asset on different sources to retain small native-price differences.
24. As an 所有者, I want unvalued assets to preserve identity and quantity while staying outside numeric totals.
25. As an 所有者, I want totals to state when they contain expired data or exclude unvalued assets.
26. As an 所有者, I want platform profit shown only when the source explicitly provides it.

### 刷新与历史

27. As an 所有者, I want an immediate refresh when entering the authenticated dashboard.
28. As an 所有者, I want visible-page price refresh every 30 seconds and holdings refresh every five minutes.
29. As an 所有者, I want scheduled refresh paused while the page is hidden.
30. As an 所有者, I want a manual refresh action.
31. As an 所有者, I want each source failure isolated from successful sources.
32. As an 所有者, I want the last successful data preserved and marked expired after failure.
33. As an 所有者, I want an immutable daily baseline and an updatable daily trend observation using Asia/Shanghai as the canonical day boundary.
34. As an 所有者, I want history to start from the first successful synchronization without automatic backfill.
35. As an 所有者, I want snapshot difference called today asset change rather than investment profit.

### 私有访问与会话

36. As an 所有者, I want the locked homepage to show only an authentication entry.
37. As an 所有者, I want Passkey as the primary login method.
38. As an 所有者, I want TOTP-only as the backup login method when Passkey is unavailable.
39. As an 所有者, I want public registration, social login, SMS login, and additional owners disabled.
40. As an 所有者, I want all asset authorization enforced by the server and data layer.
41. As an 所有者, I want no asset values, holdings, sources, addresses, snapshots, or credentials in unauthenticated HTML, page state, APIs, or network traffic.
42. As an 所有者, I want automatic lock after 30 minutes without activity.
43. As an 所有者, I want browser-session termination and manual lock to return to the owner login page.

### 资产布局与生命周期

44. As an 所有者, I want asset cards reordered and resized to one, two, or three columns.
45. As an 所有者, I want one desktop order to reflow into two columns and one column on narrower screens.
46. As an 所有者, I want asset-card height to always follow its content.
47. As an 所有者, I want a hidden source to keep synchronizing and contributing to totals.
48. As an 所有者, I want disconnecting a source to delete its credential and stop future synchronization while retaining snapshots.
49. As an 所有者, I want permanent source-data deletion separate from disconnect and protected by a second confirmation.
50. As an 所有者, I want Command-K for asset navigation, refresh, and lock, with equivalent pointer controls.

## Implementation Decisions

- The product is permanently single-owner, private, and read-only.
- The unauthenticated application surface is an owner login page, not a public homepage or visitor content layer.
- Remove identity, Now, links, Markdown, ordinary content cards, access levels, publish/unpublish actions, restricted placeholders, and content-card CRUD routes.
- The runtime card model contains asset cards only. Persist the field as `assetCards`; when reading legacy data, retain valid asset cards, migrate old restricted asset records, and discard legacy ordinary/public content.
- Keep asset-card ordering, width, row breaks, hidden state, and source identity; card height always follows content.
- Use Passkey as primary authentication and TOTP-only as backup login. Encrypt the TOTP secret at rest, rate-limit failed attempts, and reject reuse of an accepted counter. Sessions are server-validated, `HttpOnly`, browser-session scoped, and automatically locked after 30 minutes of inactivity.
- Put all external sources behind a common read-only adapter interface that returns source identity, holdings, valuation, timestamps, permission status, and platform profit when available.
- Implement Longbridge with the registered web OAuth callback, a private official Rust SDK extension, and macOS Keychain token storage. PKCE verifier and Token remain inside the native module/Keychain. Request and accept only exact `account.read`; reject missing, unknown, additional, or transaction scopes before any asset read or credential persistence.
- Limit Longbridge access to account, stock/fund positions, and pull quotes through the approved read-only SDK surface. Do not expose trade, order, transfer, withdrawal, MCP, or unapproved SDK interfaces.
- Implement Binance, OKX, and Bitget with proven read-only keys. Reject trade, transfer, withdrawal, margin, borrowing, and unknown permissions. Bitget may read the provider-aggregated futures-bot account equity through its dedicated read-only asset endpoint, without reading orders or ordinary futures positions.
- Model observation wallets as public addresses only. Never receive or store seed phrases, private keys, MPC recovery material, signatures, or wallet-connect authority.
- Support Ethereum mainnet and BNB Smart Chain mainnet through one chain-configured EVM adapter. Defer Base, Arbitrum, Solana, Bitcoin, NFTs, staking, LP, lending, and other DeFi positions.
- Use source-native valuation for platform assets and an identified independent price source for observation wallets or missing native prices.
- Preserve unvalued holdings but exclude them from numeric totals. Never fabricate price, value, exchange rate, or profit.
- Fetch immediately after authentication. While visible, refresh prices every 30 seconds and holdings every five minutes; pause scheduled refresh while hidden and allow manual refresh.
- Preserve last successful source data on failure, mark it expired, and propagate incomplete status to the total.
- Persist an immutable daily baseline for today asset change and an updatable daily trend observation for historical trends, both using Asia/Shanghai day boundaries. Do not import transactions or backfill historical data.
- Separate visibility from lifecycle: hiding changes layout only; disconnect removes credentials and stops sync; permanent deletion removes source history after a second confirmation.
- Keep theme, responsive asset layout, Nothing accents, Bloomberg-style financial typography, and Command-K navigation.
- Future remote persistence remains owner-private. Credentials are configured separately in server-side secret storage and are never synchronized through ordinary data.

## Testing Decisions

- Use the real web application in Playwright as the primary seam, with controlled authentication, time, prices, secure-secret storage, and deterministic source adapters.
- Verify the locked homepage contains only the owner login entry and contains no asset layout or asset placeholder.
- Inspect unauthenticated HTML, serialized page state, APIs, and network responses for asset and credential leakage.
- Verify Passkey success/failure, forged sessions, recovery authentication, TOTP limits, manual lock, inactivity lock, and browser-session termination.
- Verify removed content routes return 404 and no identity, Now, links, Markdown, publish, or access-level controls exist after login.
- Verify asset-card ordering, width, responsive reflow, hidden state, disconnect, and permanent deletion through browser-visible behavior.
- Verify onboarding rejects write-capable or ambiguous permissions and leaves no partial source or secret.
- Verify source-native prices, CNY and HKD conversion, stablecoin market prices, unvalued holdings, expired data, and distribution conservation.
- Verify source-isolated refresh, refresh cadence, hidden-page pause, manual refresh, and concurrent source connection.
- Verify daily baseline and trend-observation day boundaries, idempotency, first-success start, same-day trend updates, no backfill, and today asset change semantics.
- Perform real-source acceptance only with owner-confirmed minimum read-only credentials or public addresses.
- Perform manual visual acceptance separately on desktop, medium, and phone widths in light and dark themes.

## Out of Scope

- Public homepage, visitor content, identity profile, Now card, external-links card, Markdown content card, public/private content access levels, publishing, sharing, or public hosting.
- Any order placement, cancellation, transfer, withdrawal, portfolio rebalancing, wallet signature, or other write action.
- Public registration, additional owners, teams, roles, collaboration, or multi-user behavior.
- Futures, options, perpetual contracts, margin, leverage, borrowing, lending, liabilities, income, expenses, tax lots, or complete personal finance.
- Base, Arbitrum, Solana, Bitcoin observation wallets, NFTs, staking, liquidity pools, protocol rewards, and other DeFi parsing in the first version.
- Historical transaction import, automatic history backfill, realized-return reconstruction, or cross-platform profit calculation.
- Active alerts, push notifications, email notifications, operating-system notifications, or real-time streaming market data.
- Synchronizing platform credentials through Supabase or exposing secrets to browsers.

## Further Notes

- `KanBan` is a project name, not a domain term. The product domain term is “个人资产看板”.
- Preserve the distinctions between today asset change and platform profit, expired data and zero assets, unvalued assets and zero-value assets, hiding and disconnecting, and disconnecting and permanent deletion.
- Before any real integration acceptance, inspect and prove minimum read-only authority. If it cannot be proven, stop.
