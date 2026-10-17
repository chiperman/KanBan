# OKX Pay 与完整资产覆盖调研

研究日期：2026-07-29
范围：当前 KanBan 源码、OKX 官方 V5 / Onchain API 文档、OKX 官方帮助与变更公告；未调用真实私有 API，未读取凭证或修改业务代码。

## 结论

1. **已证实**：当前实现只把 Trading `details[].cashBal` 纳入 `spot`，因此遗漏官方定义为“分配给交易机器人”的 `stgyEq`；这与已知现象（资产总览约 606.15 USD，Trading 约 567.93、Pay 约 38.21、当前 KanBan 约 208.38）一致，但该金额是任务提供的观察值，本文未重新读取账户验证。
2. **已证实**：截至本研究日期可查的 OKX Exchange V5 文档没有 OKX Pay 余额或支付流水的公开端点。Pay 官方帮助说明其为需单独创建的 Web3 智能钱包，余额与历史在 OKX App 的 Pay 流程中查看；不能把 Trading/Funding API 响应解释为 Pay。
3. **已证实**：OKX Onchain/Wallet API 可按**公开钱包地址**读多链余额、估值与部分历史；它使用独立的 Onchain API 项目签名，不是 Exchange API Key 授权。若用户明确提供、确认归属的地址，可只读接入该地址；不能据此发现 Pay 地址、证明地址归属，或覆盖 Pay 的非链上/未暴露部分。
4. **推荐**：第一期先完整修复 Exchange Trading 现货/机器人聚合，再保留 Funding 与 Simple Earn Flexible；Pay 改为独立的“需地址确认”来源，不把不可读部分伪装成零。`asset-valuation` 仅做聚合对账，不作为与明细相加的持仓来源。

## 证据状态与口径

| 标记 | 含义 |
| --- | --- |
| 已证实 | 官方文档或当前源码直接说明。 |
| 推断 | 由字段、已知观察值或产品边界得出的实现建议，非官方公式。 |
| 未知 | 官方材料未给出足以安全纳入总额的字段关系/接口。 |

当前源码证据：[`src/server/asset-sources/okx.ts`](../../../../src/server/asset-sources/okx.ts) 的 `extractPositions()` 读取 `/api/v5/account/balance` 后只加入 `cashBal`，并另读取 Funding `bal` 与 Flexible `amt`。它不读取 `stgyEq`、Pay、On-chain Earn、staking 或其他金融产品。

## 1. Trading 字段与不重算规则

`GET /api/v5/account/balance` 返回 Trading Account 的非零资产；官方字段含义如下。

| 字段 | 官方语义 | 本研究的安全用法 |
| --- | --- | --- |
| `cashBal` | 币种现金余额 | 可用作“非机器人现金”展示分量；不能单独代表 Trading 全额。 |
| `stgyEq` | 分配给交易机器人的该币种总权益；覆盖 Spot/Futures Grid、Signal Bot、Futures/Spot Martingale、Infinite Grid、Recurring Buy | 可作为机器人聚合展示分量；不与 `eq` 并加。 |
| `eq` | 币种权益 | **Trading 币种总数量的候选唯一口径**；需先在真实只读回包验证它与现金/策略分量的关系。 |
| `eqUsd` | 币种权益的 USD 估值 | 仅作该 `eq` 的平台估值/对账，不能再与数量估值或 `totalEq` 相加。 |
| `totalEq` | Trading Account 以 USD 计的总权益 | 仅作 Trading 整体对账；不能与逐币种 `eq`、`eqUsd`、`cashBal` 或 `stgyEq` 相加。 |

来源：[Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)。

### 1.1 已证实与未知

- **已证实**：`stgyEq` 不是“可忽略的备注”；官方明确其为机器人分配权益，且覆盖多种机器人。
- **未知**：官方字段表没有给出可作为通用会计公式的 `eq = cashBal + stgyEq`。因此不能只凭字段名把三者相加，或断言它们在所有账户模式、所有机器人、挂单/负债状态下恒等。
- **推断**：本案例 Trading 的已知差额约为 `567.93 - 208.38 = 359.55 USD`，与机器人冻结资金的方向相符；仍必须用同一时点的真实响应逐币种核验，不能把该观察替代公式。

