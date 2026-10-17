# Binance 只读资产来源 API 调研

调研日期：2026-07-26
范围：仅使用 Binance 官方 Developer Docs、官方 OpenAPI schema、官方 SDK 源码及 Binance 官方 GitHub 文档。未调用任何真实账户或私有 API。

## 结论

Ticket 10 可以用 Binance 官方 REST API 实现，但“只读”必须拆成三层，并且要承认平台证明能力的边界：

1. **Key 级权限预检**：连接保存前调用 `GET /sapi/v1/account/apiRestrictions`，要求 `enableReading === true`，并严格拒绝所有已知交易、杠杆、期权、提现和划转能力。
2. **应用传输层只读**：固定 Binance 官方主机，采用精确的 `HTTP method + path` allowlist；特别注意 Funding Wallet 是读取接口，却使用 `POST`，不能简单用“只允许 GET”实现。
3. **用户侧专用 Key**：要求用户在 Binance API Management 创建专用 Key，只开启 Reading，并推荐绑定服务器 IP。API 返回能证明当前文档列出的权限位，但不能证明 Binance 将来新增、响应缺失或未建模的能力一定关闭。

官方把不少会改变状态的接口也标成 `USER_DATA`，例如 Simple Earn 的自动申购设置、赎回选项设置，以及 Wallet 的部分划转接口。因此 **`USER_DATA` 不等于纯读取，`enableReading=true` 也不能单独作为“这个凭证在 Binance 全域绝无写能力”的证明**。本应用必须同时做权限位 fail-closed 和请求 allowlist，且不得通过试下单、试划转或试提现来探测权限。

资产范围可严格限定为：

- Spot：`GET /api/v3/account`
- Funding Wallet：`POST /sapi/v1/asset/get-funding-asset`
- Simple Earn Flexible：`GET /sapi/v1/simple-earn/flexible/position`
- Simple Earn Locked：`GET /sapi/v1/simple-earn/locked/position`
- Spot 交易对与价格：`GET /api/v3/exchangeInfo`、`GET /api/v3/ticker/price`
- 签名时钟：`GET /api/v3/time`

不调用 Margin、Futures、Portfolio Margin、Options、Loan、Sub-account、Convert、Staking、withdraw、transfer、subscribe、redeem、order 等任何其他产品或写接口。

估值方面，Binance 官方可提供的是 **USDT/BTC 计价或交易对价格，不是法币 USD 总值**：

- Spot ticker 返回交易对价格，例如 `BTCUSDT`。
- Funding Wallet 可选返回 `btcValuation`。
- Simple Earn account 汇总接口提供 BTC/USDT 汇总，但本 Ticket 为保持逐持仓可追溯，应使用 position 明细和原生交易对估值。
- 未发现 Binance 官方提供“账户真实法币 USD 总值”的端点。

因此本 Ticket 的原生估值单位应明确为 **USDT**。USDT 本身可按 `1 USDT` 计量；USDC、FDUSD 等其他稳定币仍必须查询实际 `ASSETUSDT` 价格，不能硬编码为 1。若产品总账只接受 `USD`，则还需要一个明确、可信的 `USDT -> USD` 换算证据；直接把 USDT 改名为 USD 只是产品近似，不是 Binance 原生 USD 估值。没有该证据时，不应伪装成 USD。

## 1. API Key 权限验证

### 1.1 唯一应使用的 Key 级自检端点

`GET /sapi/v1/account/apiRestrictions` 是官方的 “Get API Key Permission” signed endpoint。当前官方响应包含：

| 字段 | 接受条件 | 原因 |
| --- | --- | --- |
| `enableReading` | 必须严格为 `true` | 本 Ticket 的私有资产读取基础能力 |
| `enableSpotAndMarginTrading` | 必须严格为 `false` | Spot/保证金交易写能力 |
| `enableMargin` | 必须严格为 `false` | Margin 能力 |
| `enableFutures` | 必须严格为 `false` | Futures 能力 |
| `enablePortfolioMarginTrading` | 必须严格为 `false` | Portfolio Margin 交易能力 |
| `enableVanillaOptions` | 必须严格为 `false` | Options 交易能力 |
| `enableFixApiTrade` | 必须严格为 `false` | FIX 交易写能力 |
| `enableWithdrawals` | 必须严格为 `false` | API 提现能力 |
| `enableInternalTransfer` | 必须严格为 `false` | 主账户与子账户内部划转能力 |
| `permitsUniversalTransfer` | 必须严格为 `false` | Universal Transfer 能力 |
| `enableFixReadOnly` | `true` 或 `false` 都不构成写权限 | 该字段明确是 FIX Read Only；本 Ticket 不使用 FIX |
| `ipRestrict` | 不属于写权限；生产环境强烈建议为 `true` | 降低 Key 泄漏后的可用范围 |

