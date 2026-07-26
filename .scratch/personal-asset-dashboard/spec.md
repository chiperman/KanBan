Status: ready-for-agent

# Personal Asset Dashboard

## Problem Statement

所有者的证券、中心化交易平台资产和链上资产分散在多个资产来源中，必须分别打开长桥、Binance、OKX、Bitget 和钱包才能了解当前投资资产。各来源的计价方式、更新时间和持仓结构不同，既难以快速获得完整总览，也难以形成连续的历史趋势。

所有者还希望把个人资料和个性化内容组织成一个可分享的公开主页，同时保证投资资产、持仓、盈亏和不公开内容只有本人登录后才能查看。现有的通用任务看板、投资交易工具或个人主页产品无法同时满足自由卡片编排、只读资产聚合、严格隐私隔离和鲜明个人视觉表达。

## Solution

构建一个本地优先、单所有者的个人终端。页面由宽度可配置、高度随内容变化的卡片组成：访客看到公开主页及不含真实数据的受限卡片遮罩；所有者完成身份验证后，在同一布局中查看总资产概览、各资产来源和完整持仓。

个人终端只读取并展示投资资产，不执行交易、划转、提现、签名或调仓。首版接入长桥、Binance、OKX、Bitget，以及品牌无关的观察钱包。资产按来源原生定价，默认折算为 USD，并可切换为 CNY。系统定时同步、保存每日资产快照，并明确区分今日资产变动、平台盈亏、过期数据和未估值资产。

公开内容、卡片布局、历史快照和设置为将来接入 Supabase 做准备；只读凭证始终与浏览器及普通同步数据隔离。视觉以 Efferd Dashboard 的清晰卡片结构为基础，结合 Nothing 点阵像素语言和 Bloomberg Terminal 的等宽数字、ASCII 分隔及高信息密度。

## User Stories