### 1.2 推荐算法（先对账，后入账）

1. 继续限定 Spot mode（`acctLv=1`）、无借贷、无 Option；Futures/Margin/Portfolio 的 `eq` 会受负债、未实现盈亏等影响，不在本期“现货资产”范围。
2. 对每个 Trading 币种保留原始 `cashBal`、`stgyEq`、`eq`、`eqUsd`，用 decimal 精度计算；不得用 JS `number` 聚合。
3. 只有在真实回包逐币种验证 `eq` 与计划展示分量一致时，才展示“现金 + 机器人”拆分；总额始终只取一次 `eq`（或只取经验证的 `cashBal + stgyEq`），二者不可并加。
4. 若存在不等、空字段、非零负债、衍生品/策略范围不清，则该币种保留为“Trading 未完成对账”，不以 `cashBal` 静默降级为全额。`totalEq` 只与币种 `eqUsd` 汇总比对，容许时间/估值口径差并记录差异。

这能修复已知遗漏，也避免 “`cashBal + stgyEq + eq + eqUsd + totalEq`” 的多层重复计算。

## 2. 产品盘点与接入状态

| 资产/产品 | 状态 | 可读边界与总额规则 | 证据 |
| --- | --- | --- | --- |
| Trading 现货现金与挂单冻结 | **可直接接入** | `account/balance`；以经对账的 `eq` 计一次，`cashBal`/`frozenBal` 仅为分量。 | [Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)；当前源码。 |
| 交易机器人/网格（Spot Grid 等） | **可直接接入（聚合）** | 同一 balance 的 `stgyEq` 是机器人聚合；读取网格/DCA/Signal 的订单、明细、子订单只能做归因/钻取，不能再把其投入额加回 Trading 总额。合约策略不在当前 Spot-only 范围。 | [Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)；[Grid/DCA API 目录](https://www.okx.com/docs-v5/en/) |
| Funding | **可直接接入** | `GET /api/v5/asset/balances` 的 `bal` 为单币种总量；`availBal`、`frozenBal` 只作分解。与 Trading 是独立账户，按币种各算一次。 | [Funding balance](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-balance) |
| Funding 非交易资产 | **可直接读取，须独立去重** | `GET /api/v5/asset/non-tradable-assets` 可返回不可交易资产；需先确认它与 Funding `bal` 是否互斥，不能直接叠加。 | [Get non-tradable assets](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-non-tradable-assets) |
| Simple Earn Flexible | **可直接接入** | `GET /api/v5/finance/savings/balance` 的 `amt` 为明细数量；收益、pending/redemption 等字段不另加。 | [Savings balance](https://www.okx.com/docs-v5/en/#financial-product-savings-get-saving-balance)；[迁移公告](https://www.okx.com/docs-v5/log_en/#2023-12-28) |
| Simple Earn Fixed | **当前公开 API 不可得** | 官方公告称 Fixed Loan 与 Simple Earn Fixed API 已下线；不从旧路径读取，也不能按零。 | [2025-03-03 公告](https://www.okx.com/docs-v5/log_en/#2025-03-03) |
| On-chain Earn | **可直接接入，须另做产品明细** | V5 Financial Product 目录列有 Active orders / Order history。它是独立产品持仓；在确认它是否已被 Trading/Funding/Earn 聚合包含前，不与聚合估值并加。 | [Financial Product 目录](https://www.okx.com/docs-v5/en/)；[官方产品说明](https://www.okx.com/en-us/help/how-do-i-use-onchain-earn) |
| ETH/SOL staking、Stable Rewards、OKUSD Earn | **区域与端点可用性待核实** | 官方变更记录出现过相关只读能力，但不同注册区域的当前 V5 目录并不一致。实施前必须按实际区域主机逐端点确认权限、响应和产品包含关系。 | [Financial Product 目录](https://www.okx.com/docs-v5/en/)；[V5 change log](https://www.okx.com/docs-v5/log_en/) |
| 结构化产品（含 Dual Investment 等） | **未知；先只可聚合对账** | 已确认 Dual Investment 存在产品、报价、订单 API，但本研究未确认可安全汇总的余额/估值字段及与 Trading 的关系。可用聚合估值观察差额，不能据此写入持仓。 | [V5 change log](https://www.okx.com/docs-v5/log_en/) |
| 子账户 Trading / Funding | **有条件可接入** | 主账户 API 可读取子账户 Trading 与 Funding 余额；必须把每个子账户作为独立账户身份，避免与主账户或内部划转重复。 | [Sub-account API](https://www.okx.com/docs-v5/en/#sub-account-rest-api) |
| Pay / Pay 智能合约账户 | **需额外公开地址或 API** | 交易所 V5 无公开 Pay 余额/历史端点；Pay 是独立 Web3 smart wallet。以用户确认的公开地址调用 Onchain API，可读该地址链上资产；地址发现、归属证明与 Pay 全覆盖均不成立。 | [Pay account FAQ](https://www.okx.com/en-gb/help/pay-account-faq)；[Pay FAQ](https://www.okx.com/en-us/help/pay-faq)；[Wallet Check Balance](https://web3.okx.com/id/onchainos/dev-docs/wallet/balance-api-overview) |
| Pay 内 USDG 自动计息、Pay Card 等 | **当前公开 Exchange API 不可得** | Pay 官方说明 idle USDG 可自动计息、Card 直接连接 Pay；V5 资产估值的分区仅列 Trading/Funding/Earn/Classic，未列 Pay，不能以它推算 Pay。 | [Pay account FAQ](https://www.okx.com/en-gb/help/pay-account-faq)；[asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation) |
| 借贷、保证金、期货/永续、期权、Copy Trading、Jumpstart 等 | **明确排除（当前来源）** | 当前实现明确只接受 Spot mode、无借贷、无 Option；这些产品可能使 `eq` 含风险/负债/仓位口径，不能伪装为现货资产。未来需单独领域模型。 | [Account mode](https://www.okx.com/docs-v5/en/#overview-account-mode)；当前源码。 |

`GET /api/v5/asset/asset-valuation?ccy=USD` 返回 `details.trading`、`funding`、`earn` 等分区和 `totalBal`，适合用于**只可聚合对账**：不得把 `totalBal` 或任一分区加到上表明细总额上。官方未定义 `earn` 对 On-chain Earn、staking、结构化产品的完整包含矩阵时，差额应标为未知，而非自动归类或置零。[Get account asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation)

## 3. Pay 与 Onchain 的明确边界

### 3.1 Exchange API：当前公开不可得

**已证实**：Pay FAQ 说明 Pay 目前只能在 OKX App 使用；余额在 Pay flow 显示，流水在 Pay home 的 Recent activity / View all 查看。V5 API 总目录没有 Pay account/balance/payment-history 模块或端点。

因此结论是“**未查到官方公开 Exchange API**”，不是“技术上绝不可能存在内部接口”。不得抓取 App 私有接口、复用浏览器会话、要求用户提供 Pay passkey，或将 `/api/v5/account/balance`、`/asset/balances` 当作 Pay。

### 3.2 地址型只读接入：可行但不等价

**已证实**：OKX Wallet/Onchain API 的 Check Balance 可按任意钱包地址查询多链 token 余额、总资产价值或特定 token；接口使用 Onchain API 项目凭证/签名。按地址交易历史有时间保留与分页限制。

接入前提：

- 用户在 UI 明确输入/确认地址与链；本应用不能从 Exchange Key、UID、手机号或 Pay 账户推导地址。
- 用独立 Onchain API 凭证和独立来源记录；Exchange Key 永不复用为 Onchain Key。
- 仅标为“已确认地址的链上余额”，保留链、合约地址、区块/观测时间和估值来源；不标成“OKX Pay 全部余额”。
- 地址公开可读不等于自动获得数据处理授权或法律结论；实际接入需取得用户授权并遵守适用条款。

## 4. 权限、分页、模式与估值

### API Key 权限

- Exchange API Key 的 `Read` 可读取账户信息、账单、订单历史；`Trade` 包含下单、撤单、资金划转与写设置，`Withdraw` 可提现。[API key permissions](https://www.okx.com/docs-v5/en/#overview-api-key-creation)
- 当前 `validateOkxReadOnlyPermission()` 严格只接受 `read_only`，这一安全边界应保留；扩展读取端点也只允许精确的 GET allowlist。
- Onchain API 是另一套项目 API 签名边界；它的 read capability 不证明 Pay/Exchange 账户授权。

### 分页与快照完整性

- Trading balance、Funding balance、Flexible savings、asset valuation 都是当前余额读取，不应假设页码；不传 `ccy` 取全部非零币种，避免误将“最多 20 个 `ccy` 筛选值”当作总数上限。
- 账单、机器人订单/历史、Onchain 历史有 `after`/`before` 或 cursor/limit 语义。每个端点独立按官方游标向更早页推进、以稳定 ID 去重；空页、重复 cursor、页失败或达到安全上限时不宣称历史完整。
- 余额快照与聚合估值必须记录各自时间。不能把较早的 bot/Earn 页面与较晚的 account balance 当成严格相等。

### 账户模式与双算检查

1. 现有范围继续要求 `acctLv=1`、借贷开关关闭、Option positions 为空、各币种负债字段为零。否则 Trading 转入衍生品/借贷模型，不做现货总额。
2. 收集 Trading `eq/eqUsd/totalEq`、Funding `bal`、Flexible `amt` 与 optional asset valuation；同一层级只选一个入账字段。
3. 每个产品保存 `sourceAccount/product/order/address` 归属键；同币种在不同账户可并存，但同一归属键只计一次。
4. 对明细总额与 `asset-valuation` 分区做“差额”展示；绝不以 `totalBal` 补差。任何无法映射的金额明确显示“未覆盖/待对账”。

## 5. 推荐分阶段范围（不修改代码）

### 第一阶段：补齐已知 Trading 缺口

- 增加 `stgyEq` 采集和展示，先对真实 Read 回包逐币种验证 `eq`、`cashBal`、`stgyEq` 的关系。
- 以 `eq` 或经验证的互斥分量作为唯一 Trading 数量来源；增加 `totalEq`/`eqUsd` 对账、差额与失败态。
- 保持 Funding `bal`、Flexible `amt` 的既有独立分区；不修改账户模式、借贷、期权排除策略。

验收：给定账户 Trading 总额约 567.93 USD 时，KanBan 的 Trading 汇总应与同一时点 OKX Trading 总额可解释地对齐；不将 Pay 约 38.21 USD 混入 Trading。

### 第二阶段：产品明细与聚合核对

- 先接入已确认存在的 On-chain Earn 活动订单；ETH/SOL staking、Stable Rewards、OKUSD 需按当前注册区域逐端点复核后再决定。
- 每种产品先以唯一订单/产品键落明细，再与 `asset-valuation.details.earn` 对账；未验证包含关系前，聚合仅显示为对账值。
- 对 Fixed、结构化/Dual Investment 保持“当前不可得/未知”状态，除非新增官方明细和真实 Read 回包同时证实。

### 第三阶段：Pay/钱包观察来源

- 增加独立“OKX Wallet/Pay 已确认地址”来源，要求用户逐地址确认；读取链上余额和估值，单独标注覆盖链与不完整风险。
- 不保存 Pay passkey，不抓取 App，不能声称 Pay 全覆盖。若以后 OKX 发布 Exchange Pay 余额官方 Read API，再以其官方权限、字段、分页和地址/托管边界重新评审。

## 官方来源索引

- [OKX V5 API guide](https://www.okx.com/docs-v5/en/)
- [Get balance](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance)
- [Funding balance](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-balance)
- [Account asset valuation](https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-account-asset-valuation)
- [Simple Earn Flexible balance](https://www.okx.com/docs-v5/en/#financial-product-savings-get-saving-balance)
- [V5 change log — Fixed Loan / Simple Earn Fixed](https://www.okx.com/docs-v5/log_en/#2025-03-03)
- [OKX Pay account FAQ](https://www.okx.com/en-gb/help/pay-account-faq)
- [OKX Pay FAQ](https://www.okx.com/en-us/help/pay-faq)
- [OKX Onchain Wallet Check Balance API](https://web3.okx.com/id/onchainos/dev-docs/wallet/balance-api-overview)
- 当前仓库：[`src/server/asset-sources/okx.ts`](../../../../src/server/asset-sources/okx.ts)、[`src/domain/asset-source-providers.ts`](../../../../src/domain/asset-source-providers.ts)。
