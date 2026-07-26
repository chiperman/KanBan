# Longbridge SDK 只读持仓接入调研

调研日期：2026-07-26
范围：仅使用 Longbridge 官方文档、官方 OAuth discovery、官方 SDK 源码与官方 API 规范。

## 结论

**可以。** Personal Asset Dashboard 只查看账户总额、股票持仓和基金持仓时，Longbridge 官方 SDK 足够，不需要为了读取持仓改用 MCP。

此前把“SDK 暴露 `submitOrder`”等同于“当前 token 一定有下单权限”是不成立的：

- SDK 把资产查询和订单接口都放在 `TradeContext`，但这是客户端 API 的代码组织方式，不代表凭证权限相同。
- `AccountBalance`、`StockPositions`、`FundPositions` 分别调用只读的 `GET /v1/asset/account`、`GET /v1/asset/stock`、`GET /v1/asset/fund`。
- `SubmitOrder` 单独调用写接口 `POST /v1/trade/order`。
- 官方 CLI 文档明确说明：资产和持仓查询需要 **OAuth account permission**；提交、撤销、改单需要 **OAuth trade permission**。因此服务端确实区分账户权限和交易权限。

不过需要区分两个安全目标：

1. **让本应用永远不下单：可用 SDK 实现。** 只封装三项资产查询，不暴露或调用任何订单方法，并在传输层拒绝非 `GET` 请求和 `/v1/trade/*` 路径。
2. **程序自动证明 token 完全不含交易权限，并在过度授权时拒绝：标准 SDK OAuth Builder 单独做不到，但“自控 OAuth 换 token + SDK 查询”可以做到。** 应用在 token exchange 当下读取官方响应中的 `scope`：账户持仓读取是 `6`（`account.read`），交易写入是 `11`（`trade.write`）；发现 `11`、缺少 `scope` 或出现未批准 scope 时，必须在保存凭证前 fail-closed。

因此 Ticket 06 **不应继续阻塞**。账户、持仓、汇率与 Portfolio P&L 可由服务端以已校验 bearer token 调用官方只读 GET 接口；股票行情则在 Node binding 补齐内存 token 注入前，通过长桥官方只读 MCP `/v2` 调用其 SDK `QuoteContext`。两条通道都不包含订单能力，并继续由 scope 与 endpoint allowlist 双重约束。

## 逐项回答

### 1. SDK 是否允许应用只调用查询接口？

允许。

| 需求 | SDK 方法 | HTTP 边界 | 是否写入账户 |
| --- | --- | --- | --- |
| 账户总额 | `TradeContext.accountBalance` / `account_balance` | `GET /v1/asset/account` | 否 |
| 股票持仓 | `TradeContext.stockPositions` / `stock_positions` | `GET /v1/asset/stock` | 否 |
| 基金持仓 | `TradeContext.fundPositions` / `fund_positions` | `GET /v1/asset/fund` | 否 |
| 下单 | `TradeContext.submitOrder` / `submit_order` | `POST /v1/trade/order` | **是** |

官方 Rust 基础实现直接显示这四个方法的 HTTP verb 与路径；Node.js、Python 共用该 Rust 核心封装，Go SDK 也使用相同的 GET/POST 边界。参见：

