# Binance 产品与资产覆盖审计

调研日期：2026-07-28（Asia/Shanghai）

范围：Binance 官方 Developer Docs、API Catalog、官方 `llms.txt` 索引，以及所有者现有只读 API Key 的脱敏真实账户验收。
安全边界：官方目录研究未读取凭据；真实验收仅执行 signed 只读请求，只记录 HTTP 状态、数量、状态分布和非零布尔值，不输出 Key、Secret、签名、订单号或资产金额。未修改业务代码或既有研究文件。

## 结论

不能把“币安资产”只理解为 Spot、Funding 和 Simple Earn。按当前官方公开 API，普通用户还可能持有 Dual Investment、Discount Buy、BFUSD、RWUSD、ETH Staking、SOL Staking、On-chain Yields 等独立经济敞口；官方 2026 Earn 分类还列出 Dual Investment RFQ 和 Smart Arbitrage，但 Developer Catalog 未提供对应的专用当前仓位端点。另有 Margin、Futures、Options、Portfolio Margin、Crypto Loan/VIP Loan 等广义账户资产与负债。

最重要的边界有四条：

1. `BNB Vault`、`Binance Launchpool`、`Binance Megadrop` 截至调研日均未在官方 Developer API Catalog/`llms.txt` 中出现专用当前仓位端点。不能因为没有端点就推断用户没有资产，也不能未经官方保证就假设它们一定已包含在 Simple Earn。
2. 很多产品同时提供“账户汇总”和“逐仓明细”；两者是同一资产的不同视图，不能相加。历史订阅、赎回、奖励记录是流量，也不能当作当前余额。
3. `USER_DATA` 不等于只读。官方目录中存在会改变状态的 `POST ...subscribe/redeem/setAutoSubscribe`，Soft Staking 甚至把 `GET .../set` 描述为启用/停用。资产同步必须使用精确的 `method + path` 只读 allowlist。
4. 不能继续靠“再补一个产品端点”宣称完整。必须以 `GET /sapi/v1/asset/wallet/balance` 的钱包总览和各产品账户汇总做守恒校验；发现正余额钱包或未解释 Earn 残差时，来源必须显示“统计不完整”。