1. As an 所有者, I want to see all supported investment assets on one page, so that I can understand my overall position without opening several products.
2. As an 所有者, I want the total asset overview to be the first visual focus, so that I can understand the most important information within seconds.
3. As an 所有者, I want the total asset overview to show current value, today asset change, and asset distribution, so that I can quickly assess my portfolio state.
4. As an 所有者, I want USD to be the default valuation currency, so that securities and crypto assets share a familiar reporting basis.
5. As an 所有者, I want to switch the valuation currency to CNY, so that I can view the same assets in my domestic reference currency.
6. As an 所有者, I want each holding to retain its original currency, so that currency conversion does not hide the source data.
7. As an 所有者, I want asset distribution to default to securities versus crypto assets, so that the highest-level allocation is easy to understand.
8. As an 所有者, I want to switch distribution to asset source, so that I can compare Longbridge, Binance, OKX, Bitget, and observation wallets.
9. As an 所有者, I want to switch distribution to currency, so that I can see currency concentration.
10. As an 所有者, I want each asset source card to show its total and top five holdings, so that cards remain compact.
11. As an 所有者, I want to open an asset source detail panel, so that I can inspect every holding without making the dashboard card excessively tall.
12. As an 所有者, I want to sort holdings by market value, change, or name, so that I can find relevant positions quickly.
13. As an 所有者, I want each holding to show name or symbol, quantity, current price, market value, and available profit information, so that the position is understandable.
14. As an 所有者, I want closing a detail panel to restore my former page position, so that drilling into holdings does not disrupt dashboard navigation.
15. As an 所有者, I want Longbridge securities and fund positions to be read through exact account scope 6 and three allowlisted asset REST GET endpoints, so that brokerage assets are included without market-data or trading authority.
16. As an 所有者, I want Binance spot assets to be included, so that my exchange balances appear in the personal terminal.
17. As an 所有者, I want Binance funding and Earn assets to be included, so that non-spot investment balances are not omitted.
18. As an 所有者, I want OKX spot, funding, and Earn assets to be included, so that the source total matches the agreed account scope.
19. As an 所有者, I want Bitget spot, funding, and Earn assets to be included, so that the source total matches the agreed account scope.
20. As an 所有者, I want margin, futures, borrowing, and other leveraged accounts excluded, so that liabilities and leveraged positions do not blur the defined investment-asset boundary.
21. As an 所有者, I want to add an observation wallet using public addresses, so that I can see chain assets without connecting a wallet.
22. As an 所有者, I want observation wallets to be independent of wallet brand, so that MetaMask, OKX Wallet, Trust Wallet, Ledger, Binance Web3 Wallet, and similar products can be represented by their addresses.
23. As an 所有者, I want Ethereum addresses supported, so that ETH and ERC-20 balances can be displayed.
24. As an 所有者, I want BNB Smart Chain addresses supported, so that BNB and BEP-20 balances can be displayed.
25. As an 所有者, I want Ethereum and BNB Smart Chain to share one configurable EVM watch-wallet adapter, so that supporting the two chains does not duplicate the complete integration.
26. As an 所有者, I want Base and Arbitrum excluded until I actually use them, so that unused chains do not add RPC and maintenance complexity.
27. As an 所有者, I want Solana deferred until I actually use it, so that the first version does not carry a separate SPL Token implementation without product value.
28. As an 所有者, I want observation wallets to remain watch-only, so that the personal terminal never needs a private key, seed phrase, MPC recovery material, signature, or transaction permission.
29. As an 所有者, I want NFT, staking, LP, lending, and other DeFi positions excluded from the first version, so that chain valuation remains understandable and reliable.
30. As an 所有者, I want assets held on a platform to use that platform's native quote or valuation, so that platform cards remain consistent with their source.
31. As an 所有者, I want observation-wallet assets to use an independent reference price, so that chain balances can receive a USD valuation without a custody platform.
32. As an 所有者, I want the price source to be shown when an independent reference price is used, so that valuation provenance is transparent.
33. As an 所有者, I want stablecoins valued at their actual market price, so that a depeg is not hidden behind a fixed one-dollar assumption.
34. As an 所有者, I want the same asset on different platforms to be allowed small price differences, so that source-native valuation remains truthful.
35. As an 所有者, I want an asset with no reliable price to retain its quantity and identity, so that lack of valuation does not erase a real holding.
36. As an 所有者, I want unvalued assets excluded from the numeric total rather than treated as zero, so that the total is not misleading.
37. As an 所有者, I want the total asset overview to warn when unvalued assets exist, so that I know the aggregation is incomplete.
38. As an 所有者, I want source data refreshed immediately when I open the page, so that I do not begin with unnecessarily old information.
39. As an 所有者, I want market prices refreshed every 30 seconds while the page is visible, so that displayed prices remain useful without requiring streaming infrastructure.
40. As an 所有者, I want balances and holdings refreshed every five minutes while the page is visible, so that account data stays current without excessive private API calls.
41. As an 所有者, I want background refresh paused while the page is hidden, so that API usage is not wasted.
42. As an 所有者, I want a manual refresh action, so that I can request a new reading when needed.
43. As an 所有者, I want each source to show its last successful update time, so that I can judge data freshness.
44. As an 所有者, I want the last successful data preserved when a source fails, so that a temporary error never appears as zero assets.
45. As an 所有者, I want failed source data marked as expired, so that preserved values are not presented as current.
46. As an 所有者, I want the total asset overview to state when it includes expired data, so that a mixed-time total is explicit.
47. As an 所有者, I want refresh errors to explain the affected source without replacing good data, so that failures remain diagnosable and non-destructive.
48. As an 所有者, I want one daily asset snapshot based on Asia/Shanghai time, so that historical charts share a consistent day boundary.
49. As an 所有者, I want the daily baseline to begin at 00:00 Asia/Shanghai, so that “today” has an unambiguous meaning.
50. As an 所有者, I want history to begin with the first successful synchronization, so that the system never fabricates a past it did not observe.
51. As an 所有者, I want no automatic historical backfill, so that inconsistent platform history does not contaminate the snapshot series.
52. As an 所有者, I want no transaction-ledger import in the first version, so that read-only portfolio display remains the focus.
53. As an 所有者, I want snapshot difference called today asset change rather than investment profit, so that deposits, withdrawals, and transfers are not misrepresented.
54. As an 所有者, I want platform profit shown only when the source explicitly provides it, so that the platform's own calculation remains clearly scoped.
55. As a 访客, I want to see a public personal homepage without logging in, so that the owner can eventually share selected personal content.
56. As a 访客, I want to see the page's intended card composition even when asset cards are restricted, so that the public homepage retains its designed visual rhythm.
57. As a 访客, I want restricted cards rendered only from sanitized placeholder data, so that blur or masking never exposes real asset values in page source or network responses.
58. As a 访客, I want clicking a restricted card to open the login flow, so that the transition to owner access is understandable.
59. As a 访客, I want public identity content such as avatar, nickname, and a short introduction, so that I can understand whose homepage I am viewing.
60. As a 访客, I want a Now card, so that I can see what the owner is currently doing or following.
61. As a 访客, I want a links card, so that I can reach the owner's selected external profiles and sites.
62. As a 访客, I want selected personalized content, so that the public homepage has personality beyond financial data.
63. As an 所有者, I want ordinary cards to default to private, so that content is not accidentally published.
64. As an 所有者, I want to publish an ordinary card deliberately, so that I control what appears on the public homepage.
65. As an 所有者, I want every asset card permanently private, so that financial data cannot be made public through a configuration mistake.
66. As an 所有者, I want fixed forms for identity, Now, and links cards, so that common content is easy to edit.
67. As an 所有者, I want a Markdown custom card, so that I can add expressive content without a full block editor.
68. As an 所有者, I want editing controls hidden from visitors, so that the public view remains read-only.
69. As an 所有者, I want a dedicated layout-editing mode, so that normal browsing cannot accidentally move cards.
70. As an 所有者, I want to drag cards to reorder them in layout-editing mode, so that the dashboard reflects my priorities.
71. As an 所有者, I want each card to occupy one, two, or three logical columns, so that information density can vary by content.
72. As an 所有者, I want card height determined by content, so that the layout avoids arbitrary empty space.
73. As an 所有者, I want a three-column logical grid on desktop, so that the dashboard supports the intended card widths.
74. As an 所有者, I want the grid to collapse to two columns at medium widths, so that it remains readable in a narrow desktop window.
75. As an 所有者, I want cards to collapse to one column on phones, so that public content remains usable on small screens.
76. As an 所有者, I want one desktop order to drive responsive reflow, so that I do not maintain separate layouts for every screen size.
77. As an 所有者, I want the theme to follow the operating-system setting by default, so that the page fits the surrounding environment.
78. As an 所有者, I want to override the theme with light or dark mode, so that I retain control over appearance.
79. As an 所有者, I want my explicit theme choice remembered, so that it persists across visits.
80. As an 所有者, I want a white-first light theme, so that the default visual character remains clean and personal.
81. As an 所有者, I want Nothing-inspired dot-matrix and pixel details used as accents, so that the page has a recognizable visual identity without harming readability.
82. As an 所有者, I want Bloomberg-inspired monospaced numbers, ASCII separators, and compact status information, so that financial data feels precise and efficient.
83. As an 所有者, I want Efferd-inspired clear card hierarchy and spacing, so that the combined visual languages remain coherent.
84. As an 所有者, I want a Command-K menu for card navigation, refresh, and lock, so that common actions are keyboard-accessible.
85. As an 所有者, I want ordinary pointer interactions to remain complete, so that the product is not dependent on terminal commands.
86. As an 所有者, I want Passkey to be the primary login method, so that unlocking is both strong and convenient.
87. As an 所有者, I want email, a strong password, and TOTP as a recovery method, so that losing the primary Passkey does not permanently lock me out.
88. As an 所有者, I want public registration disabled, so that the personal terminal remains a single-owner system.
89. As an 所有者, I want no social login or SMS authentication, so that unnecessary identity providers and weaker recovery paths are avoided.
90. As an 所有者, I want sensitive information automatically locked after 30 minutes of inactivity, so that an unattended page does not remain exposed.
91. As an 所有者, I want closing the browser to end the sensitive session, so that reopening begins from a safe state.
92. As an 所有者, I want a visible manual lock action, so that I can hide sensitive information immediately.
93. As an 所有者, I want a locked session to return to the public homepage with restricted-card placeholders, so that the page has a consistent post-lock state.
94. As an 所有者, I want to add an asset source through one consistent workflow, so that connecting different platforms feels predictable.
95. As an 所有者, I want source permissions validated before saving, so that a credential with trade, transfer, or withdrawal authority is rejected.
96. As an 所有者, I want source identity and readable asset scope previewed before confirmation, so that I know which account will be connected.
97. As an 所有者, I want failed source validation to save no credential, so that partially configured secrets are not retained.
98. As an 所有者, I want all platform credentials kept outside browser-readable storage, so that frontend compromise cannot reveal them.
99. As an 所有者, I want local credentials stored only in secure local server storage, so that the local-first version preserves the credential boundary.
100. As an 所有者, I want future remote deployment to require separate server-side secret configuration, so that secrets are not copied through ordinary data synchronization.
101. As an 所有者, I want Supabase to synchronize public content, layouts, settings, and snapshots in the future, so that remote access can be added without changing the product model.
102. As an 所有者, I want future Supabase access controlled by authenticated ownership and row-level authorization, so that login alone never grants broad database access.
103. As an 所有者, I want to hide a card without changing synchronization, so that layout changes do not affect data collection.
104. As an 所有者, I want to disconnect a source by deleting its credential and stopping synchronization while retaining snapshots, so that I can stop access without losing history.
105. As an 所有者, I want source-data deletion separate from disconnection, so that destructive cleanup cannot happen accidentally.
106. As an 所有者, I want permanent source-data deletion to require a second confirmation, so that historical snapshots are protected from misclicks.
107. As an 所有者, I want no active price, asset-change, or system notifications in the first version, so that the product remains focused on accurate display.

