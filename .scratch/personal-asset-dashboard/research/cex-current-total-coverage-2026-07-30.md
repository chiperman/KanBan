# CEX 当前资产总额与 Earn 覆盖核对

核对日期：2026-07-30。
范围：仅查阅交易所官方第一方 API 文档；未请求任何私有接口，未读取凭证，未修改业务代码、测试或既有研究。

## 结论

1. **OKX 有全账户估值端点**：`GET /api/v5/asset/asset-valuation?ccy=USD` 返回 `totalBal` 和 `details.{trading,funding,earn,classic}`。它是当前账户的聚合估值，适合做总额/覆盖对账，**不得**再与这些分区的明细相加。
2. **OKX On-chain Earn 有活动订单端点**：`GET /api/v5/finance/staking-defi/orders-active`。它是逐订单明细，不是账户总额；在官方没有公布它与 `asset-valuation.details.earn` 的完整包含矩阵前，不能把两者相加，也不能以总额差额自动补明细。
3. **Bitget SharkFin 明细端点不能给出当前本金**。`GET /api/v2/earn/sharkfin/assets` 只有产品/期限/利息/状态；若要当前 SharkFin 聚合估值，只能使用 `GET /api/v2/earn/sharkfin/account` 的 `usdtSubscribeAmount`（或 BTC 计价的同名字段），并且不与 SharkFin 明细、Classic `earn` 总览重复相加。
4. **Bitget On-chain Elite 可作为当前逐产品持仓**：`GET /api/v2/earn/elite/assets` 返回 `holdingAmount` 与 `usdtHoldingAmount`。它与 Classic 全账户概览中的 `earn` 是否重叠，官方未说明；概览仅可对账，不能相加。
5. **Binance 现有守恒端点未变化**：官方当前目录仍列出 signed `GET /sapi/v1/asset/wallet/balance`，返回每个钱包的 `walletName`、`balance`、`activate`。它继续应仅作为钱包级守恒/覆盖哨兵，不能与该钱包的逐持仓或产品账户汇总并加。

## 1. OKX

### 1.1 当前平台/账户聚合估值

| 项目 | 官方合同 |
| --- | --- |
| 方法与路径 | `GET /api/v5/asset/asset-valuation`；显式传 `ccy=USD` 才是 USD 口径，缺省为 BTC。 |
| 只读与权限 | `GET` 私有签名读取；OKX 将 `Read` 定义为读取账户信息，`Trade` 才包含下单、划转和需写权限的设置。因此只读 allowlist 仅可放入此精确 GET 路径，并要求 API Key 仅有 `Read`。 |
| 限速/分页 | 用户 ID 维度 1 次/秒；返回单个当前估值对象，无 `after`、`before`、`limit` 或分页游标。 |
| 关键字段 | `totalBal`（总账户资产估值）、`ts`（毫秒时间）、`details.trading`、`details.funding`、`details.earn`、`details.classic`（已废弃）。 |
| 计数规则 | `totalBal` 已是总额，任一 `details.*` 也是该总额的账户分区；均只可作对账锚点，不能与 Trading/Funding/Earn 明细或彼此再次求和。 |
| 失败语义 | OKX REST 使用 `{code,msg,data}` envelope；只有 `code == "0"` 且结构完整才可视为成功。网络、HTTP、非零业务码、缺失 `totalBal/ts` 或意外分区均不得把旧快照覆盖为零。 |

