# BIT / Matrixport 钱包资产来源接入调研

调研日期：2026-08-04。范围为 BIT 官方文档及其同一文档站内的 DCP、Fixed Income、Balance+、Trade 页面；没有登录真实账户，也没有使用真实 API Key。本文保留接入时的历史调研结论；当前刷新生命周期以 [资产数据刷新生命周期](asset-refresh-lifecycle.md) 为准。

## 结论

可以接入，但应把它定义为 **`BIT / Matrixport` 托管账户来源**，而非链上观察钱包，也不是本仓库现有交易所适配器的简单复制。

当前接入包含 Wallet 余额与两类理财产品读取：

- `GET /mapi/v1/wallet/balance` 返回每种货币的 `balance`、`available_balance`、`frozen_balance`、`unconfirmed_balance`。
- `GET /flexible/api/v2/app/homepage` 读取 Balance+ 逐币余额。
- `GET /dcp/api/v1/total-positions` 读取 DCP USD 总头寸。
- 该接口在官方权限表中标为私有 `read`；提现是另一个 `POST /mapi/v1/wallet/withdraw`，标为 `wallet` 权限。
- 因余额接口不返回市价，币种估值必须复用或扩展独立报价来源；不能把 BIT Trade 的 RFQ 报价当作通用现货行情。

但不能声称 API Key 已被程序严格证明为“只读”：当前官方文档没有提供可查询 API Key 权限/范围的接口。接入时必须让用户在 Key 管理页新建仅含 `read`、不含 `wallet` 的 Key；应用只调用白名单 GET 接口，绝不调用任何 POST/提现/赎回/下单接口。

## 官方 API 边界

| 数据域 | 可读接口与数据 | 建议状态 | 接入口径 |
| --- | --- | --- | --- |
| Wallet | `GET /mapi/v1/wallet/balance`；币种总余额、可用、冻结、待确认 | 已接入 | 每币种一条持仓；`balance` 才是数量，后三者只作状态拆分，不能再次计入总额。 |
| Wallet 历史 | `withdrawals`、`deposits`、`bills` 均为 GET/read | 暂不接入 | 看板不需要交易流水；地址、入出金和账单会扩大隐私面。 |
| DCP（双币产品） | `GET /dcp/api/v1/total-positions` 给 USD 总头寸；`GET /dcp/api/v2/pnl` 给产品 PnL 摘要；另有订单清单/详情 | 已接入 USD 聚合 | 总头寸为 USD 聚合值，不伪造逐币持仓；不读取 PnL、订单或赎回接口。 |
| Fixed Income | `GET /fixed-income/api/v2/orders`、`/order`；`GET /fixed-income/api/v3/user-asset/statistics_usd` 返回总资产、昨日/持有/累计利息 | 不接入 | UID 3827903 已确认该产品不在资产范围内；当前 API Key 也无法读取该接口。 |
| Balance+ | `GET /flexible/api/v2/app/homepage` 返回各币种余额/收益；另有币种详情、利息明细 | 已接入 | 逐币余额；官方示例中的 `total_balance_amount` 未明确计价币种，因此不用于总资产。 |
| Trade | RFQ 报价、下单、订单查询 | 不接入 | 页面没有账户余额、现货/衍生品仓位接口；RFQ 报价是下单前报价，不是持仓估值的可靠行情服务。 |

来源：

