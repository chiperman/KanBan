# OKX 只读资产来源 API 调研

调研日期：2026-07-26
范围：仅使用 OKX 官方 API 文档、官方 changelog、官方帮助文档及 OKX 官方源码资料。未调用真实账户或私有 API；未修改产品代码。

## 结论

Ticket 11 可以实现，但必须同时验证 **API Key 权限** 与 **Trading Account 产品范围**：

- `GET /api/v5/account/config` 返回当前请求 Key 的 `perm`。只接受集合严格等于 `{read_only}`；包含 `trade` 或 `withdraw` 必须拒绝。OKX 官方明确说明 `Trade` 包含下单、撤单、资金划转和写设置，因此 `perm=read_only` 也证明该 Key 不具备官方建模的 transfer 权限。
- 同一 config 还返回账户模式和借贷开关。为排除保证金、合约和借贷，只接受 `acctLv=1`（Spot mode）、`enableSpotBorrow=false`、`spotBorrowAutoRepay=false`、`autoLoan=false`。
- Spot mode 仍允许期权买方持仓。连接预览和每次同步前应调用 `GET /api/v5/account/positions?instType=OPTION`，要求无非零持仓；否则本 Ticket 无法宣称来源只含现货资产。
- 保存前必须第二次调用 config 和 Option positions，重新核对 `uid/mainUid/type/perm/acctLv/borrow flags` 与预览时一致，然后才原子保存凭证和来源。任何漂移都拒绝，不落库。
- Funding 使用 `GET /api/v5/asset/balances`；Trading 使用 `GET /api/v5/account/balance`；当前可用的 Simple Earn 明细是 Flexible 的 `GET /api/v5/finance/savings/balance`。
- OKX 官方 changelog 显示 Simple Earn Fixed API 已在 2025-03 下线。当前不能假装存在定期持仓 API；范围预览必须明确写“Simple Earn Flexible only”。
- 原生逐持仓估值使用 `ASSET-USDT` Spot ticker；USDT 自身是 `1 USDT`，其他稳定币必须取实际价格。无直接有效交易对就保持未估值，不能按零。
- OKX 另有 `GET /api/v5/asset/asset-valuation?ccy=USD` 的平台聚合估值，但它聚合多个账户产品，不能在没有明确逐分区对账时替代本 Ticket 的 Spot/Funding/Flexible 明细总和。

## 1. API Key 只读权限证明

### 1.1 OKX 官方权限模型

OKX API Key 有三类权限：

| UI 权限 | `account/config.perm` | 官方能力 |
| --- | --- | --- |
| Read | `read_only` | 读取账户资料、账单、订单历史等 |
| Trade | `trade` | 下单、撤单、funding transfer、修改写设置 |
| Withdraw | `withdraw` | 提现 |