来源：

- [官方 Wallet API：Get API Key Permission](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account#get-api-key-permission)
- [官方 OpenAPI：权限响应 schema](https://github.com/binance/binance-api-swagger/blob/64b327c0addadd191ca0dca8e6b4cebd8a97c05c/spot_api.yaml#L8748-L8818)
- [官方 Go SDK：当前权限模型含 FIX 与 Portfolio Margin 字段](https://github.com/binance/binance-connector-go/blob/61acd78627b8eea182dc5d4576c10f1d05176143/clients/wallet/src/restapi/models/model_get_api_key_permission_response.go#L19-L35)

推荐验证规则：

```text
accept only when:
  enableReading === true
  every known write/capital-movement capability === false
  every unknown boolean field whose name starts with enable/permit/canTrade/canWithdraw is not true
otherwise reject before credential persistence
```

对于安全关键字段，**缺失不是 false**。如果 Binance 响应缺少当前应有的权限字段、字段类型错误，或出现无法分类的新权限字段，严格模式应停止连接并提示“无法验证只读权限”，而不是默认通过。官方生成 SDK 把这些字段建模成 optional pointer，也说明调用方不能假设字段必然存在。

### 1.2 不能用 `/api/v3/account` 的 `canTrade` 代替 Key 权限

`GET /api/v3/account` 返回 `canTrade`、`canWithdraw`、`canDeposit`、`accountType`、`permissions` 和 `balances`。这些字段描述账户状态/账户类型，不是当前 API Key 的细粒度权限。一个正常账户可以 `canTrade=true`，同时当前专用 Key 的 `enableSpotAndMarginTrading=false`。

因此：

- Key 是否能交易、提现、划转：看 `/sapi/v1/account/apiRestrictions`。
- Spot 账户资产与账户状态：看 `/api/v3/account`。
- 不应因为账户本身可以交易，就拒绝一个已验证为无交易权限的专用 Key。

来源：[官方 Spot API：Account information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#get-account)。

### 1.3 平台无法完全自证的部分

以下负面事实无法只靠安全的读取调用完全证明：

- Binance 未来新增但尚未出现在本地 allowlist 的权限位是否关闭。
- 某个权限字段缺失时，缺失是否等价于 false；官方没有这样的保证。
- 所有被标成 `USER_DATA` 的状态变更接口是否还存在额外、未公开或产品特定的授权判断。
- `permitsUniversalTransfer=false` 只表示 dedicated universal transfer 权限关闭；官方旧 schema 特别说明各业务自己的 transfer API 权限不受该字段影响，不能据此证明全平台所有划转能力都不存在。

官方目录本身显示 `USER_DATA` 中存在 POST 写操作，例如 Wallet 的 dust/transfer/withdraw，以及 Simple Earn 的 `setAutoSubscribe`、`setRedeemOption`。所以不能把“接口安全类型是 USER_DATA”解释成“接口无副作用”。

安全处理：

- 用户创建专用 Key，只勾 Reading，并绑定服务器出口 IP。
- 应用只接受完整、已知且安全的权限响应；异常就停机拒绝。
- 应用仅允许本研究列出的 exact method+path。
- 不发送任何试订单、试划转、试提现、试赎回请求做权限探针。
- 已保存 Key 每次重新连接时重做权限预检；同步时若权限变更错误，来源进入过期状态，不清零旧快照。

## 2. 私有资产读取端点

### 2.1 Spot 账户余额

`GET /api/v3/account`（`USER_DATA`、signed、IP weight 20）返回：

- `balances[].asset`
- `balances[].free`
- `balances[].locked`
- 可选请求 `omitZeroBalances=true`，只返回非零余额

单个 Spot 资产数量为 `free + locked`。两者都是十进制字符串，必须用 decimal/bignumber 处理，不能转为 JavaScript `number`。该端点无分页。

来源：[官方 Spot API：Account information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#get-account)。

### 2.2 Funding Wallet

`POST /sapi/v1/asset/get-funding-asset`（`USER_DATA`、signed、IP weight 1）是官方读取端点，使用 `application/x-www-form-urlencoded`：

- 可选 `asset`
- 可选 `needBtcValuation`
- `timestamp`
- 可选 `recvWindow`

响应是数组，每项包含 `asset`、`free`、`locked`、`freeze`、`withdrawing`、`btcValuation`，均以字符串返回。该端点没有分页。

官方没有另给一个 `totalAmount` 字段，也没有在接口说明中明确写出各分区的总额公式。若产品将 Funding 数量显示为 `free + locked + freeze + withdrawing`，应标记为“按 Binance 返回分区计算”，并保留四个分量以便审计；不能把 `btcValuation` 当 USDT/USD 价格，也不能同时把分区和 `btcValuation` 重复计入总资产。

来源：

- [官方 Wallet API：Funding Wallet](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet)
- [官方 OpenAPI：Funding Wallet schema](https://github.com/binance/binance-api-swagger/blob/64b327c0addadd191ca0dca8e6b4cebd8a97c05c/spot_api.yaml#L8321-L8384)

### 2.3 Simple Earn Flexible

`GET /sapi/v1/simple-earn/flexible/position`（`USER_DATA`、signed、IP weight 150）：

- 可选过滤：`asset`、`productId`
- 分页：`current` 从 1 开始，默认 1；`size` 默认 10，最大 100
- 响应：`rows[]` + `total`
- 本 Ticket 的持仓数量字段：`rows[].totalAmount`
- 身份字段：`asset`、`productId`

`collateralAmount`、累计奖励等是其他业务字段，不应额外加到 `totalAmount` 上，否则可能重复计算。

来源：[官方 Simple Earn API：Get Flexible Product Position](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked#get-flexible-product-position)。

### 2.4 Simple Earn Locked

`GET /sapi/v1/simple-earn/locked/position`（`USER_DATA`、signed、IP weight 150）：

- 可选过滤：`asset`、`positionId`、`projectId`
- 分页：`current` 从 1 开始，默认 1；`size` 默认 10，最大 100
- 响应：`rows[]` + `total`
- 本 Ticket 的持仓数量字段：`rows[].amount`
- 身份字段：`positionId`、`projectId`、`asset`
- 状态字段：`status`；另有 `redeemingAmt` 等过程字段

应以 `amount` 作为 position 的官方持仓量；不要再把 `rewardAmt`、`redeemingAmt` 或预估奖励加到本金上。若状态不是产品认可的持有状态，保留原始状态并按未完成/未估值处理，不得静默当零。

来源：[官方 Simple Earn API：Get Locked Product Position](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked#get-locked-product-position)。

### 2.5 Earn 分页算法

两类 position 都应：

1. 从 `current=1&size=100` 开始。
2. 保存第一页返回的 `total`，逐页追加 `rows`。
3. 当已收集条数达到 `total` 时结束。
4. 若在达到 `total` 前收到空页、`total` 缺失/变化、重复 position、页数超出合理上限或 schema 不完整，则本次 Earn 分区同步失败，不提交半页结果。
5. Flexible 可用 `productId + asset` 检测重复；Locked 使用 `positionId`。

官方只保证页码、页大小和 `total`，没有声明跨页快照一致性。因此第 4 条属于应用的 fail-closed 完整性策略。两端点每页各消耗 IP weight 150，不能高频轮询或无限重试。

## 3. 账户分区与排除范围

同步结果应保留分区来源：

| 分区 | 数量字段 | 是否纳入 |
| --- | --- | --- |
| Spot | `free + locked` | 是 |
| Funding | 返回的四个余额分量；总额为应用明确标注的计算值 | 是 |
| Simple Earn Flexible | `totalAmount` | 是 |
| Simple Earn Locked | `amount` | 是 |
| Margin / Isolated Margin | 不调用任何相关端点 | 否 |
| USDⓈ-M / COIN-M Futures | 不调用 `/fapi`、`/dapi` | 否 |
| Portfolio Margin | 不调用 `/papi` | 否 |
| Options | 不调用 `/eapi` | 否 |
| Loans、Collateral、VIP Loan | 不调用任何 loan 端点 | 否 |
| Convert、Staking、On-chain Yields、Sub-account | Ticket 未约定 | 否 |

不要用 Simple Earn `GET /sapi/v1/simple-earn/account` 的汇总再叠加 flexible/locked position，否则会重复计算。该汇总可以作为诊断校验值，但不是本 Ticket 的持仓明细来源。

## 4. Binance 原生行情与 USDT 估值

### 4.1 交易对发现

先用 `GET /api/v3/exchangeInfo` 获取当前交易对、状态、`baseAsset`、`quoteAsset` 和精度字段。只把 `status=TRADING`、Spot 可用、`baseAsset=<资产>`、`quoteAsset=USDT` 的直接交易对纳入价格查询。

来源：[官方 Spot API：Exchange information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general#exchange-info)。

### 4.2 最新价格

`GET /api/v3/ticker/price` 返回 `symbol` 和 `price`；可一次传多个 `symbols`。价格是十进制字符串。

来源：[官方 Spot API：Symbol price ticker](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#ticker-price)。

估值规则：

```text
asset == USDT:
  unitPrice = 1 USDT
else if active direct pair ASSETUSDT exists and ticker price is valid:
  valueUSDT = quantity * price(ASSETUSDT)
else:
  value = unvalued
```

- USDC、FDUSD、TUSD、DAI 等不得因为名称是稳定币就按 1；有 `ASSETUSDT` 时必须取实际价格。
- 不使用订单过滤器的 tick/step 去舍入读取到的余额；那些精度是下单约束，不是资产会计精度。
- 不做未在 Ticket 中约定的 BTC/BNB 多跳合成，也不使用搜索不到的交易对返回零。
- 无直接 USDT 交易对、交易对非 TRADING、ticker 缺失或价格不能解析时，该持仓标记未估值；来源总额和全局总额进入 incomplete，而不是把该持仓按零计算。

### 4.3 价格时间语义

`/api/v3/ticker/price` 响应没有价格时间戳，只有 `symbol`、`price`。因此保存的时间必须标为应用收到响应时的 `observedAt`，不能宣称为 Binance 成交时间。若额外调用 `/api/v3/time`，得到的也只是服务器当前时间，不是 ticker 的原子撮合时间。

建议保存：

```json
{
  "source": "binance:spot:ticker/price:BTCUSDT",
  "quoteCurrency": "USDT",
  "price": "...",
  "observedAt": "...",
  "exchangeTimestamp": null
}
```

### 4.4 USDT 不是法币 USD

当前官方资产/行情证据只支持：

- 交易对的 quote asset（本 Ticket 选 USDT）；
- Funding 的 BTC valuation；
- Simple Earn 汇总的 BTC/USDT valuation。

没有发现法币 `USD` 的账户级可靠折算端点。因此：

- Binance 来源卡片可原生显示 `USDT`。
- 若总资产引擎必须归一到 `USD`，应引入独立、显式且可追溯的 `USDT/USD` 汇率证据。
- 没有该证据时，不应把 `USDT` 数字贴上 `$` 或 `USD` 标签。
- 更不能对所有稳定币同时硬编码 1 USD；这会违背 Ticket 的真实价格要求。

## 5. 请求签名、时间戳与安全存储

### 5.1 Signed 请求

私有端点必须：

- Header：`X-MBX-APIKEY: <apiKey>`
- 参数：`timestamp`
- 可选：`recvWindow`
- 参数：`signature`

HMAC Key 的常规流程是用 secret 对实际发送的参数串做 HMAC-SHA-256，并发送 hex signature。Binance 也支持 RSA/Ed25519，官方推荐 Ed25519 获得更好的性能和安全性；Ticket 若采用用户常见的 API Key + Secret，可先实现 HMAC，但必须签名“最终实际发送的同一序列化字符串”，不能签一份、发送另一份。

来源：[官方 Spot REST API：Request Security 与 SIGNED 示例](https://developers.binance.com/en/docs/products/spot/rest-api#request-security)。

### 5.2 时间安全

- 使用毫秒 `timestamp` 最兼容所有本 Ticket 端点。
- `recvWindow` 默认 5000 ms、最大 60000 ms；官方建议使用 5000 或更小。
- 先用 `GET /api/v3/time` 计算服务器时钟偏移；遇到 `-1021 INVALID_TIMESTAMP` 时刷新偏移并最多重试一次。
- 不把 `recvWindow` 放大到 60000 来掩盖本地时钟错误。

### 5.3 凭证边界

- API Key 与 Secret 只进入服务端安全存储。
- 浏览器只获得来源 ID、连接状态、脱敏预览和同步结果，不得获得原始 Key/Secret。
- 日志、测试快照、异常对象和 URL 不得包含 secret 或完整 signature。
- 主机固定为 Binance 官方 `https://api.binance.com`；不允许用户凭证控制 base URL、scheme、host 或重定向目标。

## 6. 精度与解析

官方余额、数量和价格主要以字符串返回，例如：

- Spot `free`、`locked`
- Funding `free`、`locked`、`freeze`、`withdrawing`、`btcValuation`
- Flexible `totalAmount`
- Locked `amount`
- Ticker `price`

实现必须：

- 用十进制库或整数系数表示，不使用二进制浮点聚合。
- 拒绝 `NaN`、Infinity、科学计数法（除非产品显式支持并能无损规范化）、负余额和 malformed string。
- 保留原始字符串和规范化十进制值用于审计。
- 展示时才按 UI 规则格式化；持久化和快照不能先截断。
- `exchangeInfo` 的 asset precision / price tick 是交易规则，不应拿来截断账户余额。

## 7. HTTP、业务错误与刷新语义

Binance 通用错误 JSON：

```json
{ "code": -1121, "msg": "Invalid symbol." }
```

关键错误：

| 信号 | 官方语义 | 本 Ticket 处理 |
| --- | --- | --- |
| HTTP 4xx | 请求方错误 | 不提交本次分区；按 code 分类 |
| HTTP 403 | WAF/安全规则 | 失败并退避，不重试风暴 |
| HTTP 429 | 超出 rate limit | 遵守 `Retry-After`，来源过期 |
| HTTP 418 | IP 因持续超限被封 | 停止自动重试直到解除时间 |
| HTTP 5xx | Binance 内部错误，执行状态可能未知 | 本 Ticket 全是查询，可在预算内幂等重试；仍不得用空/零覆盖旧数据 |
| `-1003` | 请求过多/IP ban | 退避并尊重限制 |
| `-1006` / `-1007` | 响应/执行状态未知 | 查询可有限重试；不提交部分结果 |
| `-1021` | timestamp 超出 recvWindow或领先服务器 1000 ms | 同步 server time 后最多重试一次 |
| `-1022` | signature 无效 | 凭证/实现错误，停止本次同步 |
| `-1121` | symbol 无效 | 若资产无有效直接对则标记未估值，不写零 |
| `-2014` | API key 格式无效 | 连接拒绝 |
| `-2015` | API key、IP 或权限不允许 | 连接/权限错误，拒绝或将既有来源标记过期 |

来源：

- [官方 Spot REST API：HTTP Return Codes、Limits、Request Security](https://developers.binance.com/en/docs/products/spot/rest-api)
- [官方 Binance Spot API 错误码](https://github.com/binance/binance-spot-api-docs/blob/a5e0bc3ddc0fd7e6bb696849323b74423fa3a54d/errors.md)

所有私有分区应先完整抓取、解析和验证，再原子生成新 Binance snapshot。任一请求失败、分页不完整、schema 错误或关键数量非法时：

- 不保存半成品；
- 不把失败分区写成零；
- 保留上次成功快照；
- 来源进入 expired/incomplete，并记录可展示的脱敏错误。

Spot/Funding/Earn 是同一 Binance 来源内的约定范围。若产品允许分区隔离提交，必须在 UI 明确显示哪一分区过期；否则建议整个 Binance source snapshot 原子提交，避免用户误以为来源完整。

## 8. 精确请求 allowlist

推荐生产 allowlist：

```text
GET  /api/v3/time
GET  /api/v3/exchangeInfo
GET  /api/v3/ticker/price
GET  /api/v3/account
GET  /sapi/v1/account/apiRestrictions
POST /sapi/v1/asset/get-funding-asset
GET  /sapi/v1/simple-earn/flexible/position
GET  /sapi/v1/simple-earn/locked/position
```

必须显式拒绝：

- 所有 `/api/v3/order*`、`/api/v3/openOrders*`
- 所有 `/sapi/v1/margin*`
- 所有 `/fapi/*`、`/dapi/*`、`/papi/*`、`/eapi/*`
- 所有 withdraw、transfer、convert、dust、subscribe、redeem、setAutoSubscribe、setRedeemOption
- allowlist 外的任何 method/path
- 跨主机重定向

注意：Funding Wallet 的 `POST` 是官方查询语义，可按同一参数安全重试，但只能放行这一条精确 POST；不能放行 Wallet 或 `sapi` 的通配 POST。

## 9. 自动测试应使用的官方响应边界

不得在自动测试调用真实账户。建议 fake transport 记录所有请求，并覆盖：

1. **安全权限通过**：`enableReading=true`，所有已知写/划转/提现字段为 false。
2. **逐字段权限拒绝**：spot/margin、margin、futures、portfolio margin、options、FIX trade、withdrawal、internal transfer、universal transfer 任一为 true 都拒绝，且凭证不落库。
3. **缺失/未知权限**：关键字段缺失、类型错误、未知 `enable*` 为 true 时 fail closed。
4. **账户分区**：同一 asset 在 Spot、Funding、Flexible、Locked 各自出现，最终保留分区并只加一次。
5. **分页**：两页、最后一页不足 size、空页提前结束、`total` 变化、重复 position、超过上限。
6. **精度**：极小数、很多小数位、大整数、小数尾零，断言聚合无浮点误差。
7. **USDT 计价**：USDT 本身为 1 USDT；BTC 使用 `BTCUSDT`。
8. **稳定币实际价**：例如 fixture 中 `USDCUSDT=0.9997`，断言不是 1。
9. **无交易对**：持仓保留、价格和值为未估值，来源/总资产 incomplete，不是零。
10. **价格时间**：fixture ticker 无时间戳，断言只保存本地 `observedAt`，不伪造 exchange timestamp。
11. **错误**：`-1021` 只同步时钟重试一次；429/418 退避；`-2015` 拒绝；5xx/timeout 不覆盖旧快照。
12. **请求边界**：请求日志只出现第 8 节的 exact allowlist；没有任何 order/margin/futures/withdraw/transfer/earn mutation。
13. **凭证隐私**：HTML、RSC、浏览器网络响应、普通 source snapshot、日志和测试报告都不出现 Key/Secret/signature。

## 10. 实现决策摘要

- 可以实现 Ticket 10，但要把 Binance 原生计价称为 USDT，不应无证据称为 USD。
- 连接事务顺序：临时持有凭证 → 权限预检 → 全范围预览 → 全部成功后原子保存凭证与来源；失败不留下半成品。
- `apiRestrictions` 是 Key 权限依据；`/api/v3/account.canTrade` 不是。
- 已知写权限位必须严格 false；缺失/未知能力 fail closed。
- Funding 是唯一允许的 POST 读取端点。
- Spot/Funding/Earn 只使用官方明细字段，保持分区，不叠加汇总造成重复。
- Flexible/Locked 完整分页后才提交；每页 weight 150。
- 所有数字保持 decimal string 精度。
- 估值只用 USDT 本身或有效直接 `ASSETUSDT`；其他稳定币也取真实价格；无交易对就是未估值。
- ticker 没有价格时间戳，只能保存接收时刻 `observedAt`。
- 任何错误、未估值或分页不完整都不能伪造为零。

## 官方来源索引

- [Binance Spot REST API 总则、签名与错误语义](https://developers.binance.com/en/docs/products/spot/rest-api)
- [Get API Key Permission](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account#get-api-key-permission)
- [Spot Account Information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#get-account)
- [Funding Wallet](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet)
- [Simple Earn Flexible/Locked Positions](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)
- [Exchange Information / Server Time](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general)
- [Symbol Price Ticker](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#ticker-price)
- [官方 OpenAPI schema](https://github.com/binance/binance-api-swagger/blob/64b327c0addadd191ca0dca8e6b4cebd8a97c05c/spot_api.yaml)
- [官方 Go SDK](https://github.com/binance/binance-connector-go/tree/61acd78627b8eea182dc5d4576c10f1d05176143)
- [官方 Spot API 错误码](https://github.com/binance/binance-spot-api-docs/blob/a5e0bc3ddc0fd7e6bb696849323b74423fa3a54d/errors.md)