- [Wallet：主机、认证、权限矩阵与余额](https://www.bit.com/docs/en-us/wallet.html)
- [DCP：总头寸与 PnL](https://www.bit.com/docs/en-us/dcp.html#total-position)
- [Fixed Income：订单和 USD 资产统计](https://www.bit.com/docs/en-us/fixed_income.html#order-list)
- [Balance+：逐币余额与利息](https://www.bit.com/docs/en-us/balanceplus.html#currency-list)
- [Trade：RFQ 与下单](https://www.bit.com/docs/en-us/trade.html#trade-service-api)

## 认证、主机与频率

- 官方 Wallet 页声明生产 REST 基址为 `https://mapi.matrixport.com`，API Key 在 Matrixport 的 Key 管理门户申请。
- 私有 Wallet 请求采用 `X-MatrixPort-Access-Key`、`X-Signature`、毫秒 `X-Timestamp`、`X-Auth-Version: v2`；签名为 `hex(hmac_sha256(timestamp + method + api_path + "&" + body, secret_key))`。
- 2026-08-04 的安全探测表明，`/fixed-income/api/v3/user-asset/statistics_usd` 在 `mapi.matrixport.com` 返回 `404`；转向 `api.matrixport.com` 虽会返回 `401`，但真实 API Key 请求同样返回“Chat has expired”，说明它要求网页登录会话，不能用作只读 API 的替代。UID 3827903 已确认没有 Fixed Income 资产，因此该产品不在此来源的读取和完整性范围内。
- Wallet 私有 API 文档限额为每用户每秒 1 请求，超限为 HTTP 429。当前统一每小时完整刷新及手动单来源刷新，每个 BIT 来源批次只调用一次 Wallet balance；已移除的历史 `prices`/30 秒行情轮询不得恢复用于请求 BIT。

## 与本仓库模型的对应

现有统一接入流程已具备“预览 → 服务器临时加密 → 确认时重验 → SecretStore 持久化 → 同步器”的边界，适合承载 API Key/Secret；浏览器预览不应得到凭证正文或 Wallet 明细。

需要新增一个 `bit` provider，而不是复用 `bitget`：

1. `src/domain/asset-source-providers.ts`、`src/server/asset-source-provider-adapters.ts`、预览/确认路由：增加 API Key、API Secret 的 `bit` 输入与中文权限说明。
2. `src/server/ports.ts`、`src/server/production.ts`、`src/server/asset-sources/router.ts`：增加 `BitReadOnly`、连接落库、`ProductionBitReadOnly`、`ProductionBitSourceRefresher` 路由。
3. 新适配器只允许 Wallet、Balance+、DCP 的三个明确 `GET`；Wallet 验证失败会拒绝预览，理财域临时不可用则保留其覆盖状态；刷新失败均保留上次成功快照并标记过期。
4. `AssetHolding.sourceAccount` 需增加 `wallet`，避免把托管钱包余额伪标为 `funding`；`available/frozen/unconfirmed` 作为余额拆分展示。
5. 现有 `Prices` 目前只提供 USDT/USD，不能估值 BTC、ETH 等 Wallet 币种。第一版要么扩展独立报价端口，要么将无报价币种标为“未估值”，绝不按零计入总资产。

相关现有接缝：

- [资产来源 Provider 定义](../../src/domain/asset-source-providers.ts)
- [统一预览/确认事务](../../src/server/asset-source-onboarding.ts)
- [Provider adapter 装配](../../src/server/asset-source-provider-adapters.ts)
- [同步及 SecretStore 边界](../../src/server/asset-synchronization.ts)
- [生产装配与刷新器路由](../../src/server/production.ts)

## 覆盖与去重规则

- Wallet V1 的覆盖可标为“Wallet 余额明细完整；投资产品未知”。不能据此宣称覆盖 DCP、Fixed Income 或 Balance+。
- 若以后重新加入 Fixed Income，需先获得可用的只读 API；每个产品域都先以平台给出的聚合总额或逐订单明细择一计入；同一资产绝不把 Wallet 余额、产品本金、产品 USD 总额三者相加。
- DCP 的 `total_position` 已以 USD 计价，且会返回报价失败状态；报价失败时应标记来源不完整，不能用零替代。
- Fixed Income 在 2026-01-26 的变更中新增了 tokenized-loan、续期本金类型和利息提取相关能力；产品范围不是静态的，适配器必须有明确的覆盖状态和回归样本。

## 风险与验收前置条件

1. **权限不可编程证明**：文档仅说明接口所需权限，未见 API Key 权限查询。用户须人工确认新 Key 只有 `read`、不含 `wallet`；应用只使用四条 GET 白名单。
2. **账户身份**：Wallet 文档未见返回稳定 `user_id` 的余额接口。预览阶段应把 API Key 的不可逆本地指纹当作“凭证身份”，不得伪称它是平台账户 ID；若需要防止同账户重复接入，应先向官方确认身份接口。
3. **文档一致性**：Wallet changelog 仅有 `V1.0.0 / 2022-04-26`，但页面仍在 2026-07-09 更新；主机/认证示例也互相矛盾。不能以文档时间判断接口已稳定，必须用用户自己新建的只读 Key 做预览、确认、刷新、失败恢复和断开删除的真实验收。
4. **真实账户验收**：在用户明确授权前，不登录 Key 管理页、不创建 Key、不输入凭证。验收只需要读权限，不需要任何交易、转账、提现、地址或私钥。

## 推荐实施顺序

1. 已实现 Wallet、Balance+、DCP 的只读预览、确认保存、刷新与失败恢复。
2. 用一个真实小额只读账户验证：V2 签名、API Key 权限、`mapi` 主机、币种映射、产品间去重与估值；这一步通过后才把功能标为可用。
