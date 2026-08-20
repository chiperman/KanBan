# OKX、Bitget 与 BIT 产品明细 API 审查

调研日期：2026-08-16。范围仅为资产页当前标记为“仅汇总”的产品；使用现有适配器代码和平台官方 API 文档核对。未登录账户、未使用真实 API Key。本文记录的 BIT DCP 第一阶段已在隔离测试中实现；真实账户验收仍未进行。

## 结论

有两项可以确定是“平台提供了明细、我们尚未接入”：

| 平台 | 产品 | 当前实现 | 平台明细能力 | 结论 |
| --- | --- | --- | --- | --- |
| BIT / Matrixport | DCP | 仅调用 `GET /dcp/api/v1/total-positions`，生成一条 USD 聚合持仓 | `GET /dcp/api/v1/orders` 可分页读取订单，`GET /dcp/api/v1/order` 可读取单笔详情 | **应优先接入** |
| Bitget | 普通合约 | Classic 账户只读取全账户权益；UTA 读取持仓、挂单仅用于拒绝含合约风险的连接 | UTA 已有当前持仓与未成交订单读取；Classic 也有对应合约持仓/订单文档入口 | **尚未接入，但先扩展资产模型** |

其余项目不能直接定性为“漏接”：

| 平台 | 产品 | 结论 |
| --- | --- | --- |
| OKX | Trading Bot | 当前按账户余额中的 `stgyEq` 逐币读到策略权益，未展开机器人/策略。需要重新取得并核验官方机器人订单接口的读权限、字段和账户范围后才能安排接入；本次网络无法连通 OKX 文档站，不能把“有页面”当成可用的只读数据契约。 |
| OKX | 定期 Simple Earn | 现有官方 Simple Earn 余额接口只覆盖活期；没有已验证的、能返回当前定期仓位并处理到期/赎回的只读接口。**目前应视为平台 API 缺口，而非简单漏接。** 不能由申购/赎回历史反推当前本金。 |
| Bitget | Futures Bot | 当前 `GET /api/v2/account/bot-assets?accountType=futures` 只给机器人账户的按币种聚合权益。尚未取得可证明逐机器人当前资产的官方只读契约；不应从策略历史或交易订单推算当前权益。 |
| Bitget | SharkFin | 当前仅读取 `GET /api/v2/earn/sharkfin/account` 的 `usdtSubscribeAmount` 聚合值。官方文档仍列有 Assets/Records 入口，但直接页面当前重定向至 UTA 首页，字段和“是否可得到当前逐仓本金”未能可靠核验。**列为待验证，不排期实现。** |

## 已有实现与证据

- OKX 覆盖定义在 [`src/server/asset-sources/okx.ts`](../../src/server/asset-sources/okx.ts)：Trading Bot 的说明是“按币种读取 Trading `stgyEq`”，定期 Simple Earn 的说明是“官方当前仓位 API 无法逐仓展开”。现有读取仅包含交易、资金、活期 Simple Earn、链上 Earn 和资产总估值。
- Bitget 覆盖定义在 [`src/server/asset-sources/bitget.ts`](../../src/server/asset-sources/bitget.ts)：Classic 模式将普通合约、Futures Bot 标为仅汇总；UTA 的 `current-position` 和 `unfilled-orders` 已存在于客户端，但只用于 `validateUtaCashOnly`，即发现任一合约仓位/挂单就拒绝连接，而非写入持仓。
- BIT 覆盖定义在 [`src/server/asset-sources/bit.ts`](../../src/server/asset-sources/bit.ts)：DCP 只白名单并调用总头寸端点，且明确写明“不读取订单、PnL 或赎回能力”。

## 可实施项

### P1：BIT / Matrixport DCP 订单明细（已实现第一阶段）

官方 DCP 文档确认：

- 该 API 服务只面向合格投资者；在创建实现 Ticket 前，先确认现有账户和只读 Key 对此 API 仍有资格；
- `GET /dcp/api/v1/orders` 支持 `offset`、`limit`、`status_category`（全部、活跃、已结算）和币种过滤；
- 订单条目包含稳定 `id`、投入金额/币种、状态、到期时间、预估结算金额/币种、实际结算金额/币种，以及当前计算出的 `pnl`；
- `GET /dcp/api/v1/order` 可按订单 ID 获取同一笔的完整详情；
- 已接入的 `GET /dcp/api/v1/total-positions` 是 USD 总头寸，不应和订单明细相加。

