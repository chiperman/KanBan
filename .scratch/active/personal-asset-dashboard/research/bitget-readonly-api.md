# Bitget 只读资产来源 API 调研

调研日期：2026-07-26
范围：仅使用 Bitget 官方 API 文档、官方 changelog 和官方支持公告。未调用真实账户或私有 API；未修改产品代码。

## 结论

Ticket 12 可以实现，但必须把 **Classic Account** 与 **Unified Trading Account（UTA）** 分成两条读取路径，不能把 UTA 的统一账户总资产直接当成“现货”：

- Classic 使用 `GET /api/v2/spot/account/info` 的 `authorities` 验证当前 Key。只接受官方列出的只读 authority code；出现任一官方写权限、未知权限或缺失字段即拒绝。
- UTA 使用 2026-04-27 新增的 `GET /api/v3/account/info`。只接受 `permType=read-only`；为了同时读取资产并证明没有合约/杠杆敞口，要求只读 scopes 至少包含 `uta_mgt` 和 `uta_trade`，且拒绝 `withdraw`、copy-futures scopes 和未知 scope。
- `uta_trade` 在 `permType=read-only` 下只是读取交易信息的 scope，不代表可下单；真正的写能力由 `permType=read-and-write` 区分。
- Classic 现货、Funding 和 Savings 是独立账户，可以分别读取。UTA 则把 Spot、Margin 和 Futures 资产放在共享资产池；只有在三类 Futures 当前持仓为空、Margin/Futures 未成交单为空、账户风险字段为零、每币种 `debt=0` 时，才可将 UTA `assets[].balance` 作为本 Ticket 的现金持仓数量。
- Earn 只纳入 Savings 的 flexible 与 fixed。SharkFin 属于结构化产品，Loan 属于借贷，均不纳入。
- Earn 的精确明细端点最多查询三个月时间窗并使用 `idLessThan/endId` 分页；需要按账户注册时间倒推完整窗口，并与无分页的 Savings 账户币种总览对账。任一页失败、cursor 重复或对账不一致都不能提交“完整”快照。
- Bitget 原生估值优先使用 UTA `usdValue`、Classic Funding `usdtValue` 或 Bitget Spot ticker。无法取得可靠 Bitget 行情时保留数量并标记未估值，不能按零。
- 官方只列出一个 REST 主域 `https://api.bitget.com`。区域限制是业务错误，不应切换非官方/代理域名绕过。

## 1. API Key 与权限验证

### 1.1 官方权限模型

Bitget Classic Quick Start 明确列出四类能力：

| 权限 | 能力 |
| --- | --- |
| Read-Only | 查询市场和账户数据 |
| Trade | 下单与撤单 |
| Transfer | 账户间划转 |
| Withdraw | 提现；还要求白名单 IP |

API Key、SecretKey 和 Passphrase 共同用于私有请求；官方特别提醒不得泄漏 SecretKey 和 Passphrase，并建议绑定 IP。