来源：[OKX API guide：API key permissions](https://www.okx.com/docs-v5/en/#overview-api-key-creation)。

因此 transfer 不需要另猜权限位：官方把 funding transfer 归入 `Trade`。Ticket 的接受条件是：

```text
parse perm by comma, trim, reject empty/duplicates/unknown
accept only if set == {"read_only"}
reject if set contains "trade" or "withdraw"
```

### 1.2 当前 Key 的机器验证

`GET /api/v5/account/config` 是 `Read` 权限端点，响应的 `perm` 明确表示“当前请求 API Key 或 Access token 的权限”，可能值为 `read_only`、`trade`、`withdraw`。

同时保存并核对以下非秘密身份/范围字段：

- `uid`、`mainUid`
- `type`（主账户、标准子账户、托管子账户等）
- `label`
- `perm`
- `acctLv`
- `enableSpotBorrow`
- `spotBorrowAutoRepay`
- `autoLoan`
- `ip`

来源：[OKX API guide：Get account configuration](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration)。

`ip` 为空不代表写权限，但 OKX 官方强烈建议绑定 IP。未绑定 IP 且含 Trade/Withdraw 的 Key 会在 14 天不活动后过期；Read-only Key 不受这一条写权限过期规则约束。生产连接应提示用户绑定服务器出口 IP，但 Ticket 的硬性权限判断仍以 `perm` 为准。

### 1.3 确认前二次重验

推荐连接事务：

1. API Key、Secret、Passphrase 只存在服务端临时内存。
2. 第一次 `GET /account/config`：验证权限、身份、账户模式、借贷开关。
3. `GET /account/positions?instType=OPTION`：要求无非零期权持仓。
4. 读取 Trading、Funding、Flexible 与市场价格，生成脱敏范围预览。
5. 用户点击确认后，**再次**执行第 2、3 步。
6. 第二次结果必须仍安全，且 `uid/mainUid/type` 与第一次一致；否则提示“权限或账户范围已变化”，不保存。
7. 只有第二次验证通过后，原子写入服务端 secret、source record 和首个 snapshot。

后续每次私有余额同步前至少重验 config；发现 `perm`、`acctLv` 或 borrow flags 漂移时，不再读取/提交新快照，保留旧数据并标记 expired。

### 1.4 无法完全自证的部分

- OKX 未来新增且未进入本地解析器的 `perm` 值。
- API 响应缺失/类型异常时是否代表关闭；官方没有保证。
- 用户在 Read-only Key 之外通过网页、App 或其他 Key 新开不在范围内的产品。

处理方式均为 fail-closed：未知权限、缺字段、模式漂移、Option 持仓出现时停止当前来源同步，不做写接口探针，也不把资产写成零。

## 2. 账户模式与杠杆产品排除

OKX Trading Account 支持四种模式：

| `acctLv` | 模式 | Ticket 处理 |
| --- | --- | --- |
| `1` | Spot mode | 仅在借贷关闭且无 Option 持仓时接受 |
| `2` | Futures mode | 拒绝 |
| `3` | Multi-currency margin | 拒绝 |
| `4` | Portfolio margin | 拒绝 |

来源：[OKX API guide：Account mode](https://www.okx.com/docs-v5/en/#overview-account-mode)。

只检查 `acctLv=1` 仍不够：

- 官方 config 有 `enableSpotBorrow` 和 `spotBorrowAutoRepay`；Spot mode 可以开启借贷。
- 官方帮助文档说明 Spot mode 仍允许期权买方持仓。
- `GET /api/v5/account/balance` 的 `details[].liab`、`borrowFroz`、`interest` 等字段在 Spot borrow 情况下可能非零。

因此连接与同步验证应要求：

```text
acctLv == "1"
enableSpotBorrow == false
spotBorrowAutoRepay == false
autoLoan == false
OPTION positions are empty
each balance detail has liab/crossLiab/borrowFroz/interest empty or numeric zero
```

任何负债字段非零都视为 scope violation，不能用 `cashBal - liab` 自行包装成现货净资产，因为 Ticket 明确排除借贷。

来源：

- [Get account configuration](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration)
- [Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)
- [OKX 官方帮助：Spot mode 仍支持 Option long](https://www.okx.com/en-gb/help/ii-introduction-to-simple-mode)

## 3. 私有资产端点

### 3.1 Trading Account 现货现金

`GET /api/v5/account/balance`：

- Permission：Read
- 无分页
- 可选 `ccy`，最多 20 个币种；不传时返回全部非零资产
- 顶层 `totalEq` 是 Trading Account 的 USD 总资产
- `details[]` 包含 `ccy`、`eq`、`cashBal`、`availBal`、`frozenBal`、`eqUsd`、`uTime` 以及借贷/衍生品字段

在本 Ticket 已验证 Spot cash-only 的前提下，以 `details[].cashBal` 作为币种数量，保留 `availBal`、`frozenBal` 作为可用/占用说明。不要把 `totalEq` 再叠加到逐币种值上。

`eqUsd` 和 `totalEq` 可作为 OKX 平台原生 USD 对账证据，但持仓卡片仍应保存具体价格来源；若 `cashBal × direct ticker` 与 `eqUsd` 有差异，允许平台口径差异并明确选择一种总额口径，不能混加。

来源：[OKX API guide：Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)。

### 3.2 Funding Account

`GET /api/v5/asset/balances`：

- Permission：Read
- 返回余额大于 0 的 Funding 资产
- 可选 `ccy`，最多 20 个币种
- 无分页
- 响应字段：`ccy`、`bal`、`availBal`、`frozenBal`

以 `bal` 作为 Funding 总数量，`availBal`/`frozenBal` 只作分解，不再重复相加。所有金额都是字符串。

来源：[OKX API guide：Funding Account Get balance](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-balance)。

### 3.3 Simple Earn Flexible

当前官方读取端点：`GET /api/v5/finance/savings/balance`。

- Permission：Read
- 可选 `ccy`
- 当前接口无 cursor/limit 分页
- 返回币种和 Flexible Savings 余额字段，包括 `ccy`、`amt`、`earnings`、`rate`、`loanAmt`、`pendingAmt`、`redemptAmt`

以 `amt` 作为 Flexible 持仓数量；不要把 `earnings`、`loanAmt`、`pendingAmt` 或 `redemptAmt` 再加到 `amt` 上。其余字段保留为来源状态/收益说明。若 `amt` 缺失或非法，不提交该分区。

来源：

- [OKX API guide：Get saving balance](https://www.okx.com/docs-v5/en/#financial-product-savings-get-saving-balance)
- [OKX changelog：Savings balance 迁移到 `/api/v5/finance/savings/balance`](https://www.okx.com/docs-v5/log_en/#2023-12-28)

### 3.4 Simple Earn Fixed 当前不可接

OKX 官方 changelog 的 “Fixed Loan and Simple Earn Fixed going offline” 显示：

- 2024-11 起限制新订阅；
- 2025-03 Simple Earn Fixed 的 lending offers、APY history、order list、sub-order list 等 API offline；
- 该调整不影响 Simple Earn Flexible。

因此截至 2026-07-26，不能依赖旧 `/api/v5/finance/fixed-loan/*` 接口读取定期 Earn。Ticket 11 的可验证范围应显示为 **Simple Earn Flexible only**。若用户有只能在 App 中看到的 Fixed 产品，本来源会不完整；不能伪造接口或把它算成 0。

来源：[OKX changelog：Fixed Loan and Simple Earn Fixed going offline](https://www.okx.com/docs-v5/log_en/#2025-03-03)。

### 3.5 不使用聚合估值代替持仓明细

`GET /api/v5/asset/asset-valuation?ccy=USD` 是官方 Read endpoint，可返回账户聚合估值，支持 BTC、USDT、USD、CNY 等单位。

它可用于诊断/对账，但可能覆盖 Trading、Funding、Earn 之外的账户产品。除非响应分区能与本 Ticket 三个明细范围逐项严格对应，否则不能直接把 `totalBal` 当来源总额，避免把被排除产品重新带入。

来源：[OKX API guide：Get account asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation)。

## 4. 精确 method/path allowlist

生产 allowlist：

```text
GET /api/v5/public/time
GET /api/v5/public/instruments?instType=SPOT
GET /api/v5/market/tickers?instType=SPOT
GET /api/v5/account/config
GET /api/v5/account/balance
GET /api/v5/account/positions?instType=OPTION
GET /api/v5/asset/balances
GET /api/v5/finance/savings/balance
```

可选只读诊断，不参与来源总额：

```text
GET /api/v5/asset/asset-valuation?ccy=USD
```

必须拒绝：

- 所有 POST、PUT、PATCH、DELETE
- `/api/v5/trade/*`
- `/api/v5/asset/transfer`、withdrawal、convert
- `/api/v5/account/set-*`、borrow、repay、leverage
- `/api/v5/finance/savings/purchase-redempt`、set-lending-rate
- `/api/v5/finance/fixed-loan/*`
- 任何 SWAP、FUTURES、MARGIN、OPTION 资产读取；唯一 Option 调用只是空持仓范围验证
- allowlist 外 path、未知 query 参数、跨主机重定向

## 5. 区域主机边界

OKX 官方文档说明 API 域名与注册区域有关：

- Global：`https://openapi.okx.com`
- US/AU：`https://us.okx.com`
- EEA：`https://eea.okx.com`

不能让用户直接输入任意 base URL。UI 应选择注册区域枚举，服务端映射到受信任官方 host；签名和发送都使用同一个 host/path。禁止自动跟随到非 allowlist host 的重定向。

来源：[OKX API guide：Regional API Domain Requirement / Production Trading Services](https://www.okx.com/docs-v5/en/#overview-production-trading-services)。

## 6. OKX 原生行情与估值

### 6.1 交易对发现

`GET /api/v5/public/instruments?instType=SPOT` 返回 `instId`、`baseCcy`、`quoteCcy`、`state`、`tickSz`、`lotSz` 等。

只接受：

```text
instType == SPOT
state == live
baseCcy == holding.ccy
quoteCcy == USDT
```

来源：[OKX API guide：Public Data Get instruments](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments)。

### 6.2 行情

`GET /api/v5/market/tickers?instType=SPOT` 返回所有 Spot ticker，包括 `instId`、`last` 和 `ts`。OKX 明确说明不同市场数据服务有独立缓存，因此后一次请求可能返回比前一次更早的数据；应用必须按每条 ticker 的 `ts` 判断新旧，不能用响应到达顺序覆盖更新的价格。

来源：[OKX API guide：Market Data Get tickers](https://www.okx.com/docs-v5/en/#market-data-rest-api-get-tickers)。

估值规则：

```text
ccy == USDT:
  unitPrice = 1 USDT
else if live direct pair CCY-USDT has valid ticker:
  valueUSDT = quantity * last
else:
  unvalued
```

- USDC、USDG、DAI 等稳定币必须取实际 `CCY-USDT`；不能硬编码为 1。
- 不使用 tick size/lot size 截断资产数量，它们是交易规则。
- 不做未约定的 BTC/ETH/OKB 多跳合成。
- pair 缺失、非 live、ticker 缺失、`last` 非法或 `ts` 过期时，保留数量并标记未估值。
- 未估值持仓排除于数值总额，并使来源/全局总额 incomplete；不能按零。

### 6.3 USD 显示

OKX Trading balance 的 `totalEq/eqUsd` 与 asset-valuation 支持平台原生 USD，但 Funding/Flexible 逐币种明细仍需行情对账。推荐保存两层证据：

- 逐持仓：`CCY-USDT`、`last`、ticker `ts`
- 平台对账：适用时保存 Trading `eqUsd/totalEq`，以及可选 asset-valuation 观察值

若统一总账要求 USD，不应未经说明把 USDT 改名为 USD。可以优先使用 OKX 明确返回的 USD valuation；对只能得到 USDT 的分区，需要显式、可追溯的 USDT/USD 换算或保持 USDT 原币值。

## 7. HMAC 签名与凭证

所有 private REST 请求包含：

```text
OK-ACCESS-KEY
OK-ACCESS-SIGN
OK-ACCESS-TIMESTAMP
OK-ACCESS-PASSPHRASE
```

签名：

```text
prehash = timestamp + UPPERCASE_METHOD + requestPathIncludingQuery + exactBody
signature = Base64(HMAC-SHA256(secretKey, prehash))
```

- `OK-ACCESS-TIMESTAMP` 使用 ISO 8601 UTC 毫秒格式，例如 `2020-12-08T09:08:57.715Z`。
- GET query 属于 requestPath，不属于 body。
- GET 无 body 时拼接空字符串。
- 服务端拒绝与服务器时间差超过 30 秒的请求，错误 `50102`；用 `GET /api/v5/public/time` 维护时钟偏移。
- Key、Secret、Passphrase 和签名只存在服务端；不得进入 HTML、RSC、浏览器响应、日志、普通 source record 或 snapshot。

来源：[OKX API guide：REST Authentication / Signature](https://www.okx.com/docs-v5/en/#overview-rest-authentication)。

## 8. 精度、分页与响应完整性

OKX REST 通用 envelope：

```json
{ "code": "0", "msg": "", "data": [] }
```

金额、价格、时间戳和许多枚举都以字符串返回。实现必须：

- 先要求 HTTP 成功，再要求 `code === "0"`。
- 用 decimal/bignumber 处理 `cashBal`、`bal`、`amt`、`last`、`eqUsd`；禁止 JavaScript 浮点聚合。
- 保留原始字符串和规范化值，展示时才舍入。
- 拒绝 malformed、负数量、NaN/Infinity 和关键字段缺失。
- `uTime/ts` 用整数毫秒字符串解析，不能转浮点后丢精度。

本 Ticket 采用的 balance/savings/tickers 端点本身无 cursor 分页；`ccy` 最多 20 只是过滤器限制，不是分页。应不传 `ccy` 获取全部非零余额，避免错误地把 20 币种当作总数上限。

若未来加入带 `after/before/limit` 的 OKX endpoint，必须按官方 cursor 语义单独实现，不能复用页码分页。当前 Ticket 不需要账单或历史订单分页。

## 9. 错误映射

| 信号 | 含义 | 处理 |
| --- | --- | --- |
| `code="0"` | 业务成功 | 继续 schema 验证 |
| `50011` | Rate limit reached | 退避，来源过期，不重试风暴 |
| `50013` | 系统忙 | 有限退避重试，保留旧快照 |
| `50102` | timestamp 过期/偏差超过 30 秒 | 同步 public time 后最多重试一次 |
| `50110` | 当前 IP 不在白名单 | 凭证配置错误，停止同步 |
| `50111` | Invalid OK-ACCESS-KEY | 拒绝连接/来源过期 |
| `50112` | Invalid OK-ACCESS-TIMESTAMP | 修正格式，不循环重试 |
| `50113` | Invalid signature | Secret/签名错误，拒绝 |
| `50114` | Invalid authorization | Key/Passphrase/权限错误，拒绝 |
| `51000` | Parameter error | 实现/schema 错误，不提交 |
| `51001` | Instrument ID 不存在 | 对该持仓标记未估值，不写零 |
| HTTP 429/5xx/timeout | 限流或服务异常 | 有限幂等重试，失败保留旧数据 |

来源：[OKX API guide：Error Code 与 Rate Limits](https://www.okx.com/docs-v5/en/#error-code)。

任何分区失败、Option scope violation、借贷字段非零、价格缺失或 schema 不完整，都不得生成零资产快照。建议整个 OKX source snapshot 原子提交；若实现分区隔离，UI 必须明确显示具体过期分区。

## 10. 自动测试矩阵

全部使用官方响应结构 fixture 和 fake transport，不调用真实账户：

1. `perm=read_only` 通过；`read_only,trade`、`read_only,withdraw`、三权限、空/未知权限全部拒绝。
2. 确认前第二次 config 权限漂移时不保存 secret/source。
3. `uid/mainUid/type` 在两次验证间变化时拒绝。
4. `acctLv=2/3/4` 拒绝；`acctLv=1` 但 Spot Borrow/auto repay/auto loan 开启时拒绝。
5. Option positions 非空时拒绝或同步过期；空数组通过。
6. Trading detail 出现非零 `liab/crossLiab/borrowFroz/interest` 时 scope violation，不做净额伪装。
7. Trading 使用 `cashBal`，Funding 使用 `bal`，Flexible 使用 `amt`；分区同币种保留并只加一次。
8. Funding `availBal + frozenBal` 与 `bal` 一致/不一致 fixture，断言只使用 `bal`，不重复计数。
9. Flexible 的 earnings/pending/redemption 不叠加 `amt`。
10. Fixed API 不在请求日志中；范围预览明确 Flexible only。
11. 极小数、大数、多小数位和尾零使用 decimal 精确聚合。
12. USDT 自身为 1 USDT；BTC 用 `BTC-USDT`。
13. 稳定币 fixture 如 `USDC-USDT=0.9987`，断言不硬编码 1。
14. 无 direct live pair、ticker 缺失/非法/过期时持仓未估值且总额 incomplete，不是零。
15. ticker 后响应的 `ts` 更旧时不覆盖较新价格。
16. HMAC fixture 断言 query 被包含在 requestPath、header timestamp 与签名 timestamp 完全一致。
17. 50102 只同步时钟重试一次；50011 退避；50110/50111/50113/50114 拒绝；5xx 不覆盖旧快照。
18. fake transport 只出现第 4 节 allowlist，没有任何 POST、trade、transfer、withdraw、borrow、fixed-loan 或 savings mutation。
19. HTML、RSC、浏览器网络、日志和 snapshot 不出现 API Key、Secret、Passphrase、signature。
20. 区域枚举只映射到官方 host，用户输入不能控制 base URL，跨主机 redirect 被拒绝。

## 11. 实现决策摘要

- 只接受 `perm` 严格为 `read_only`；Trade 已包含资金划转能力。
- 确认前二次重验权限、身份、账户模式、借贷开关和 Option 空持仓。
- 只接受 Spot mode 且关闭 borrowing；Spot mode 本身仍可能有 Option long，必须额外验证。
- 资产范围是 Trading cash、Funding、Simple Earn Flexible；Simple Earn Fixed API 已下线。
- 精确 GET allowlist；没有任何写请求。
- 原生逐持仓价格使用 live `CCY-USDT` ticker 和其 `ts`；稳定币也用真实价格。
- 缺失价格保留数量并标记未估值，不按零。
- OKX 有原生 USD 聚合估值，但不能无范围对账地把全账户聚合值混入本 Ticket。
- 所有金额字符串采用 decimal 精度，所有成功都要求 HTTP 成功 + `code="0"` + schema 完整。
- 任何权限、模式、借贷、Option、价格或响应异常都保留旧快照并标记 expired/incomplete。

## 官方来源索引

- [OKX API guide](https://www.okx.com/docs-v5/en/)
- [API Key permissions / REST authentication](https://www.okx.com/docs-v5/en/#overview-api-key-creation)
- [Get account configuration](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration)
- [Trading Account Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)
- [Get positions](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-positions)
- [Funding Account Get balance](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-balance)
- [Savings Get saving balance](https://www.okx.com/docs-v5/en/#financial-product-savings-get-saving-balance)
- [Public instruments](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments)
- [Market tickers](https://www.okx.com/docs-v5/en/#market-data-rest-api-get-tickers)
- [Account asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation)
- [OKX API changelog](https://www.okx.com/docs-v5/log_en/)
- [OKX 官方帮助：Spot mode](https://www.okx.com/en-gb/help/ii-introduction-to-simple-mode)