## Implementation Decisions

- Build a local-first web application with a public homepage and an authenticated owner experience sharing one card layout.
- Keep the product single-owner permanently. Disable public registration and model visitors as unauthenticated read-only viewers, not additional users.
- Separate the application into high-level capabilities: authentication and authorization, public/private card content, layout composition, asset-source onboarding, asset-source adapters, synchronization, valuation, snapshots, secure credential storage, and settings.
- Put all external asset sources behind a common read-only adapter contract that can return source identity, balances, holdings, source valuation, platform profit when available, data timestamps, and permission status.
- Implement Longbridge with OAuth 2.0 Authorization Code + PKCE. Request and accept only exact `scope=6`; reject missing, unknown, additional scopes and `scope=11` before any asset read or credential persistence.
- Limit Longbridge production data access to official REST `GET /v1/asset/account`, `GET /v1/asset/stock`, and `GET /v1/asset/fund`. Do not use Longbridge quotes, MCP, the `longbridge` SDK, WebSocket, or any trade endpoint.
- Implement Binance, OKX, and Bitget with read-only keys. Reject credentials that expose trade, transfer, or withdrawal permissions.
- Treat platform credentials as server-only secrets. Persist only an opaque secret reference alongside ordinary source configuration; never return secret material through browser APIs, logs, snapshots, or Supabase-synchronized records.
- In the local-first version, use operating-system-backed or equivalently secure server-side secret storage. A future hosted deployment must configure credentials independently in its server-side secret store.
- Model observation wallets as one or more public chain addresses. No wallet-connect protocol, seed phrase, private key, MPC recovery material, signature, or transaction API is permitted.
- Support only Ethereum mainnet (chain ID 1) and BNB Smart Chain mainnet (chain ID 56) in the first version through one chain-configured EVM observation-wallet adapter. Resolve ETH/BNB and ERC-20/BEP-20 balances only; do not implement Base, Arbitrum, Solana, SPL Token, or separate per-chain business flows.
- Use a server-configured indexed EVM provider to discover fungible-token balances because standard Ethereum JSON-RPC cannot enumerate every token held by an address. Keep provider API keys and full RPC URLs server-only. CoinGecko supplies reference prices only and is not a wallet-balance source.
- Exclude Bitcoin, NFTs, staking, liquidity-pool positions, lending, and other DeFi protocol positions from the first version.
- Include spot, funding, and Earn balances for supported centralized crypto platforms. Exclude futures, margin, leveraged, borrowing, and lending accounts.
- Use source-native valuation for assets held by Longbridge, Binance, OKX, and Bitget. For Longbridge, trust `/v1/asset/account` `net_assets` as the source total; funds may use native NAV fields, while stocks without a price in the three allowed responses remain unvalued. Do not fabricate a holding price, market value, exchange rate, or platform profit.
- Use CoinGecko as the initial independent reference-price provider for observation-wallet assets and source assets lacking a reliable native price. Identify tokens by chain and contract or mint address rather than symbol alone.
- Use actual market prices for stablecoins. Never hardcode a one-dollar peg.
- Store price source and update time with each valuation. If no reliable price exists, retain the quantity as an unvalued asset and exclude it from the numeric total.
- Convert the unified total to USD by default and allow CNY display through one explicit exchange-rate observation. Preserve native holding currency and native values.
- Define total status as complete, contains expired data, contains unvalued assets, or both. Do not silently hide incomplete aggregation.
- Fetch immediately on page entry. While visible, poll market prices every 30 seconds and private balances and holdings every five minutes. The 30-second cycle is a strict no-op for Longbridge: it performs no network request and no Token refresh; Longbridge account and positions are read only in the five-minute holdings cycle. Pause scheduled polling when the page is hidden and provide manual refresh.
- Treat synchronization as source-isolated. One failing source must not prevent successful sources from updating.
- Preserve the last successful reading when a source fails. Mark it as expired, show its last successful timestamp, retain it in totals, and propagate the expired state to the total asset overview.
- Persist one daily asset snapshot using Asia/Shanghai as the canonical time zone and 00:00 as the daily boundary. Begin on the first successful synchronization and do not backfill history automatically.
- Do not persist or import transaction history in the first version. Compute today asset change from snapshot baselines and never label that value as profit.
- Show platform profit only when a source explicitly supplies it, preserving the platform scope and calculation meaning.
- Model ordinary card access level as private by default with an explicit publish action. Asset cards are permanently private and cannot be made public.
- Render restricted cards from sanitized placeholder models that contain no amount, symbol, source identity, timestamps, or other sensitive information. CSS blur must never be applied to real sensitive data delivered to a visitor.
- Provide structured editors for identity, Now, and links cards, plus a Markdown custom card. Do not build a general block editor.
- Implement a dedicated layout-editing mode. Normal viewing must not permit drag or resize actions.
- Use a three-column logical desktop grid. Cards occupy one, two, or three columns and derive height from content. Collapse to two columns at medium widths and one column on phones while preserving desktop ordering.
- Keep asset cards compact by showing the source total and five largest holdings. Open complete holdings in a detail panel with sorting and return-position preservation.
- Default theme mode to system, with explicit light and dark overrides that persist. Use light styling when the system is light.
- Combine visual references by responsibility: Efferd for card hierarchy and spacing, Nothing for restrained dot-matrix/pixel accents, and Bloomberg Terminal for monospaced financial data, ASCII separators, and compact statuses.
- Keep all functionality available with pointer interaction. Add Command-K only for navigation, refresh, and lock; do not add a terminal command language.
- Use Passkey as the primary owner authentication mechanism. Provide email plus strong password and TOTP as the recovery path. Exclude social login and SMS authentication.
- Enforce authorization on the server and data layer, not only in the UI. When Supabase is introduced, exposed tables require row-level security that binds every private row to the owner; authentication without ownership checks is insufficient.
- Automatically lock sensitive information after 30 minutes without owner activity. End the sensitive session when the browser closes, provide manual lock, and restore the public homepage with restricted placeholders after locking.
- Use a consistent asset-source onboarding flow: choose source, provide authorization material or public addresses, validate read-only scope and connectivity, preview source identity and readable scope, then save and create the card.
- Treat source validation as atomic. A failed validation stores no credential or partially enabled source.
- Separate card visibility from source lifecycle. Hiding affects layout only; disconnecting removes the credential and stops synchronization while preserving snapshots; deleting source data permanently removes source history after a second confirmation.
- Prepare ordinary persistent data for a future Supabase-backed implementation without making Supabase mandatory for local-first operation. Keep identity-provider and persistence boundaries replaceable.
- Use persistent records for cards, card access levels, card content, layout order and span, source configuration without secrets, holdings and valuation observations, sync results, daily snapshots, display preferences, and source lifecycle state.
- Do not add active notifications, trading actions, or write-capable platform clients.