来源：[Matrixport DCP - Order list](https://www.bit.com/docs/en-us/dcp.html#order-list)、[Order detail](https://www.bit.com/docs/en-us/dcp.html#order-detail)、[Total position](https://www.bit.com/docs/en-us/dcp.html#total-position)。

已实现边界：

1. 在 BIT 客户端白名单增加 `GET /dcp/api/v1/orders`，从活跃订单开始分页；不调用下单、赎回、PnL、订单详情或任何 `POST`。
2. 用订单 ID 作为 `providerPositionId`；即使平台以大整数 JSON 数字返回 19 位 ID，也在解析前保留其精度。持仓列表展示投入币种、订单号、标的、状态和上海日期的到期日。
3. `total_position` 仍是唯一计入总资产的 DCP 值；逐订单持仓标为“已含入 USD 总头寸，订单级当前估值未提供”，没有来源市值，因此绝不“总头寸 + 订单金额”二次计入。
4. 订单列表临时失败时，保留已验证的 USD 总头寸，并维持“仅汇总”覆盖状态；不会把非关键明细读取失败误报为总额失效。

实现已覆盖读取、分页边界、稳定订单标识、总额不重复计入和展示名称；尚未用真实账户核验平台实际字段、分页上限与总头寸对账。

### P2：Bitget 普通合约明细

已有代码说明当前账户策略是“只接受现金账户”：UTA 连接时会查询当前持仓和未成交订单，一旦发现合约仓位或挂单即拒绝。Classic 模式则用全账户权益保证总额完整，但不展开普通合约。

官方文档入口：

- [UTA Current Position](https://www.bitget.com/api-doc/uta/position/Get-Current-Position)
- [UTA Unfilled Orders](https://www.bitget.com/api-doc/uta/trade/Get-Unfilled-Orders)
- [Classic Contract Position](https://www.bitget.com/api-doc/contract/position/Get-All-Position)
- [Classic Contract Open Orders](https://www.bitget.com/api-doc/contract/trade/Get-Unfilled-Orders)

这些 Bitget 直接文档页面在 2026-08-16 会重定向到 UTA 首页，因此本次不能把字段、分页、权限或频率作为已确认契约；实施前必须用同一只读 Key 对照其最新版文档和响应样本复核。

即使字段核验通过，也不能把合约“仓位名义价值”当作普通资产相加。合约至少涉及保证金、未实现盈亏、挂单冻结资金和多空方向，和已读取的全账户权益重叠。实施应先：

1. 在领域模型新增衍生品仓位/保证金的只读展示模型，不能伪造成现货 `AssetHolding`；
2. 保留平台全账户权益为总额权威值，只将仓位用于明细解释和对账；
3. 对 Classic 与 UTA 分别实现，按账户模式取得真实字段契约；
4. 在真实只读 Key 验收通过前，继续拒绝含合约仓位的 UTA 连接，避免从“资产看板”悄然变成风险不明的衍生品估值系统。

## 不应实施的替代方案

- 不从 OKX 定期 Earn、Bitget SharkFin 或交易机器人历史记录反推当前资产：赎回、到期、内部划转和收益结算都会造成重复或漏算。
- 不把 DCP 订单本金、Bitget 合约名义价值、机器人聚合权益与既有平台总额同时加入总资产。
- 不因获取明细而请求 `trade`、`withdraw`、赎回或下单权限；本项目仍只接受并只调用只读 GET 接口。

## 下一步

若确认实施，顺序应为：

1. 使用用户明确授权的真实只读 BIT Key 做预览、同步、总额对账、断开删除验收；
2. 决定是否需要补充订单详情接口；仅当列表字段不足以解释某笔活跃订单时才读取，避免额外私有请求；
3. 单独立项 Bitget 衍生品领域模型和 API 契约复核；不与 DCP 订单 Ticket 混合。

OKX 定期 Earn、OKX Trading Bot、Bitget Futures Bot 与 SharkFin 在取得可证明的“当前明细 + 只读权限 + 不重复口径”前，维持“仅汇总”标识是正确的。