官方来源：[Account asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation)，[API key permissions / REST authentication](https://www.okx.com/docs-v5/en/#overview-api-key-creation)。

### 1.2 On-chain Earn active orders

| 项目 | 官方合同 |
| --- | --- |
| 方法与路径 | `GET /api/v5/finance/staking-defi/orders-active`。OKX 当前 V5 Financial Product 目录仍将其列为 On-chain earn 的 “Active orders”。 |
| 只读与权限 | `GET` 私有签名读取；按 OKX 的权限模型，连接仅使用 `Read` Key。`purchase`、`redeem`、`cancel` 是同一产品组的 POST 写接口，绝不可加入同步 allowlist。 |
| 查询与分页 | 官方当前入口确认其为 active-order 查询；其公开文档页未给出可安全复述的分页承诺。实现前须在目标区域的同一官方文档页再确认 `productId`/`protocolType`/`ccy`/`state` 过滤及是否存在 cursor；在未确认前，不得假设“单页就是完整集合”。 |
| 可安全使用字段 | 按订单唯一标识保存订单及产品归属，并仅以官方返回的订单本金数量字段作为该订单的候选持仓量；订单状态、收益、预计赎回时间均是状态/归因字段，不能再加回本金。具体字段名和状态枚举须以实施当日的区域文档 schema 为准。 |
| 重复计数 | active orders 是明细，而 `asset-valuation.details.earn` 是聚合估值。OKX 未公开声明后者对 On-chain Earn 的完整包含关系，故只能并排对账；不能 `active orders + details.earn`，也不能用 `totalBal` 补差。 |
| 失败语义 | 与 OKX 统一 envelope 相同：非 `code == "0"`、HTTP/网络失败、订单 ID 或数量字段缺失、或未来分页未完整均使此分区同步失败并保留旧快照。 |

官方来源：[OKX V5 API guide（Financial Product / On-chain earn）](https://www.okx.com/docs-v5/en/)，[OKX 官方 Python SDK 的端点常量](https://github.com/okxapi/python-okx/blob/master/okx/consts.py)。

**仍不确定**：本次官方网页可确认路径和产品目录，但总览端点的 `earn` 是否包含 On-chain Earn，以及 active-orders 的当日详细 schema/分页合同，在该区域可访问的官方入口中没有给出足以安全建模的包含矩阵；不能依据旧 SDK、第三方库或历史回包补全。

## 2. Bitget

Bitget Classic 私有请求均需签名。其权限模型将 Read-Only 定义为查询数据，`Trade`、`Transfer`、`Withdraw` 分别对应下单、划转、提现；本研究涉及的读取只能使用 Read-Only Key。成功必须同时满足 HTTP 成功和 `code == "00000"`；`429` 是频控，`400/401/403/5xx` 与非 `00000` 均不是可写入零余额的成功。

官方来源：[Classic REST quick start](https://www.bitget.com/api-doc/classic/quickStart/intro)。

### 2.1 SharkFin

| 目的 | 精确端点与合同 | 总额/去重规则 |
| --- | --- | --- |
| 当前 SharkFin 聚合估值 | `GET /api/v2/earn/sharkfin/account`，10 次/秒/UID、无参数、私有签名。`usdtSubscribeAmount` 是 USDT 估算总资产，`btcSubscribeAmount` 是 BTC 估算总资产；`*HistoricalAmount` 为 24 小时收益，`*TotalEarning` 为累计收益。 | 聚合估值只取一次；收益字段不是新增本金。不得与 SharkFin assets/records 或全账户 `earn` 相加。文档示例 URL 误写为 savings，必须以页面的 HTTP Request 声明的 `/sharkfin/account` 为准。 |
| 当前 SharkFin 产品记录 | `GET /api/v2/earn/sharkfin/assets`，10 次/秒/UID；必填 `status`（`subscribed` 或 `settled`），可给三个月窗口的 `startTime/endTime`；`limit` 缺省 20、最大 100，以响应 `endId` 传入 `idLessThan` 向旧页翻。 | 返回 `productId`、币种、利息起止/结算时间、`interestAmount`、`productStatus`，**没有当前订阅本金/持仓数量**；不可从此端点推算资产，也不可与 account 汇总相加。若分页失败、`endId` 循环或到范围下界前异常，应视为记录历史不完整；它不应影响 account 总额读取。 |

官方来源：[SharkFin Account](https://www.bitget.com/api-doc/classic/earn/sharkfin/Shark-Account)，[SharkFin Assets](https://www.bitget.com/api-doc/classic/earn/sharkfin/Shark-Assets)。

### 2.2 On-chain Elite

| 项目 | 官方合同 |
| --- | --- |
| 方法与路径 | `GET /api/v2/earn/elite/assets`。 |
| 只读与权限 | 私有签名、5 次/秒/UID；官方明确为 `Spot Trading (Read Only)`。 |
| 分页 | 无参数，响应为 `data.resultList`，没有 `limit`、游标或总数；按当前文档只可作为一次当前列表快照。若响应分页合同将来变化，必须重新评审，不能静默截断。 |
| 关键字段 | `productId`（明细去重键）、`productCoin`、`holdingAmount`（持有量）、`usdtHoldingAmount`（USDT 等值）、`exchangeRate`、`subscriptionCoin`；APR/APY、`totalProfit`、BG Points 等不是另一份本金。 |
| 计数规则 | 每一 `productId` 仅计算一次：展示原币取 `holdingAmount`，聚合估值取 `usdtHoldingAmount`，两者是同一持仓的不同计量，不可相加。 |
| 失败语义 | 非 `00000`、HTTP/签名/权限/频控失败，或 `resultList`、`productId`、数量字段不完整时不提交该分区的新快照。 |

官方来源：[Get Elite Assets](https://www.bitget.com/api-doc/classic/earn/elite/Get-Elite-Assets)。

### 2.3 全账户或分产品总览

| 账户模型 | 端点 | 可得范围 | 不能做什么 |
| --- | --- | --- | --- |
| Classic | `GET /api/v2/account/all-account-balance`，1 次/秒/UID | `accountType` 分为 `spot`、`futures`、`funding`、`earn`、`bots`、`margin`，每项有 `usdtBalance`。无分页。 | 官方没有说明 `earn` 是否及如何包含 SharkFin、Elite；因此它只能是覆盖/守恒告警，不可再与 SharkFin account 或 Elite assets 求和。 |
| UTA | `GET /api/v3/account/assets` | 官方称为 UTA 的账户资产接口，仅回非零资产，且需 `UTA mgt. (read)`。 | 不能把 UTA 资产与 Classic 分区叠加，更不能假设其覆盖 Classic Earn 产品；需先识别账户模型。 |

官方来源：[Classic Assets overview](https://www.bitget.com/api-doc/classic/common/account/All-Account-Balance)，[UTA Get Account Assets](https://www.bitget.com/api-doc/uta/account/Get-Account)。

**仍不确定**：Bitget 官方没有公开 SharkFin/Elite 到 Classic `earn` 的包含矩阵，也没有 SharkFin active record 的本金字段。故只能让专用端点与 `earn` 总览进行“是否存在未解释差额”的对账；不能宣称全账户完全覆盖或用差额写入资产。

## 3. Binance：守恒端点复核

| 项目 | 2026-07-30 官方目录核对结果 |
| --- | --- |
| 方法与路径 | **未变化**：`GET /sapi/v1/asset/wallet/balance`。 |
| 只读与权限 | `USER_DATA` signed endpoint，需 `X-MBX-APIKEY` 和签名；精确 GET 路径是只读，仍不能把 `USER_DATA` 泛化为所有端点安全。 |
| 请求 | `timestamp` 必填；`quoteAsset` 可选、缺省 BTC；`recvWindow` 可选，最大 60000。 |
| 关键字段 | 数组元素的 `walletName`、`balance`、`activate`。这是钱包级估值/余额，不是逐币种或产品明细。 |
| 分页/失败 | 当前响应是数组，无分页参数、cursor 或 total。HTTP/签名/业务错误、schema 缺失均不能当空数组或零钱包。 |
| 去重 | 与同一 `walletName` 下的 Spot、Earn、Funding、产品账户/仓位具有潜在重叠；仅将其作为守恒和覆盖检查，绝不将其余额再加进明细总额。 |

官方来源：[Binance Wallet REST API — Query User Wallet Balance](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#query-user-wallet-balance)。

## 4. 统一接入边界

1. 同一经济资产只选择一个“本金主源”；产品明细、账户汇总、平台总额三者是互斥层次。
2. 聚合总额只产生 `coverage`/对账差异，不得补造未知持仓。
3. 任一读取失败、签名/权限错误、限流耗尽或关键 schema 不完整时，保留最后成功快照并标记过期；绝不以空数据覆盖。
4. 不用真实凭证探测权限或产品覆盖；上线前再以用户确认的仅只读 Key 做一次同一时点的人工对账。