官方总目录当前把 Advanced Earn 明确拆为 `Discount Buy` 和 `Dual Investment` 两个 API 产品，而不是一个可独立相加的 “Advanced Earn 账户”。来源：[API Catalog](https://developers.binance.com/en/docs/catalog)、[官方机器可读索引](https://developers.binance.com/en/docs/llms.txt)。

## 2026-07-28 真实账户验收

本节是当时账户状态的只读快照，不代表以后仍为零，也不替代实现后的人工验收。

| 检查面 | 脱敏结果 | 对当前缺口的判断 |
| --- | --- | --- |
| KanBan 当前 Binance 快照 | 同步状态正常，共 11 条持仓；仅包含 Spot 与 Simple Earn Flexible | “同步成功”不等于 Binance 产品完整 |
| Dual Investment positions | 完整抓取 2 页、共 163 条；`PURCHASE_SUCCESS=1`、`SETTLED=162`，唯一未结算记录的结算日在未来 | 当前确实至少漏掉 1 条在途本金仓位 |
| Dual Investment accounts | HTTP 200，BTC/USDT 汇总均非零 | Key 权限和地域支持正常；不是 Binance 无数据 |
| Discount Buy | account 与分页 position 均 HTTP 200，当前总数为 0 | 当前无漏算本金，但未来参与后现有实现会漏 |
| ETH/SOL Staking、On-chain Yields、BFUSD、RWUSD | 全部 HTTP 200，当前账户字段/仓位为零 | API 可读但现有实现未接入；属于未来覆盖缺口 |
| Soft Staking | HTTP 200；当前 `stakedAmount>0` 的资产为 0，但存在历史奖励 | 本金不应重复计入；收益归因当前缺失 |
| Wallet balance | 10 个钱包中仅 Spot、Earn 为正；Margin、Futures、Options、Trading Bots、Copy Trading 均为零 | 当前没有需要纳入的杠杆/衍生品钱包 |
| Earn 守恒 | Simple Earn + Dual + Discount Buy + On-chain Yields 与 Earn 钱包总览残差小于 0.1% | 加上 Dual 后，未发现第三个“实质性未知本金”证据；小残差仍应按精度阈值对账，不能硬判为零 |

因此，**当前账户眼下实际漏算的是 Dual Investment；系统性缺口则覆盖下表全部产品族**。

## 覆盖分层与优先级

### A. 当前 KanBan 已有的四类基线

当前实现审计显示，`src/server/asset-sources/binance.ts` 只读取以下四类资产；其余产品均未进入当前 Binance 快照。

| 产品/钱包 | 当前资产端点 | 历史/审计端点 | 当前仓位 API | 计数规则 |
| --- | --- | --- | --- | --- |
| Spot | `GET /api/v3/account`（`USER_DATA`） | `GET /sapi/v1/accountSnapshot` 可提供日快照；订单、成交、充提另有各自历史接口 | 是 | 每币种以 `free + locked` 为当前 Spot 数量；不要与 Wallet 的账户级总余额接口重复相加 |
| Funding Wallet | `POST /sapi/v1/asset/get-funding-asset`（`USER_DATA`，虽然是 POST，但属于读取） | `GET /sapi/v1/asset/transfer` 只覆盖 Universal Transfer 历史；Pay/C2C/Fiat 各有独立历史，官方没有一个完整 Funding 历史总账端点 | 是 | 保留 `free/locked/freeze/withdrawing` 分量；`btcValuation` 是估值视图，不是额外本金 |
| Simple Earn Flexible | `GET /sapi/v1/simple-earn/flexible/position`（`USER_DATA`） | `.../history/subscriptionRecord`、`redemptionRecord`、`rewardsRecord`、`collateralRecord`、`rateHistory` | 是，逐仓、分页 | `totalAmount` 是仓位量；奖励、抵押分量和账户汇总不可再次相加 |
| Simple Earn Locked | `GET /sapi/v1/simple-earn/locked/position`（`USER_DATA`） | `.../history/subscriptionRecord`、`redemptionRecord`、`rewardsRecord` | 是，逐仓、分页 | 以实际持有状态的 `amount` 为本金；`rewardAmt`、`redeemingAmt` 不应无条件加到本金 |

Simple Earn 另有 `GET /sapi/v1/simple-earn/account` 账户汇总。它适合做对账校验，不应与 Flexible/Locked 明细同时纳入资产总额。来源：[Spot REST](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api)、[Wallet REST](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api)、[Simple Earn REST](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api)。

当前领域类型也把 `sourceAccount` 固定为 `spot | funding | earn-flexible | earn-locked`。这不是只缺几次 HTTP 调用：数据合同本身无法表达 Dual、RFQ、staking、settling/redeeming 和未知产品覆盖状态。

### B. 有官方专用当前仓位/账户 API，建议优先接入

| 优先级 | 官方产品名 | 账户/当前仓位只读端点 | 历史能力 | 当前仓位 API | 去重与快照建议 |
| --- | --- | --- | --- | --- | --- |
| P0 | Dual Investment | 汇总 `GET /sapi/v1/dci/product/accounts`；仓位 `GET /sapi/v1/dci/product/positions`，均 `USER_DATA` | 没有独立 history 端点；`positions` 是批量仓位/历史混合视图，必须按状态筛选并完整分页 | 有，但不是“仅当前” | 逐仓作为估值主源，accounts 只校验；仅计本金仍锁定、尚未结算的状态。已结算/退款记录不留在当前资产；预计收益不在结算前记为已实现收益 |
| P1 | Discount Buy | 汇总 `GET /sapi/v1/accumulator/product/sum-holding`；仓位 `GET /sapi/v1/accumulator/product/position/list`，均 `USER_DATA` | 无独立 history；position list 混合 `PENDING/PURCHASE_SUCCESS/SETTLING/SETTLED/PURCHASE_FAIL/REFUNDING/REFUND_SUCCESS` | 有，但当前与历史混合 | 逐仓为主、sum-holding 只校验；只计本金尚未结清的状态。结算后资产若已进入 Spot，不再保留原产品本金 |
| P1 | BFUSD | `GET /sapi/v1/bfusd/account`（`USER_DATA`） | `.../history/subscriptionHistory`、`redemptionHistory`、`rewardsHistory`、`rateHistory`；另有 quota | 有，账户级 | 账户接口是当前敞口主源；若未来同时接入 USDⓈ-M/Portfolio Margin，需确认 BFUSD 是否也出现在其余额中并按经济资产去重 |
| P1 | RWUSD | `GET /sapi/v1/rwusd/account`（`USER_DATA`） | `.../history/subscriptionHistory`、`redemptionHistory`、`rewardsHistory`、`rateHistory`；另有 quota | 有，账户级 | 与 BFUSD 相同；官方 Portfolio Margin Pro 还提供 `earn-asset-balance` 和 RWUSD transfer，接入多账户后重复风险高 |
| P1 | ETH Staking | `GET /sapi/v2/eth-staking/account`（`USER_DATA`） | staking/redemption、WBETH rewards/rate、BETH↔WBETH wrap/unwrap 历史 | 有，账户级 | `holdingInETH` 是 ETH 等值汇总，WBETH/BETH 是组成/包装代币，不能相加；若 Spot 已含 WBETH/BETH，不可再把同一 staking 等值全部叠加。待赎回部分单列过渡态 |
| P1 | SOL Staking | `GET /sapi/v1/sol-staking/account`（`USER_DATA`） | staking/redemption、BNSOL rewards/rate、Boost rewards、unclaimed rewards | 有，账户级 | `bnsolAmount` 与 `holdingInSOL` 是同一敞口的代币量和 SOL 等值，不能相加；若 Spot 已含 BNSOL，需选择一个本金主源 |
| P1 | On-chain Yields | 汇总 `GET /sapi/v1/onchain-yields/account`；逐仓 `GET /sapi/v1/onchain-yields/locked/position`，均 `USER_DATA` | locked subscription/redemption/rewards history | 有：Locked 有逐仓，账户有汇总 | 逐仓 `amount` 为 Locked 主源，汇总只校验；仅计实际持有状态，`redeemingAmt` 单列。账户响应含 Flexible 汇总，但 Catalog 没有对应 Flexible 逐仓端点，因此明细覆盖存在官方能力缺口 |

来源：[Dual Investment REST](https://developers.binance.com/en/docs/catalog/investment-and-services-dual-investment/api/rest-api)、[Discount Buy REST](https://developers.binance.com/en/docs/catalog/investment-and-services-discount-buy/api/rest-api)、[Simple Earn REST](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api)、[Staking REST](https://developers.binance.com/en/docs/catalog/investment-and-services-staking/api/rest-api)。

### C. 无独立当前仓位，或本金实际复用其他分区

| 官方产品/功能名 | 官方当前可观测能力 | 判断 | 资产快照建议 |
| --- | --- | --- | --- |
| Soft Staking | `GET /sapi/v1/soft-staking/list` 为产品列表；`.../history/rewardsRecord` 为奖励历史；没有专用当前本金仓位。`GET /sapi/v1/soft-staking/set` 虽标 `USER_DATA`，但描述为启用/停用，不能放进只读 allowlist | 本金复用符合资格的现有钱包资产，而不是新增一份仓位 | 本金只在 Spot/Funding 等原钱包计一次；奖励实际到账后计钱包余额，历史只用于收益归因 |
| BNB Vault | 官方 Catalog/`llms.txt` 未发现 Vault 专用账户、仓位或历史端点；只能看到 BNB 的 Spot/Simple Earn 等底层视图 | 无法通过当前公开 Developer API 证明某个 BNB 仓位“属于 BNB Vault” | 不新建 Vault 本金副本；若用户声明参与而 API 无法核实，来源状态标记“统计不完整/产品归属不可证明” |
| Binance Launchpool | 未发现专用当前仓位或奖励历史端点 | 无官方可依赖的完整读取面 | 通过 BNB/Simple Earn 产生的参与权益不是额外本金；奖励进入钱包后只计一次。若存在直接锁仓且 API 无法读取，必须显式报告漏数风险 |
| Binance Megadrop | 未发现专用账户、分数、任务或仓位端点 | 资格/积分不是资产；底层 BNB 或 Web3 任务也不应复制成第二份本金 | 只计底层钱包/理财仓位与已实际到账奖励；无法证明的在途权益标记不可用 |
| Yield Arena | 仅见 `GET /sapi/v1/earn/arena/activities`（`USER_DATA`） | 活动发现信息不是当前持仓 | 不计入余额；若活动最终映射到其他产品，以对应产品仓位为准 |
| Dual Investment RFQ | Binance 2026 Earn 官方指南把它列为独立 Advanced Earn 产品；Developer Catalog/`llms.txt` 未发现 RFQ 专用当前仓位端点，也未保证普通 `/dci/product/positions` 包含 RFQ | “补普通双币”不能自动宣称覆盖大额询价双币 | 先用 Earn 钱包守恒暴露残差；用户实际参与 RFQ 后必须做一次真实对账，确认是否投影到普通 DCI 端点，否则标记 unsupported/partial |
| Smart Arbitrage | Binance 2026 Earn 官方指南将其列为 Advanced Earn；Developer Catalog/`llms.txt` 未发现专用账户/仓位端点 | 可能投影到 Earn 或 Trading Bots 钱包，但官方公开文档未给可依赖的逐仓合同 | 监测 Earn/Trading Bots 钱包正余额；无明细时只能展示聚合未识别余额和“统计不完整”，不能猜底层多空仓位 |

这里的“未发现”只表示：截至 2026-07-28，在 Binance 官方 Developer API Catalog 和官方 `llms.txt` 中没有公开、受支持的专用端点；不代表 Binance App 中没有该产品，也不代表用户实际没有参与。Earn 产品分类来源：[Binance Academy 2026 Earn 指南](https://academy.binance.com/en/articles/a-beginner-s-guide-to-binance-earn)。

### D. 广义中心化账户资产与负债

这些不一定属于“理财”，但会改变账户净资产。如果用户启用了对应业务，资产看板必须接入，或明确显示该分区未覆盖；绝不能仍宣称 Binance 总资产完整。

| 分区 | 关键只读当前端点（均为官方 Catalog 中的 `USER_DATA`） | 必须纳入的经济含义 |
| --- | --- | --- |
| Cross/Isolated Margin | `GET /sapi/v1/margin/account`、`GET /sapi/v1/margin/isolated/account` | 资产、借款、利息与净资产；不能只加资产而忽略负债 |
| USDⓈ-M Futures | `GET /fapi/v2/account` 或 `/fapi/v3/account`、`GET /fapi/v2|v3/balance`、`GET /fapi/v2|v3/positionRisk` | 钱包余额、未实现盈亏、仓位与保证金；不能把 account、balance、positionRisk 三份总额相加 |
| COIN-M Futures | `GET /dapi/v1/account`、`GET /dapi/v1/balance`、`GET /dapi/v1/positionRisk` | 币本位保证金、未实现盈亏与仓位 |
| Options | `GET /eapi/v1/marginAccount`、`GET /eapi/v1/position` | 期权保证金账户与期权仓位；按净敞口/账户权益建模 |
| Portfolio Margin | `GET /papi/v1/account`、`GET /papi/v1/balance`，及 CM/UM/margin 子账户与 positionRisk | 这是跨产品统一保证金视图，和独立 Margin/Futures 端点高度重叠；账户模式识别后只能选择一套权威总账 |
| Portfolio Margin Pro | `GET /sapi/v1/portfolio/account` 或 v2、`.../balance`、`.../earn-asset-balance` | 与 Spot/Futures/Earn 可能交叉展示；不能并行盲加 |
| Crypto Loan | `GET /sapi/v2/loan/flexible/ongoing/orders`；borrow/repay/liquidation/LTV history | 借入资产和抵押物必须成对建模；净资产应扣负债，不能把借入币当新增本金 |
| VIP Loan | `GET /sapi/v1/loan/vip/ongoing/orders`、`.../collateral/account`、`.../accruedInterest` | 贷款本金、累计利息与抵押物；同样按净值而非资产毛额 |
| Sub-account / Managed Sub-account | 官方 Sub Account API 提供账户列表、资产与快照端点 | 主账户和子账户转账是内部流转；若同时抓总账户汇总与子账户明细，需去重 |
| Mining / Binance Pool | `GET /sapi/v1/mining/statistics/user/list` 与 earnings/history | 若用户使用矿池，会形成独立收益来源；仅凭 Spot 无法重建完整在途收益 |

来源：[Margin](https://developers.binance.com/en/docs/catalog/core-trading-margin/api/rest-api)、[USDⓈ-M Futures](https://developers.binance.com/en/docs/catalog/core-trading-futures-usd-m/api/rest-api)、[COIN-M Futures](https://developers.binance.com/en/docs/catalog/core-trading-futures-coin-m/api/rest-api)、[Options](https://developers.binance.com/en/docs/catalog/core-trading-options/api/rest-api)、[Portfolio Margin](https://developers.binance.com/en/docs/catalog/advanced-trading-portfolio-margin/api/rest-api)、[Portfolio Margin Pro](https://developers.binance.com/en/docs/catalog/advanced-trading-portfolio-margin-pro/api/rest-api)、[Crypto Loan](https://developers.binance.com/en/docs/catalog/investment-and-services-crypto-loan/api/rest-api)、[VIP Loan](https://developers.binance.com/en/docs/catalog/investment-and-services-vip-loan/api/rest-api)。

## 推荐的资产快照合同

### 1. 以经济资产为单位，不以 API 响应为单位

每份当前快照至少保留：

```text
provider = binance
accountPartition = spot | funding | earn | staking | margin | futures | ...
product = simple_earn_flexible | dual_investment | discount_buy | ...
positionId / productId（若官方提供）
asset / quantity
economicAssetKey
state = active | redeeming | settling | settled | unknown
valuationAsset / valuationAmount / observedAt
coverage = complete | partial | unsupported | unknown
```

`economicAssetKey` 用于表达包装代币和账户等值是否为同一敞口，例如 ETH Staking 的 WBETH/BETH 与 `holdingInETH`、SOL Staking 的 BNSOL 与 `holdingInSOL`。同一 key 只能有一个估值主源。

### 2. 当前存量与历史流量严格分开

- 当前端点决定本次存量；历史端点只做收益归因、审计与状态恢复。
- 订阅和赎回是 Binance 内部分区移动，不是外部入金/出金，也不是投资收益。
- 奖励在“应计”和“已到账”之间要有明确状态；未到账预计收益不可冒充现金或已实现收益。
- position 接口混合当前与已结算记录时，未知状态必须让该产品 `coverage=unknown/partial`，不得默认按零。

### 3. 一产品一个本金主源

- 有逐仓明细：逐仓是本金主源，账户汇总仅校验。
- 只有账户 current API：账户端点是主源，内部等值字段与代币组成不相加。
- 包装代币同时出现在 Spot 与 staking account：根据官方字段语义选择一侧作为本金主源，另一侧保留为对账证据。
- 没有公开 current API：显示“统计不完整”，不得用历史流水猜余额后宣称精确。

## 建议落地顺序

1. **P0：Dual Investment + 钱包守恒哨兵**。Dual 是当前真实漏算；同时接入 `wallet/balance` 与 Earn 汇总对账，使未知产品/RFQ/Smart Arbitrage 不再静默消失。必须完整分页、状态过滤、结算去重，并把产品失败与来源整体失败分开表达。
2. **P1：其余有 current API 的本金产品**。接入 Discount Buy、BFUSD、RWUSD、ETH Staking、SOL Staking、On-chain Yields；先定义跨 Spot/Futures/Portfolio Margin 的经济资产去重，再接入。
3. **P2：不可观测或间接产品声明**。为 Dual Investment RFQ、Smart Arbitrage、BNB Vault、Launchpool、Megadrop、Soft Staking 建立 `unsupported/indirect/partial` 覆盖状态，而不是伪造零仓位。
4. **P3：账户模式探测与广义分区**。至少能识别 Margin、Futures、Options、Portfolio Margin、Loan、Sub-account 是否需要覆盖；未接入时在 Binance 来源卡明确列出未覆盖分区。

## 不确定项与需要真实账户验收的边界

- 本研究对列出的主要只读 current 端点完成了一次真实账户探测，但只证明 2026-07-28 当时该 Key、地域和账户状态；不能替代实现后的长期回归与产品参与后的逐项验收。
- BNB Vault、Launchpool、Megadrop 没有专用公开端点，无法仅靠文档判断它们当前在特定账户中是否完全投影到 Simple Earn/Spot。
- Dual Investment、Discount Buy 的状态集合和结算过渡可能继续演进；实现应保留原始状态，并对未知值 fail closed。
- On-chain Yields 当前只见 Locked 逐仓，而账户汇总包含更广视图；若用户持有无法逐仓展开的 Flexible 部分，应明确显示明细不完整。
- Dual Investment RFQ 和 Smart Arbitrage 在官方 Earn 产品分类中存在，但公开 Developer Catalog 未给专用当前仓位合同；必须依赖钱包级守恒发现缺口，并在真实参与后重新验收普通 DCI/Trading Bots 是否包含它们。
- 不同账户模式（经典账户、Portfolio Margin、Portfolio Margin Pro）会改变余额归属。正式宣称“Binance 总资产完整”前，必须用专用只读 Key 对实际账户做分区级验收，但仍不得调用任何 subscribe/redeem/transfer/order 等写接口。

## 官方来源索引

- [Binance Developer API Catalog](https://developers.binance.com/en/docs/catalog)
- [Binance Developer Documentation 与“仅文档接口受官方支持”的说明](https://developers.binance.com/en/docs/introduction)
- [官方 `llms.txt` 机器可读端点索引](https://developers.binance.com/en/docs/llms.txt)
- [Spot](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api)
- [Wallet](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api)
- [Simple Earn](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api)
- [Dual Investment](https://developers.binance.com/en/docs/catalog/investment-and-services-dual-investment/api/rest-api)
- [Discount Buy](https://developers.binance.com/en/docs/catalog/investment-and-services-discount-buy/api/rest-api)
- [Staking（ETH、SOL、On-chain Yields、Soft Staking）](https://developers.binance.com/en/docs/catalog/investment-and-services-staking/api/rest-api)