- [官方 Rust SDK：SubmitOrder 与三项资产查询](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/src/trade/context.rs#L485-L714)
- [官方 Go SDK：SubmitOrder 与三项资产查询](https://github.com/longbridge/openapi-go/blob/f480e0c84a862caac6bc6ecc75336950f3ec3e7b/trade/context.go#L196-L313)
- [官方 Node.js SDK：方法封装](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/src/trade/context.rs#L345-L477)
- [Account Assets API](https://open.longbridge.com/docs/trade/asset/account)
- [Stock Positions API](https://open.longbridge.com/docs/trade/asset/stock)
- [Fund Positions API](https://open.longbridge.com/docs/trade/asset/fund)
- [Submit Order API](https://open.longbridge.com/docs/trade/order/submit)

`Account Assets` 返回 `net_assets`，可直接作为账户净资产总额；股票和基金持仓返回代码、数量、成本、币种等。股票市值排序如需最新价，再通过 `QuoteContext` 调用行情查询，不需要订单接口。

### 2. OAuth/API 权限能否在平台层限制为只读并由程序验证？

分两部分：

- **平台层有账户/交易权限区分：有第一方证据。** 官方 `positions`、`assets`、`fund-positions` 文档声明需要 `OAuth account permission`；官方 `order` 文档声明下单、撤单、改单需要 `OAuth trade permission`。
- **当前标准 SDK OAuth Builder 能否把 granted scopes 交给应用核验：不能。** 公共 Builder 没有 scope 配置项；Rust 实现请求空 scope，持久化 token 只保存 client id、access token、refresh token、过期时间；Go 实现同样没有设置 `Scopes`，内部 token 也不保存 scope。
- **应用自己控制 token exchange 时能否核验：可以。** Longbridge 官方 MCP 源码对同一官方 OAuth token endpoint 的响应读取 `scope` 字段并按空格拆分；官方 scope 元数据把 `6` 定义为 `account.read`、`10` 定义为 `trade.read`、`11` 定义为 `trade.write`，而其只读 v2 scope 集合明确排除 `11`。

证据：

- [官方 positions 权限说明](https://open.longbridge.com/docs/cli/account/positions)
- [官方 assets 权限说明](https://open.longbridge.com/docs/cli/account/assets)
- [官方 fund-positions 权限说明](https://open.longbridge.com/docs/cli/account/fund-positions)
- [官方 order 权限说明](https://open.longbridge.com/docs/cli/orders/order)
- [Rust OAuth Builder 无 scope 配置](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/builder.rs#L9-L64)
- [Rust OAuth 请求空 scope](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/client.rs#L147-L176)
- [Rust token 未保存 granted scope](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/token.rs#L25-L56)
- [Go OAuth 配置与 token 字段](https://github.com/longbridge/openapi-go/blob/f480e0c84a862caac6bc6ecc75336950f3ec3e7b/oauth/oauth.go#L41-L45)
- [Go OAuth 未设置 Scopes、未保存 scope](https://github.com/longbridge/openapi-go/blob/f480e0c84a862caac6bc6ecc75336950f3ec3e7b/oauth/oauth.go#L273-L298)
- [官方 scope 映射与只读集合](https://github.com/longbridge/longbridge-mcp/blob/b7b58863b578ed1dc068c23c8fe45b85c5be11a8/src/auth/metadata.rs#L133-L144)
- [官方工具到 scope 的完整映射](https://github.com/longbridge/longbridge-mcp/blob/b7b58863b578ed1dc068c23c8fe45b85c5be11a8/data/scopes.json#L121-L189)
- [官方 token exchange 读取并返回 granted scope](https://github.com/longbridge/longbridge-mcp/blob/b7b58863b578ed1dc068c23c8fe45b85c5be11a8/src/tools/authenticate.rs#L75-L87)
- [官方实现按空格解析 token response scope](https://github.com/longbridge/longbridge-mcp/blob/b7b58863b578ed1dc068c23c8fe45b85c5be11a8/src/tools/authenticate.rs#L182-L208)

2026-07-26 实时读取的官方 OAuth discovery 为：

```json
{
  "scopes_supported": ["4", "6", "10", "11"],
  "authorization_endpoint": "https://openapi.longbridge.com/oauth2/authorize",
  "token_endpoint": "https://openapi.longbridge.com/oauth2/token",
  "revocation_endpoint": "https://openapi.longbridge.com/oauth2/revoke"
}
```

来源：[官方 OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server)。其中没有 `introspection_endpoint`；但数值含义已可由上述 Longbridge 官方 MCP 源码交叉验证：

| Scope | 官方含义 | 与本 Ticket 的关系 |
| --- | --- | --- |
| `4` | Watchlist 管理 | 本 Ticket 不需要 |
| `6` | `account.read`：账户资产、现金、股票/基金持仓 | 必需 |
| `10` | `trade.read`：订单和成交查询 | 本 Ticket 不需要 |
| `11` | `trade.write`：下单、改单、撤单、DCA 写入 | 必须拒绝 |

官方资料仍存在版本漂移：OAuth 指南示例 `scope=3`，实时 discovery 列出 `4/6/10/11`，canonical OpenAPI 规范只建模一个 `openapi: Full OpenAPI access`。实现应以实时 discovery 与当前官方 scope 元数据为准，不得继续使用旧示例 `3`：

- [官方 OAuth 指南](https://open.longbridge.com/docs/how-to-access-api)
- [官方 OpenAPI 规范中的单一 scope](https://github.com/longbridge/developers/blob/e1a7f482d1ba277d1a18816db20e031297cbb744/openapi.yaml#L2673-L2683)

结论是：平台支持权限分离；标准 SDK 托管 OAuth 时丢失 scope 证据，但应用自控 token exchange、保存实际 granted scope，就能在凭证落库前可靠拒绝 `11`。对于来源不明的既有 bearer token，仍因没有 introspection 而无法无副作用地补做验证，必须要求重新授权。

### 3. 查询接口和 SubmitOrder 的权限边界是什么？

- 三项查询属于账户/资产读取，使用 GET，官方 CLI 标注 account permission。
- 下单属于交易写入，使用 POST，官方 CLI 标注 trade permission。
- 它们共用 `TradeContext` 和 OAuth 配置，但服务端权限不同。
- “可以构造 `TradeContext`”不代表“可以下单”；SDK 暴露一个方法也不代表 token 已被授权调用该方法。

### 4. Ticket 的“检测到交易权限时拒绝”能否用 SDK/OpenAPI 实现？

**可以完成，但不能只调用标准 SDK OAuth Builder。**

可靠实现边界：

- 应用自己发起 OAuth authorization-code + PKCE，并自行交换 token。
- 在 token exchange 响应中要求 `scope` 存在，解析实际 granted scopes；要求包含 `6`，发现 `11`、未知 scope 或超出本 Ticket 允许范围的 scope 就拒绝。
- 校验通过前不持久化 token；预览失败也不保存任何半成品。
- 校验后的 token 才交给 SDK，只定义 `accountBalance`、`stockPositions`、`fundPositions` 与必要行情读取能力。
- 不导入、不封装、不暴露 `submitOrder`、`replaceOrder`、`cancelOrder`。
- HTTP transport 继续做 allowlist：仅允许指定的 GET 资产/行情路径；任何 POST/PUT/PATCH/DELETE 和 `/v1/trade/*` 一律 fail-closed。

仍然做不到的：

- 从标准 SDK 已持久化的旧 token 中补读 granted scopes。
- 对来源不明的已有 bearer token 通过 introspection 验证，因为 discovery 未提供该 endpoint。
- 通过安全的只读调用反向证明 token 不具备下单权限。

不得用“提交一个无效订单看返回 403”探测：这是交易写接口，既不符合只读边界，也不能保证服务端先做权限检查还是先做参数校验。

### 5. 最安全且最贴合本项目的推荐

推荐使用“受控 OAuth + 官方只读数据适配器”：

1. 不用 SDK 内置 OAuth Builder；应用服务端自行完成 PKCE 和 token exchange。
2. 仅申请本 Ticket 所需权限，要求实际返回 `account.read`/`6`；若响应缺少 scope、包含 `trade.write`/`11`、未知或超范围 scope，连接失败且不保存 token。
3. 校验后的 token 才进入服务端独立加密安全存储；浏览器只拿连接状态与脱敏账户预览。
4. 适配器公开的能力仅为账户总额、股票持仓、基金持仓和必要行情读取。
5. 传输层双重限制：HTTP method allowlist + endpoint allowlist。
6. 自动测试使用官方响应样本，同时断言过度授权被拒绝、校验失败不落库、全流程没有任何非 GET 资产/行情请求和 `/v1/trade/*` 请求。
7. 对旧 token 或外部粘贴 token 一律不接受，要求重新走本应用控制的 OAuth，以便取得可审计 scope 证据。

账户与持仓不需要 MCP；当前仅股票行情使用长桥官方只读 MCP `/v2`，因为其服务端可以把 bearer token 以内存方式交给 Rust SDK `QuoteContext`，且 `/v2` 的官方 allowlist 排除了 `trade.write`。Node binding 将来暴露 `OAuth.fromToken` 后可直接替换这一行情实现，不改变上层适配器。

## Node SDK 4.4.1 的生产实现限制

进一步核对当前 Node binding 后，需要修正“校验后直接把 token 交给 Node SDK”这一实现描述：**4.4.1 的 JavaScript API 没有暴露 Rust core 的 `OAuth::from_token`，也没有暴露自定义 `TokenStorage`。**

- JS 只导出 `OAuth.build(clientId, ...)`；该方法明确读取并写入 `~/.longbridge/openapi/tokens/<clientId>`。
- `Config.fromOAuth` 和 `HttpClient.fromOAuth` 只能接收上述 SDK `OAuth` handle。
- `Config.fromApikey` 是 legacy App Key/HMAC 模式，不能把 OAuth bearer token 当作其 `accessToken` 使用。
- Rust core 虽有 `OAuth::from_token`，但该 factory 未进入 Node N-API binding。

证据：

- [Node OAuth binding 仅导出 build](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/src/oauth.rs#L21-L58)
- [Node 类型声明仅有 OAuth.build](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/index.d.ts#L915-L934)
- [Node Config 的 OAuth 输入只能是 OAuth handle](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/src/config.rs#L153-L180)
- [Rust core 存在未绑定的 from_token](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/client.rs#L63-L81)

### 持仓响应能提供哪些展示字段

`AccountBalance`、`StockPositions`、`FundPositions` 本身不足以提供 Ticket 的所有持仓展示字段：

| 字段 | 仅靠 account/stock/fund | 需要的官方数据 |
| --- | --- | --- |
| 账户总额 | 可以 | `AccountBalance.net_assets` |
| 股票数量、币种、成本 | 可以 | `StockPositions` |
| 股票市值 | 不可以 | `QuoteContext.quote.last_done × quantity`，或逐项 Portfolio detail 的 `holding_value` |
| 股票日涨跌 | 不可以 | `QuoteContext.quote.last_done` 与 `prev_close` |
| 平台计算盈亏 | 不可以 | `PortfolioContext.profitAnalysis` 的 per-security `profit/profit_rate` |
| 基金估算市值 | 可以 | `current_net_asset_value × holding_units` |
| 基金估算成本/盈亏 | 可以自算，但不是平台盈亏字段 | `cost_net_asset_value`、当前 NAV、units；平台口径仍应使用 Portfolio P&L |

官方 `StockPosition` 只有 symbol、name、quantity、available quantity、currency、cost price、market、initial quantity；没有当前价、市值、涨跌或盈亏：[StockPosition 类型](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/src/trade/types.rs#L727-L768)。官方行情对象提供 `last_done`、`prev_close`：[SecurityQuote 类型](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/src/quote/types.rs#L421-L451)。官方 Portfolio P&L 提供逐证券 `profit`、`profit_rate`：[ProfitAnalysisItem](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/src/portfolio/types.rs#L136-L199)。

### 最小可行生产路径

在官方 Node binding 补齐 token 注入前：

1. 受控 OAuth/PKCE、scope 校验、刷新和加密存储由 Next.js 服务端负责。
2. 账户、持仓和 Portfolio P&L 都是 HTTP GET，可直接使用服务端 `fetch` 携带内存中的 bearer token；不经过 SDK 明文 token 文件。
3. 股票日涨跌使用官方 QuoteContext；当前最小安全实现是长桥官方只读 MCP `/v2`。Node N-API binding 将来增加 `OAuth.fromToken` factory 后，可改为进程内直接调用并在刷新 token 后重建 context。
4. 不建议通过改 `HOME`、临时明文文件或把 bearer token 塞进 `fromApikey` 绕过，这些做法分别破坏安全边界或认证语义。

## 最终判断

- 用户提出的“只查看持仓，不下单”：**SDK 可满足，且是更直接的实现。**
- Ticket 其余读取闭环：**可继续实现。**
- “自动检测并拒绝带交易权限的 token”：**应用自控 token exchange 并检查响应 `scope` 时可实现；标准 SDK Builder 或来源不明的旧 token 不可验证。**
- 最合理的决策：**解除阻塞，采用受控 OAuth scope 校验 + SDK 查询 + 应用/传输层强制只读。**