## Testing Decisions

- Use one primary high-level seam: run the real web application in a browser against a test database, controlled authentication, fake clock, fake exchange-rate source, fake reference-price source, fake secure-secret store, and deterministic asset-source adapters.
- Test externally visible behavior rather than component structure, internal method calls, database implementation details, or CSS class names.
- Exercise visitor and owner journeys through the same public application surface. Verify that login changes authorization and rendered content without relying on client-only flags.
- Inspect unauthenticated HTML, serialized page state, API responses, and browser network traffic to prove that restricted cards contain no real sensitive data before authentication.
- Verify that asset cards cannot be published even when ordinary cards can change access level.
- Verify owner-only editing, layout mode, card ordering, one/two/three-column spans, detail-panel navigation, and responsive one/two/three-column behavior through browser-visible outcomes.
- Verify system, light, and dark theme selection and persistence. Treat precise visual quality, Nothing pixel accents, ASCII composition, typography, and spacing as screenshot or manual visual acceptance rather than brittle DOM assertions.
- Verify authentication outcomes for Passkey success and failure, recovery authentication, TOTP challenge, manual lock, 30-minute inactivity lock using a fake clock, browser-session termination, and disabled registration.
- Verify source onboarding as an atomic flow: valid read-only credentials succeed; credentials with trade, transfer, or withdrawal permission are rejected; failed checks leave no source or secret reference behind.
- Verify that browser-accessible responses and logs never contain platform credentials, secret references that can be dereferenced by the client, seed phrases, private keys, or wallet-signing material.
- Use provider response fixtures for Longbridge, Binance, OKX, Bitget, Ethereum, BNB Smart Chain, and CoinGecko. EVM tests must prove that one adapter keeps chain ID and contract identity separate across Ethereum and BNB Smart Chain, handles token-index pagination and rate/error responses, and never exposes provider API keys. Longbridge browser tests must assert exact scope 6, exactly the three allowlisted GET asset endpoints during holdings sync, zero Longbridge network/Token activity during the 30-second price cycle, no order interface or request, no Token disclosure, source-native mapping, and stale-data retention on failure. Other adapters should confirm mapping, precision, pagination, account-scope inclusion, and error normalization without calling real accounts.
- Verify that spot, funding, and Earn assets are included and that futures, margin, leverage, borrowing, lending, NFTs, staking, LP, and DeFi positions are excluded.
- Verify source-native pricing with controlled cross-platform price differences. Confirm that the same asset may have different values per source and that the total sums those source values correctly.
- Verify stablecoins use the supplied actual price rather than a hardcoded peg.
- Verify contract or mint identity prevents different tokens with the same symbol from being merged.
- Verify unvalued assets preserve quantity, stay outside the numeric total, and make the total visibly incomplete.
- Verify the default USD total, CNY conversion, original holding currency, conversion timestamp, and rounding using decimal-safe fixtures.
- Verify initial fetch, 30-second visible-page price polling, five-minute holdings polling, hidden-page pause, and manual refresh with a fake clock rather than real waiting.
- Verify partial synchronization: one source can fail while others update, the failed source retains its last successful reading, expired state propagates to the total, and no failure converts a source to zero.
- Verify daily snapshot creation at the Asia/Shanghai boundary, idempotency within a day, first-success start, no backfill, and correct behavior around midnight.
- Verify today asset change is derived from snapshot baselines and is not labeled as profit. Verify platform profit appears only when explicitly supplied by a provider fixture.
- Verify hiding a card does not stop synchronization, disconnecting removes credentials and stops future sync while retaining snapshots, and permanent deletion requires confirmation and removes the intended history.
- When Supabase is introduced, add authorization tests for anonymous public reads, owner private reads and writes, rejection of every non-owner private operation, RLS on exposed tables, and server-only secret separation.
- Perform a separate real-integration acceptance with dedicated read-only credentials for each supported platform. This is not part of routine automated tests and must never use write-capable credentials.
- Perform a manual visual acceptance on desktop, medium width, and phone width in both light and dark modes.
- There is no existing code or prior test suite in the repository, so no prior-art test pattern can be reused. The browser-level application seam defined here becomes the initial testing convention.