来源：[Bitget Classic Quick Start](https://www.bitget.com/api-doc/classic/quickStart/intro)。

### 1.2 Classic：`authorities` 是当前 Key 的机器证明

`GET /api/v2/spot/account/info` 返回：

- `userId`、`parentId`、`inviterId`
- `ips`
- `authorities`
- `traderType`
- `channel`、`channelCode`
- `regisTime`

官方给出的只读 authority code：

```text
coor  futures orders read
cpor  futures positions read
stor  spot trade read
smor  margin trade read
ttor  copy trading read
wtor  wallet transfer read
taxr  taxation read
chor  subaccount read
p2pr  P2P query
pllr  pledge loan read
```

官方列出的写 authority 包括：

```text
coow cpow stow smow ttow wtow wwow chow p2p pllw taxw
```

连接判定应：

1. 要求 `authorities` 是非空字符串数组；去重后解析。
2. 只允许官方已知只读集合。
3. 任一写 code、未知 code、大小写漂移或类型异常均拒绝。
4. 资产、Funding、Savings 预览端点必须全部成功；权限只读但范围不足也不能保存。

这比“尝试调用下单接口看是否失败”安全：整个实现不需要、也不得发送任何写请求。

来源：[Get Account Information](https://www.bitget.com/api-doc/spot/account/Get-Account-Info)。

### 1.3 UTA：`permType` 与 `permissions`

`GET /api/v3/account/info` 返回当前 Key 的：

- `userId`、`parentId`、`regisTime`
- `ips`
- `permType`：`read-only` 或 `read-and-write`
- `permissions`：`uta_mgt`、`uta_trade`、`withdraw`、`copy_futures_position`、`copy_futures_order`

本 Ticket 的 UTA 接受条件：

```text
permType == "read-only"
permissions set == {"uta_mgt", "uta_trade"}
```

原因：

- `uta_mgt` 的 read scope 用于账户资产、Funding 与账户设置。
- `uta_trade` 的 read scope 用于只读查询当前合约持仓和未成交单，证明快照没有被排除产品。
- `withdraw`、copy-futures scopes 与本 Ticket 无关且扩大范围，拒绝。
- 未知 scope 必须 fail closed，避免 Bitget 新增能力后旧解析器误放行。

来源：

- [Get Account Info](https://www.bitget.com/api-doc/uta/account/Get-Account-Info)
- [UTA Quick Start：read-only/read-write scopes](https://www.bitget.com/api-doc/uta/guide)

### 1.4 保存前二次验证

推荐统一 onboarding 事务：

1. API Key、Secret、Passphrase 只进入服务端临时内存。
2. 优先调用 UTA account info；明确判定非 UTA 后才走 Classic account info，不能在任意异常时盲目 fallback。
3. 验证权限、身份和账户范围。
4. 读取 Spot/UTA cash、Funding、Savings 与市场价格，生成脱敏预览。
5. 用户确认后，第二次读取 account info 和范围证明端点。
6. 二次结果必须仍满足安全条件，且 `userId/parentId/permType-or-authorities` 与预览一致。
7. 只在全部成功后原子写入服务端 secret store、非秘密 source record 与首个 snapshot。

任何失败都不保存 credential、opaque secret reference、source 或 snapshot。后续每次余额同步前也应重验权限；权限或账户范围漂移时停止提交新快照，保留上次成功数据并标记 expired。

## 2. Classic 资产范围

### 2.1 Spot Account

`GET /api/v2/spot/account/assets`：

- 频率：10 req/s/UID
- `coin` 可选，查询单币种
- `assetType` 可选：`hold_only`（默认，仅持有币）或 `all`
- 不传 `coin` 且使用 `hold_only` 时返回有持仓的币种
- 无分页
- 字段：`coin`、`available`、`frozen`、`locked`、`limitAvailable`、`uTime`

来源：[Get Account Assets](https://www.bitget.com/api-doc/spot/account/Get-Account-Assets)。

数量处理：

- 所有数字必须作为 decimal string 解析，不能先转 JavaScript `number`。
- 保留四个组件及 `uTime`，不要只展示 `available`。
- 官方文档没有明确给出四个组件是否绝对互斥，也没有返回 `total`。可将 `available + frozen + locked + limitAvailable` 作为实现候选，但必须在专用只读账户的人工集成验收中与 Bitget UI 对账；对账未完成前不能宣称该公式是官方保证。
- `coin` 示例使用小写，而其他端点常用大写；内部身份应保留原始值并按官方 symbol catalog 映射，不能仅靠强制大写合并。

### 2.2 Funding Account

Classic Funding 使用 `GET /api/v2/account/funding-assets`：

- 频率：10 req/s/UID
- `coin` 可选，默认全部
- 无分页
- 字段：`coin`、`available`、`frozen`、`usdtValue`

数量为 `available + frozen`；`usdtValue` 是 Bitget 返回的原生 USDT 估值，可用于来源总额和 ticker 结果对账。空字符串不是零的可靠替代，需按 schema error 处理或仅在官方 fixture 明确覆盖时接受。

来源：[Funding Assets](https://www.bitget.com/api-doc/common/account/Funding-Assets)。

### 2.3 明确排除

Classic 不调用以下业务线：

- `/api/v2/mix/**` Futures
- `/api/v2/margin/**` Margin 和借贷
- Copy trading 资产
- Loan、Pledge Loan
- P2P、法币账户
- SharkFin

Classic 的账户是相互独立的；只调用 Spot、Funding、Savings allowlist 即不会把 Futures/Margin 账户余额混入。

官方说明 Classic Account 的 Spot、Margin、Futures 是独立账户；当前 Classic 已进入维护模式，官方推荐 UTA。来源：[Classic Account introduction](https://www.bitget.com/api-doc/classic/intro)。

## 3. UTA 资产范围与严格排除

### 3.1 为什么不能直接使用 UTA 总资产

Bitget 官方说明 UTA 将 Spot、Margin 和多类 Futures 放入统一账户，并允许不同产品共享保证金、盈亏互抵。Basic mode 已支持 Spot、USDT Futures、USDC Futures；Advanced mode 还支持 Spot Margin 和 Coin-M Futures。

因此 `GET /api/v3/account/assets` 的 `accountEquity`、`usdtEquity`、`btcEquity` 不是本 Ticket 的“纯现货总额”。响应还包含：

- `unrealisedPnl`
- `mmr`、`imr`、`mgnRatio`
- `positionValue`
- `leverage`
- 每币种 `equity`、`usdValue`、`balance`、`debt`、`available`、`locked`

来源：

- [Unified Trading Account introduction](https://www.bitget.com/api-doc/uta/intro)
- [Get Account Assets](https://www.bitget.com/api-doc/uta/account/Get-Account)

### 3.2 UTA cash-only 快照门槛

每次预览和同步都必须：

1. 分别调用 `GET /api/v3/position/current-position`：
   - `category=USDT-FUTURES`
   - `category=USDC-FUTURES`
   - `category=COIN-FUTURES`
2. 要求每类 `list` 为空，或所有 position `total` 严格为 decimal zero。
3. 分别调用 `GET /api/v3/trade/unfilled-orders`：
   - `category=MARGIN`
   - 三类 Futures category
4. 遍历 cursor 到结束，要求所有四类结果为空。
5. 调用 `GET /api/v3/account/assets`，要求：

```text
unrealisedPnl == 0
positionValue == 0
mmr == 0
imr == 0
each asset.debt == 0
```

6. 上述证明成立时，以 `assets[].balance` 作为币种现金数量；不要用 `equity`，因为官方定义 equity 会包含冻结保证金和未实现盈亏。
7. Spot 未成交单不属于杠杆/合约，可保留；相应 `locked` 已包含在 `balance` 中，不能重复相加。

当前持仓端点要求 UTA trade (read)，未成交单端点也要求 UTA trade (read)。来源：

- [Get Position Info](https://www.bitget.com/api-doc/uta/trade/Get-Position)
- [Get Open Orders](https://www.bitget.com/api-doc/uta/trade/Get-Order-Pending)

任何一项非零、缺字段、权限不足或调用失败，都不能把 UTA 返回的统一资产过滤后“猜成现货”；应拒绝本次更新、保留上次成功快照并标记 expired。若首次连接即出现这些情况，则拒绝保存并提示“UTA 当前含合约、保证金、借贷或无法证明纯现金范围”。

### 3.3 UTA Funding

`GET /api/v3/account/funding-assets`：

- 频率：20 req/s/UID
- Permission：UTA mgt. (read)
- `coin` 可选
- 只返回有资产的币种
- 无分页
- 字段：`coin`、`balance`、`available`、`frozen`

以 `balance` 为数量；`available + frozen` 只用于对账，不再叠加。Pre-IPO token 的 `coin` 可能混合大小写，例如 `preSPAX`，必须保留原值并通过 Coin Info/symbol metadata 解析。

来源：[Get Account Funding Assets](https://www.bitget.com/api-doc/uta/account/Get-Account-Funding-Assets)。

## 4. Earn：只纳入 Savings

### 4.1 范围边界

Bitget Earn 文档目录同时包含：

- Savings：flexible 与 fixed
- SharkFin：结构化产品
- Loan：抵押借贷

本 Ticket 只读取 Savings。SharkFin 与 Loan 不调用、不估值，也不把其平台聚合值混入来源总额。

来源：[Earn API introduction](https://www.bitget.com/api-doc/earn/intro)。

### 4.2 Savings 币种总览

`GET /api/v2/earn/account/assets`：

- 频率：10 req/s/UID
- `coin` 可选
- 无分页
- 返回 `coin`、`amount`
- 官方把 `data` 描述为 “Savings assets list”

因此它适合做 Savings 按币种完整总量和详细分页结果的对账，不用于 SharkFin/Loan。

来源：[Earn account](https://www.bitget.com/api-doc/earn/account/Earn-Assets)。

### 4.3 Savings 明细、分页和三个月窗口

`GET /api/v2/earn/savings/assets` 必须分别请求：

```text
periodType=flexible
periodType=fixed
```

接口：

- 频率：10 req/s/UID
- `limit` 默认 20、最大 100
- `idLessThan` 请求上一页 `endId` 之前的数据
- `startTime/endTime` 最大跨度三个月
- 默认只覆盖最近三个月
- 响应 `data.resultList` 与 `data.endId`
- 明细含 `productId`、fixed 的 `orderId`、`productCoin`、`interestCoin`、`periodType`、`holdAmount`、收益、状态和 APY

来源：[Savings Assets](https://www.bitget.com/api-doc/classic/earn/savings/Savings-Assets)。

完整读取算法：

1. 用 account info 的 `regisTime` 作为最早边界，用服务器当前时间作为最晚边界。
2. 将时间切成不重叠、每段不超过三个月的窗口，从新到旧遍历。
3. 每个窗口分别读取 flexible 与 fixed，`limit=100`。
4. 使用 `endId` 继续请求，直到结果为空或 cursor 为空。
5. cursor 重复、倒退异常、页数超安全上限、任一页失败均使整个 Earn 分区失败。
6. fixed 以 `orderId` 去重；flexible 以 `periodType + productId` 去重。若同一 flexible product 跨窗口重复，保留最新一致记录；数量不一致则失败。
7. 以 `productCoin` 和 `holdAmount` 聚合当前持仓，不把 `lastProfit`、`totalProfit` 或 APY 叠加为本金。
8. 聚合结果必须逐币种等于 `/earn/account/assets` 的 `amount`；不一致即标记 Earn 不完整，不能提交。

注意：官方同时写明默认时间窗和最大三个月，但没有明确承诺一笔持有超过三个月的 flexible 资产一定在哪个窗口返回。窗口扫描加总览对账是当前最保守方案；若对账失败，应显式报告 Bitget Earn 范围不可完整证明，而不是把遗漏资产当零。

## 5. Bitget 原生估值

### 5.1 可用来源

| 分区 | 首选原生估值 | 时间 |
| --- | --- | --- |
| UTA cash | `assets[].usdValue`，仅在 cash-only 门槛通过后 | 私有响应 `requestTime` |
| Classic Funding | `usdtValue` | 私有响应 `requestTime` |
| UTA Funding | Spot ticker | ticker `ts` |
| Classic Spot | Spot ticker | ticker `ts` |
| Savings | Spot ticker | ticker `ts` |

UTA `usdValue` 是 Bitget 返回的币种 USD equity 值；在 `debt/unrealisedPnl/risk fields` 全零时，可作为 `balance` 的平台原生 USD 估值。不要使用 UTA 顶层 `accountEquity`，因为它是统一产品聚合值。

### 5.2 Spot symbol 与 ticker

Classic 公共市场端点：

```text
GET /api/v2/spot/public/symbols
GET /api/v2/spot/market/tickers
```

- symbols 支持单个或全量查询，返回 `symbol/baseCoin/quoteCoin/status` 和精度；无分页。
- tickers 支持单个或全量查询，返回 `lastPr` 与毫秒 `ts`；20 req/s/IP，无分页。

来源：

- [Get Symbol Info](https://www.bitget.com/api-doc/spot/market/Get-Symbols)
- [Get Ticker Information](https://www.bitget.com/api-doc/spot/market/Get-Tickers)

UTA 也可使用 `GET /api/v3/market/tickers?category=SPOT`，字段为 `lastPrice` 和 `ts`。来源：[UTA Get Tickers](https://www.bitget.com/api-doc/uta/public/Tickers)。

估值规则：

1. 只使用 symbol catalog 中确实存在且状态可用的 Spot pair。
2. 优先币种到 USDT 的直接 pair；没有时可使用有完整时间戳的一跳 Bitget Spot 交叉价。
3. 保存数量、价格、quote coin、pair、ticker timestamp 和 request timestamp。
4. 同一币种在 Spot/Funding/Savings 可合并展示，但必须保留分区原始明细，避免重复计数和无法对账。
5. 非 USDT 稳定币也必须读取真实 ticker，不固定为 1。
6. Bitget 公共市场没有文档化的通用 `USDT/USD` 现货价格。Classic Spot/Savings 只有 USDT 计价且没有平台 `usdValue` 时，应保留原生 USDT 价值，再由全局明确的 USDT/USD 观察值转换；若没有可靠转换则标记未估值，不能硬编码 1 美元。
7. 缺 pair、`lastPr/lastPrice` 非正数、时间戳非法或价格过期时，保留币种和数量，`marketValue=null`、`valuationStatus=unvalued`，排除数值总额并传播 incomplete 状态。

## 6. 签名、域名与传输边界

### 6.1 REST 域名

官方仅列出：

```text
https://api.bitget.com
```

Classic WebSocket 是 `/v2/ws/*`，UTA WebSocket 是 `/v3/ws/*`；本 Ticket 的五分钟余额轮询和三十秒价格轮询只需要 HTTPS REST。

来源：

- [Classic API Domain](https://www.bitget.com/api-doc/common/domain)
- [UTA Quick Start](https://www.bitget.com/api-doc/uta/guide)

客户端必须：

- 固定 HTTPS host allowlist，不接受用户自定义 base URL。
- 不把签名头转发到重定向主机；建议私有请求禁用自动跨主机 redirect。
- 不用地区镜像、代理或非官方域名绕过地域限制。

### 6.2 私有请求头

```text
ACCESS-KEY
ACCESS-SIGN
ACCESS-TIMESTAMP
ACCESS-PASSPHRASE
Content-Type: application/json
locale: en-US
```

`ACCESS-TIMESTAMP` 为 Unix 毫秒。请求时间必须在 Bitget 服务器时间前后 30 秒内；时钟偏差大时先查询公开服务器时间。

### 6.3 HMAC 签名

prehash：

```text
timestamp + METHOD_UPPER + requestPath + body
```

有 query 时：

```text
timestamp + METHOD_UPPER + requestPath + "?" + queryString + body
```

使用 SecretKey 做 HMAC-SHA256，再 Base64 编码为 `ACCESS-SIGN`。GET body 为空。query 的排序、编码和最终传输字节必须与参与签名的字符串完全一致。

Bitget 也文档化 RSA，但本 Ticket 输入模型是 API Key + Secret + Passphrase，优先只实现 HMAC，避免增加未要求的凭证形态。

来源：[Signature](https://www.bitget.com/api-doc/common/signature)。

### 6.4 Secret 边界

- API Key、Secret、Passphrase 只能进入服务端进程和安全存储。
- 浏览器只提交一次到服务端 onboarding endpoint；后续响应只返回脱敏身份、范围和 opaque source id。
- 不进入 URL、analytics、日志、错误详情、snapshot、普通数据库、Supabase 同步或浏览器持久化。
- 签名失败日志只记录 provider、endpoint id、HTTP status、Bitget code、request correlation id，不记录 headers、prehash、query secret 或 response 原文。

## 7. 成功、错误与失败语义

### 7.1 成功判断

Bitget 标准响应：

```json
{
  "code": "00000",
  "msg": "success",
  "requestTime": 1712046333409,
  "data": {}
}
```

只有 HTTP 2xx、JSON schema 合法且 `code == "00000"` 才算成功。HTTP 200 但业务 code 非 `00000` 仍是失败。

### 7.2 建议错误映射

| Bitget/HTTP | 归类 | 行为 |
| --- | --- | --- |
| `40001/40002/40003/40006/40009/40011/40012` | credential/signature invalid | onboarding 拒绝；已连接来源 expired，不清零 |
| `40008` | timestamp expired | 校时后最多重试一次；仍失败则 expired |
| `40014` Classic | incorrect permission | 拒绝/停止同步 |
| `25620` UTA | permission denied | 拒绝/停止同步 |
| `40018` | invalid IP | 提示 IP allowlist，不自动换域名 |
| `40000/40103/40104` | region restricted | 非重试错误；不绕过 |
| HTTP `429` | rate limited | 指数退避和 jitter；保留旧数据 |
| `40725/45001/40808` | release/service transient | 有界退避重试；失败后 expired |
| `25000/25001` 或 HTTP 5xx | provider/system transient | 有界重试；失败后 expired |
| schema/cursor/reconcile error | provider contract/incomplete | 不提交部分快照，告警并 expired |

Classic 与 UTA 的错误表并不完全相同；例如 `40002/40003` 的描述在文档版本间有差异，因此错误归类应结合 endpoint family 与 message，不能只写一份全局枚举。

来源：

- [Classic REST error codes](https://www.bitget.com/api-doc/broker/error-code/restapi)
- [UTA REST error codes](https://www.bitget.com/api-doc/uta/error-code/restapi)
- [Bitget FAQ：发布窗口与可重试错误](https://www.bitget.com/api-doc/classic/faq)

### 7.3 空账户与部分失败

空数组只能在以下全部成立时解释为“该分区余额为零”：

- 权限与身份验证成功；
- 所有要求的页和时间窗完整成功；
- 响应 schema 合法；
- UTA 风险/持仓/挂单证明成功；
- Savings 明细与总览对账成功。

任一分区失败时，不用成功分区和失败分区拼出新 Bitget 总额。保持 Bitget 来源的最后成功原子快照，标记 expired，记录受影响分区和最后成功时间。也不得把 missing、timeout、permission denied 或 region restricted 转为零余额。

## 8. 精确 method/path allowlist

公共读取：

```text
GET /api/v2/public/time
GET /api/v2/spot/public/symbols
GET /api/v2/spot/market/tickers
GET /api/v3/market/tickers?category=SPOT
```

Classic 私有读取：

```text
GET /api/v2/spot/account/info
GET /api/v2/spot/account/assets?assetType=hold_only
GET /api/v2/account/funding-assets
GET /api/v2/earn/account/assets
GET /api/v2/earn/savings/assets
```

UTA 私有读取：

```text
GET /api/v3/account/info
GET /api/v3/account/settings
GET /api/v3/account/assets
GET /api/v3/account/funding-assets
GET /api/v3/position/current-position
GET /api/v3/trade/unfilled-orders
GET /api/v2/earn/account/assets
GET /api/v2/earn/savings/assets
```

`/api/v2/earn/*` 官方当前仍是 Savings 读取端点；UTA 文档没有提供等价的 v3 Savings 持仓 API。预览必须实测该只读 Key 是否能访问这些 v2 端点；失败就显示 Earn 不受支持并拒绝保存，不能静默省略。

必须拒绝：

- 所有 POST、PUT、PATCH、DELETE
- Spot/Futures/Margin 下单、撤单、改单
- transfer、withdraw、deposit address 创建
- borrow、repay、loan、pledge
- Savings subscribe/redeem
- SharkFin、On-Chain Elite、staking/lending
- Copy trading
- allowlist 外 path、未知 query、非官方 host、跨主机 redirect

## 9. 可测试验收边界

### 9.1 自动测试最高边界

继续使用项目既定最高层浏览器边界：运行真实 Web App，后端对接 deterministic fake Bitget HTTP server、fake secret store、fake clock、测试数据库和受控网络；浏览器只操作用户可见 onboarding、卡片、详情、刷新和错误状态。

自动测试不得调用 `api.bitget.com` 或任何真实账户。官方文档响应样本转换为 fixtures，并额外构造边界 fixture。

### 9.2 必测 onboarding 场景

1. Classic 只读 authorities + 三分区成功：显示 UID、Classic、Spot/Funding/Savings 范围和脱敏预览，确认后原子保存。
2. Classic 任一写 authority：确认按钮不可用，secret store/source/snapshot 均无记录。
3. UTA `permType=read-only` 且 scopes 精确、无持仓/杠杆：成功。
4. UTA `read-and-write`：拒绝，即使所有资产端点只执行 GET。
5. UTA 缺 `uta_trade`：无法证明合约范围，拒绝。
6. UTA 含 withdraw/copy/unknown scope：拒绝。
7. 第一次预览成功、确认前权限或 `userId` 改变：拒绝且不落库。
8. Secret、Passphrase 在 HTML、serialized state、API response、network response body、console/server logs 中均不可见。

### 9.3 必测资产与范围 fixture

- Classic Spot 四类余额组件、极高精度和极小小数。
- Classic Funding `usdtValue`、空字符串异常、零余额。
- UTA `balance/equity/usdValue/debt` 差异；只计 `balance`，不重复计 equity。
- 三类 Futures position 任一非零即拒绝快照。
- Margin/Futures open order 出现在第二页也能拒绝。
- `unrealisedPnl/mmr/imr/positionValue/debt` 任一非零即拒绝。
- UTA Funding 混合大小写 Pre-IPO coin 不被误并。
- Savings flexible/fixed 分页、多窗口、重复 cursor、重复记录、三个月以前仍持有的产品。
- Savings 明细总和与 account overview 相等成功；不等则整个 Earn 失败。
- SharkFin/Loan fixture 即使存在也不进入持仓或来源总额。

### 9.4 必测估值 fixture

- BTC 在 Bitget Spot ticker 有真实价格和 `ts`。
- 同一资产在 Bitget 与其他来源价格不同，保留 Bitget 原生价格。
- USDC/FDUSD 等稳定币使用实际 ticker，不固定为 1。
- USDT 没有可靠 USD 转换时标记未估值，不能硬编码 1。
- ticker 缺失、零、负数、非法 decimal、过期时保留数量，排除数值总额并显示 incomplete。
- UTA `usdValue` 只在 cash-only 门槛通过时使用。

### 9.5 必测失败语义

- `40008` 校时后单次重试。
- `40014/25620` 权限错误。
- `40018` IP allowlist。
- region restriction 不换域名重试。
- `429`、发布窗口错误、5xx 有界退避。
- 任一分页页失败，不提交部分 Savings。
- 一次成功后下一次失败：卡片仍显示旧总额、last successful time 和 expired；总览传播 expired，不变为零。
- 手动刷新恢复后才替换原子快照并清除 expired。

### 9.6 人工真实集成验收

不属于自动测试。若未来执行，必须使用专门创建、绑定服务器出口 IP 的只读 Key，并在调用前从 account info 证明权限。人工核对：

- Classic Spot 四个余额组件的求和是否与 Bitget UI 当前总余额一致；
- Spot/Funding/Savings 数量与 UI；
- Savings 超过三个月持有记录是否完整；
- Bitget 原生估值和时间；
- UTA cash-only 账户的 `balance` 与 UI 现货现金范围；
- 浏览器和日志无 secret。

若只读权限不能机器证明、UTA 含被排除产品、Savings 对账失败或 Classic Spot 数量公式未通过 UI 对账，立即停止，不连接该凭证。

## 10. 实现前需要锁定的限制

1. **Classic Spot 没有官方 total 字段。** 四组件求和是合理但非文档明示公式，真实集成验收前保留为风险。
2. **UTA 不是天然 Spot-only。** 必须持续证明无 Futures/Margin/Loan 风险；不能只在 onboarding 检查一次。
3. **UTA Savings 仍依赖 v2 文档端点。** 官方未给出 v3 等价读取；不支持时要拒绝，而不是少算。
4. **Savings 三个月窗口可能遗漏长期持有语义。** 必须做窗口扫描和 overview 对账。
5. **Earn 不是一个无边界大类。** 本 Ticket 仅 Savings flexible/fixed；SharkFin、Loan、On-Chain Elite、staking/lending 均排除。
6. **Bitget 不提供文档化通用 USDT/USD Spot 价。** 不能把 USDT 自动固定为 1 USD。
7. **只有一个官方 REST 主域。** 地区错误不能通过非官方域名规避。
8. **文档会更新。** 尤其 UTA 在 2026 年持续新增 endpoint 和 scope；实现与真实验收前必须重查 account info、error code 和 Earn changelog。

## 官方资料索引

- [Bitget API Introduction](https://www.bitget.com/api-doc/common/intro)
- [Classic Quick Start / domain / permissions / signature](https://www.bitget.com/api-doc/classic/quickStart/intro)
- [Classic Account Info](https://www.bitget.com/api-doc/spot/account/Get-Account-Info)
- [Classic Spot Assets](https://www.bitget.com/api-doc/spot/account/Get-Account-Assets)
- [Classic Funding Assets](https://www.bitget.com/api-doc/common/account/Funding-Assets)
- [UTA Account Info](https://www.bitget.com/api-doc/uta/account/Get-Account-Info)
- [UTA Account Settings](https://www.bitget.com/api-doc/uta/account/Get-Account-Setting)
- [UTA Account Assets](https://www.bitget.com/api-doc/uta/account/Get-Account)
- [UTA Funding Assets](https://www.bitget.com/api-doc/uta/account/Get-Account-Funding-Assets)
- [UTA Current Positions](https://www.bitget.com/api-doc/uta/trade/Get-Position)
- [UTA Open Orders](https://www.bitget.com/api-doc/uta/trade/Get-Order-Pending)
- [Earn account overview](https://www.bitget.com/api-doc/earn/account/Earn-Assets)
- [Savings Assets](https://www.bitget.com/api-doc/classic/earn/savings/Savings-Assets)
- [Spot Symbols](https://www.bitget.com/api-doc/spot/market/Get-Symbols)
- [Spot Tickers](https://www.bitget.com/api-doc/spot/market/Get-Tickers)
- [Signature](https://www.bitget.com/api-doc/common/signature)
- [Classic REST Error Codes](https://www.bitget.com/api-doc/broker/error-code/restapi)
- [UTA REST Error Codes](https://www.bitget.com/api-doc/uta/error-code/restapi)
- [UTA Changelog](https://www.bitget.com/api-doc/uta/changelog)
