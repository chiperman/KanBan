# 长桥与 Binance 资产来源卡片账户身份字段调研

- 调研日期：2026-07-29（Asia/Shanghai）
- 范围：当前 KanBan 源码；Longbridge 与 Binance 的官方 API/SDK 文档。未调用真实私有接口，未读取或记录任何 Key、Token、完整凭证或资产金额。
- 问题：资产来源卡片可显示什么“账户 ID”，以及该值是否为平台真实账户身份。

## 结论

| 平台 | 当前可用、可显示的值 | 身份性质 | 不应表述为 |
| --- | --- | --- | --- |
| Binance | `GET /api/v3/account` 的 `uid` | **平台真实 UID**。当前代码已优先采用它。 | 昵称、邮箱或 API Key ID |
| Longbridge | 官方持仓响应的 `account_channel` | **账户属性**（账户类型），不是账户号，不能区分同类型的两个账户。 | 长桥证券账户号或用户 ID |
| Longbridge（当前生产卡片） | `sha256("macos-keychain:" + clientId)` 的前 12 位 | **客户端/凭证引用指纹**；`clientId` 是 OAuth 应用客户端标识，不是用户/证券账户标识。 | 长桥真实账户 ID |
| Longbridge（未接入生产的旧 REST 实现） | `sha256(accessToken.sub)` 的前 12 位 | **Token 声明派生指纹**。官方账户/持仓 API schema 未把它定义为证券账户号。 | 官方账户 ID |

因此，当前卡片的安全、诚实显示方式是：

- Binance：`Binance 账户 · UID <uid>`。
- Longbridge：只能显示“长桥账户 · <账户类型>”或“长桥账户 · 已授权”；若为排错需要区分本机连接，可附加“本机连接指纹 <短指纹>”，但必须明确其不是证券账户号。

在当前接入 allowlist（长桥 `/v1/asset/account`、`/v1/asset/stock`、`/v1/asset/fund`；Binance `/api/v3/account` 与权限预检）及其官方响应 schema 中，**没有返回用户昵称、邮箱或长桥证券账户号**。Binance 的已选账户接口也不返回昵称或邮箱。

## 字段逐项判定

### Binance

1. 官方 `GET /api/v3/account` 的响应字段明确含 `uid`（`integer int64`），同时含 `accountType`、`permissions`、余额和账户状态字段。[Account information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#get-account) 的响应 schema 与示例均列出 `uid`。
2. 当前实现先读取该接口；若 `account.uid` 是数字或字符串，则以其构造 `binance:<uid>` 和卡片文案 `Binance 账户 · UID <uid>`。[`src/server/asset-sources/binance.ts`](../../../../src/server/asset-sources/binance.ts#L1234-L1242) [第 1425–1434 行](../../../../src/server/asset-sources/binance.ts#L1425-L1434)。
3. `accountType` 与 `permissions` 是账户属性/能力，不是身份号。`/sapi/v1/account/apiRestrictions` 返回的是当前 API Key 的权限、`ipRestrict` 与 `createTime`，并不返回 UID；不能用它替代账户身份。[Get API Key Permission](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account#get-api-key-permission)。
4. 当 `uid` 缺失时，当前代码退化为 `sha256(apiKey)` 前 12 位。该值只是**凭证指纹**，不应在 UI 中标为 UID 或真实账户 ID；这是官方 `uid` 缺失时的本地兜底，而非平台字段。[`src/server/asset-sources/binance.ts`](../../../../src/server/asset-sources/binance.ts#L1425-L1427)。
5. 官方账户响应 schema 没有 `nickname` 或 `email` 字段。因此当前接口不能显示这两项；本结论限定于该接口，未泛称 Binance 全部产品 API 都没有它们。

### Longbridge

1. 官方 `GET /v1/asset/stock` 的响应把 `account_channel` 定义为 **Account type**；这只是账户属性。它与股票持仓同级返回，并没有账户号字段。[Stock Positions](https://open.longbridge.com/docs/trade/asset/stock) 的 `stock_rsp` schema。
2. 官方 `GET /v1/asset/account` 的 schema 只列资金/币种/风控等账户资产字段（例如 `currency`、`net_assets`、`cash_infos`），没有 `account_id`、账户号、昵称或邮箱。[Account Assets](https://open.longbridge.com/docs/trade/asset/account)。
3. 当前生产组装实际实例化 `KeychainLongbridgeOAuth`，而非旧的 `ProductionLongbridgeOAuth`。[`src/server/production.ts`](../../../../src/server/production.ts#L1821-L1843)。前者的 `credentialReference()` 固定为 `macos-keychain:<clientId>`；随后以该引用的 SHA-256 前 12 位生成 `longbridge:<fingerprint>` 与卡片文案。[`src/server/asset-sources/longbridge-keychain-sdk.ts`](../../../../src/server/asset-sources/longbridge-keychain-sdk.ts#L167-L173) [`src/server/asset-sources/longbridge.ts`](../../../../src/server/asset-sources/longbridge.ts#L812-L842)。
4. 所以当前生产 Longbridge `account.id` 是**本机 Keychain/OAuth 客户端引用的短哈希**。它不从长桥账户资产或持仓响应取得，不能证明、也不能声称为真实证券账户号。
5. 仓库仍保留的 `ProductionLongbridgeOAuth` 会解析 access token 的 `sub`，取其中的 `account_channel`，再以整个 `sub` 的短哈希作为 ID。该类没有被当前生产组合使用；而且官方资产 API 的 schema 仅把 `account_channel` 定义为账户类型，未把 token `sub` 或其哈希定义为证券账户号。因此这也只能归类为 token 派生指纹。[`src/server/asset-sources/longbridge.ts`](../../../../src/server/asset-sources/longbridge.ts#L459-L521)。
6. 当前 Longbridge 官方资产与持仓响应 schema 不含用户昵称、邮箱或证券账户号。该结论同样只覆盖当前已接入的官方资产端点，不外推至 Longbridge 未接入的私有产品或 App 页面。

## 现有稳定性含义

来源确认会把 `account.id` 作为“预览与确认是否同一账户”的比较项。[`src/server/asset-source-onboarding.ts`](../../../../src/server/asset-source-onboarding.ts#L215-L234)。因此：

- Binance 的 `uid` 可作为跨 API Key 重连时的真实账户一致性依据。
- Longbridge 当前生产短指纹只适合识别“同一台本机、同一 OAuth clientId/Keychain 引用”，**不具备**区分不同长桥证券账户的官方保证；不能把它当作多账户去重键。

本次仅记录事实，不修改接入或卡片代码。

## 一手来源

- [Binance Account information — `GET /api/v3/account`](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#get-account)
- [Binance Get API Key Permission — `GET /sapi/v1/account/apiRestrictions`](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account#get-api-key-permission)
- [Longbridge Account Assets — `GET /v1/asset/account`](https://open.longbridge.com/docs/trade/asset/account)
- [Longbridge Stock Positions — `GET /v1/asset/stock`](https://open.longbridge.com/docs/trade/asset/stock)
- 当前仓库代码：[`src/server/asset-sources/binance.ts`](../../../../src/server/asset-sources/binance.ts)、[`src/server/asset-sources/longbridge.ts`](../../../../src/server/asset-sources/longbridge.ts)、[`src/server/asset-sources/longbridge-keychain-sdk.ts`](../../../../src/server/asset-sources/longbridge-keychain-sdk.ts)、[`src/server/production.ts`](../../../../src/server/production.ts)。