## Out of Scope

- Any order placement, cancellation, transfer, withdrawal, portfolio rebalancing, wallet signature, or other write action.
- Longbridge quote or market-data integration, MCP, `longbridge` SDK, WebSocket, Portfolio P&L endpoints, exchange-rate endpoints, and any endpoint other than the three allowlisted asset REST GETs.
- Public registration, additional owners, teams, roles, collaboration, or a multi-user product model.
- Futures, options, perpetual contracts, margin, leverage, borrowing, lending, liabilities, credit cards, loans, income, expenses, or complete personal finance.
- Bitcoin observation wallets in the first version.
- Base, Arbitrum, Solana, and SPL Token observation-wallet support in the first version.
- NFTs, staking, liquidity pools, lending positions, protocol rewards, and other DeFi position parsing.
- Historical transaction import, automatic history backfill, tax lots, realized-return reconstruction, or a cross-platform profit calculation.
- Active price alerts, asset-change alerts, push notifications, email notifications, or operating-system notifications.
- A complete Notion-style block editor.
- A complete terminal command language or keyboard-only interaction model.
- Real-time streaming market data; the first version uses polling.
- Automatic publication to the internet. The first version is local-first; shareable hosting follows a later deployment and Supabase phase.
- Synchronizing platform credentials through Supabase or exposing secrets to browsers.
- Assuming every asset has a price or silently treating missing prices as zero.

## Further Notes

- `KanBan` is currently a project name, not a domain term. The product is a personal asset dashboard rather than a task-management Kanban; final product naming can be decided separately.
- The implementation must preserve the glossary distinctions between today asset change and platform profit, expired data and zero assets, unvalued assets and zero-value assets, hiding and disconnecting, and disconnecting and permanent deletion.
- API capabilities and security guidance can change. Before implementation, recheck current official documentation for Longbridge, Binance, OKX, Bitget, CoinGecko, and Supabase.
- Any real integration acceptance must begin by inspecting the credential permissions. If read-only authority cannot be proven, stop rather than connecting the credential.
- The next workflow step is `/to-tickets`, which should split this spec into independently implementable tracer-bullet tickets with explicit blocking edges. Do not implement directly from this monolithic spec.
