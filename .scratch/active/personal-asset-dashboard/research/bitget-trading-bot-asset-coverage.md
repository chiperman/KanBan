# Bitget Classic 合约交易机器人资产覆盖调研

调研日期：2026-07-30
范围：只使用 Bitget 官方 API 文档及 Bitget 官方支持公告；未调用真实账户、未修改业务代码。

## 结论

可以把 Classic Account 中的**合约交易机器人账户**纳入个人资产看板，推荐只增加一个私有只读请求：

```text
GET /api/v2/account/bot-assets?accountType=futures
```

它是 Bitget 的机器人账户专用端点；`accountType=futures` 将范围限定为 futures bot，响应按币种给出 `equity`（官方描述为 account assets）和 `usdtValue`（官方描述为 USDT values）。因此：

- 机器人账户的 **USDT 币种净权益**：取 `coin == "USDT"` 行的 `equity`；
- 计入总资产的 **Bitget 原生 USDT 估值**：对该响应每一币种的 `usdtValue` 做高精度十进制求和（若产品要求只显示 USDT 机器人权益，则只取 USDT 行）；
- 不读取任何订单、持仓或成交明细。该端点已经是账户级聚合值，但不提供单个机器人、负债或未实现盈亏的拆分。

不要以 `available + frozen` 代替 `equity`，也不要手动加减 `bonus`：官方仅分别定义了这些字段，未给出机器人账户的权益组成公式。`usdtValue` 应作为总额口径，`equity` 作为原币种权益展示口径。

来源：[策略账户（官方 API）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)。

## 1. 可用只读接口与字段

| 目的 | 接口 | 请求与限速 | 可安全采用的字段 | 结论 |
| --- | --- | --- | --- | --- |
| 读取合约机器人账户资产 | `GET /api/v2/account/bot-assets` | 显式传 `accountType=futures`；5 次/秒/UID；私有签名请求 | `coin`、`equity`、`usdtValue` | **唯一应计入本需求总额的读取接口**。响应是列表，无 `cursor`、`limit` 或分页字段。 |
| 可选的覆盖一致性哨兵 | `GET /api/v2/account/all-account-balance` | 1 次/秒/UID；私有签名请求 | `accountType=bots` 的 `usdtBalance` | 只用于发现直接机器人读取与账户概览矛盾，绝不直接计入总额。它将 `spot`、`futures`、`funding`、`earn`、`bots`、`margin` 分开列出，但不允许筛成“仅 futures bot”。 |
| 现有 Classic 资产读取 | Spot、Funding、Savings 各自端点 | 既有实现 | 各自账户资产 | 保持现有逻辑；不要用普通 futures/mix 端点补机器人金额。 |

`bot-assets` 的参数 `accountType` 虽为可选，文档只枚举 `futures` 与 `spot`。实现必须始终显式传 `futures`，不能省略参数后猜测默认范围，也不能读取 `spot` bot 并把它误当作本 Ticket 的合约机器人。

官方 API 说明私有接口须签名，并由服务端按 API Key 信息校验；机器人端点的官方请求示例也是带 `ACCESS-KEY`、`ACCESS-SIGN`、`ACCESS-PASSPHRASE` 与 `ACCESS-TIMESTAMP` 的 `GET`。保持现有 Bitget HMAC 签名实现即可，不需要写接口。

来源：

- [策略账户（接口、`futures`/`spot` 参数、字段、限速）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)
- [资产概览（`bots` 为独立账户类型；聚合余额的限速与字段）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/All-Account-Balance)
- [Classic REST Quick Start（私有请求签名、接口限速规则）](https://www.bitget.com/api-doc/classic/quickStart/intro)

## 2. 权限：最小只读 Key

API Key 只需 Bitget 所称的 **Read-Only permission**；官方将它定义为查询数据的读取权限。不得同时授予：

- `Trade`（下单/撤单）；
- `Transfer`（账户间划转）；
- `Withdraw`（提现）。

本次读取不需要为“核验没有挂单”而申请或调用交易权限：直接账户聚合端点已给出权益与 USDT 估值。现有 Classic `GET /api/v2/spot/account/info` 的 `authorities` 继续作为连接与每次同步前的机器校验；其现有 fail-closed 原则不变——出现写权限、未知 authority、缺少 `authorities` 或权限漂移即拒绝本次新快照。

官方没有在 `bot-assets` 页面声明额外的 futures-order/position scope，也没有要求 `Trade`。故不能为了读取机器人价值而扩大 Key 权限；若一个纯 Read-Only Key 返回权限不足，应将该响应作为连接/刷新失败并要求所有者在 Bitget 创建可读取账户数据的只读 Key，而不是启用 Trade。

建议仍绑定 IP，并把 Key、SecretKey、Passphrase 视为敏感凭证；这与既有只读凭证模型一致。

来源：[Classic REST Quick Start（Read-Only/Trade/Transfer/Withdraw 的能力定义、IP 建议、敏感凭证提醒）](https://www.bitget.com/api-doc/classic/quickStart/intro)。

## 3. 去重规则

当前个人资产看板的 Bitget Classic 范围是 Spot、Funding、Savings/Earn，且明确排除了普通合约、杠杆、借贷。新增内容应成为一个独立的来源账户分区，例如 `bot-futures`；不要把它伪装成 Spot 持仓。

```text
Bitget Classic source total
= Spot（既有）
+ Funding（既有）
+ Savings/Earn（既有）
+ Bot futures（本次：bot-assets?accountType=futures 的 sum(usdtValue)）

不计：普通 futures、margin、loan、spot bot、copy trading
```

具体约束：

1. **只读机器人专用端点并传 `futures`。** `bot-assets` 与 Assets overview 中的 `bots` 是独立账户类别；不能用普通 `futures` 余额、普通 futures 持仓或 `mix` 账户权益来替代或叠加它。
2. **绝不把 Assets overview 的 `bots.usdtBalance` 再加入总额。** 它可能覆盖 spot 与 futures 两类机器人，而本需求只接 futures bot；它只能用于一致性告警。直接端点与 overview 不相等时，不可静默选择较大的数。
3. **不调用 `accountType=spot`。** 即使未来要覆盖现货机器人，也必须另立范围、核验它与 Spot 账户端点的资金归属，再决定是否加入。
4. **不把 `equity` 当作普通持仓数量。** 一个 futures bot 的权益可随未实现盈亏、保证金占用、冻结金额变化；总额使用该账户的 `usdtValue`，而不是把它与现货 USDT 币数合并后再次估值。

Bitget 的官方产品说明也说明机器人启动时资金会由主账户转入机器人子账户，机器人结束后剩余资金再转回主账户；这解释了为什么同步瞬间应读取专用机器人账户，而不能假设它仍在主 Spot/Funding 余额中。该公告同时称页面的主账户总资产会包含运行中子账户，故不能拿网页“总资产”再与 API 分区之和相加。

来源：

- [策略账户（机器人专用资产端点及类型过滤）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)
- [资产概览（独立 `bots`、`futures`、`spot`、`funding`、`earn` 条目）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/All-Account-Balance)
- [Introduction to bot trading sub-accounts（资金转入/转回与页面总资产包含子账户）](https://www.bitget.com/asia/support/articles/12560603786834)

## 4. 是否可不读订单而读取聚合净权益

**可以。** `bot-assets?accountType=futures` 是单次私有 `GET`，返回每个币种的 `equity` 和 `usdtValue`；其请求参数和响应都没有订单 ID、策略 ID、持仓、成交、分页游标或订单状态。为“计入总资产”目的，不应额外读取订单或普通合约仓位。

不过，API 没有把“net equity”定义为可分解公式：

- `equity` 的官方说明仅为“account assets”；
- `usdtValue` 的官方说明仅为“USDT values”；
- `bonus`、`available` 与 `frozen` 单独返回；
- 不返回 `debt`、`unrealizedPnl`、保证金、单机器人 ID 或单机器人持仓。

因此可获得 **Bitget 已聚合的账户权益/USDT 估值**，但无法只凭此端点制作“负债”“未实现盈亏”“赠金”分项，亦不可重算它们。若产品将“净权益”严格定义为“资产减负债且单独展示负债”，官方公开的机器人账户接口不足，应保留为一个待 Bitget 补充 API 或人工 UI 对账的缺口；不能改读订单后自行推导。

常规 UTA 账户的官方术语证明了为什么不应把普通合约账户公式套到机器人端点：UTA 的 Coin equity 会包括 balance、冻结保证金与未实现盈亏，且 debt 与 account equity 有单独定义；机器人端点并没有声明同一公式。此处只能忠实采用它返回的聚合值。

来源：

- [策略账户（字段集合）](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)
- [Unified Trading Account introduction（普通统一账户的 equity、unrealised PnL、debt、account equity 定义；仅用于说明不可外推）](https://www.bitget.com/api-doc/uta/intro)

## 5. 分页、数值与失败语义

### 5.1 分页和速率

- `bot-assets` 文档未定义分页参数或响应 cursor；按一次完整列表处理，不要发明翻页。
- 限速为 **5 次/秒/UID**。既有刷新串行/退避机制应保留。
- 若使用可选 overview 对账，其限速只有 **1 次/秒/UID**，不得与高频刷新并发调用。

来源：[策略账户](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)、[资产概览](https://www.bitget.com/zh-CN/api-doc/classic/common/account/All-Account-Balance)。

### 5.2 数值处理

- `equity`、`usdtValue` 按 decimal string 解析，不能先转 JavaScript `number`。
- 计入总额前要求每行 `coin` 非空，`usdtValue` 为可解析的有限十进制；展示原币权益时要求 `equity` 可解析。
- 2026-07-30 的真实只读响应显示，未使用的 `frozen` 可能为空字符串；`available`、`bonus`、`frozen` 不参与展示或总额，不应因其空值阻断完整资产读取。
- 不假设 `equity`、`usdtValue` 一定非负，也不以零替换缺失、空串、NaN 或溢出值；官方字段说明没有提供非负约束或组成公式。

### 5.3 成功、空结果和失败

1. 只有 HTTP 成功且 Bitget envelope `code == "00000"`、`data` 为数组且每项 schema 合法，才可候选新快照。Bitget Quick Start 明确说明超频返回 HTTP `429`；官方 REST 错误码将 `40014` 标为权限不正确、`40015` 标为可稍后重试的系统异常、`40018` 标为无效 IP。
2. `data=[]` 的“无运行机器人/零余额”语义没有被端点文档明说。首次接入应以一个确认没有 futures bot 的真实只读 Key 做人工验收；在此之前不要把空列表当作已证明的零余额。
3. 对已接入来源，若本次是成功空列表且 overview 也明确给出 `bots.usdtBalance == 0`，可提交零机器人分区；若 overview 为正或缺少 `bots`，视为不一致而失败，避免把真实机器人权益归零。
4. 非 `00000`、认证/权限/IP 错误、429/5xx 耗尽重试、超时、schema 错误、范围不一致或可选一致性检查不一致：**整次 Bitget 刷新失败，不提交部分新快照**。依照本项目“过期数据”定义，保留最后一次成功快照并标记过期；首次连接则不保存凭证引用、来源或快照。

第 2、3 点是为了避免静默漏算的保守实现建议；官方只定义了成功 envelope、端点字段与列表形态，未承诺空数组或 overview 对账恒等式。

来源：[Classic REST Quick Start（私有 API、频率限制及 429）](https://www.bitget.com/api-doc/classic/quickStart/intro)、[策略账户](https://www.bitget.com/zh-CN/api-doc/classic/common/account/Bot-Assets)、[资产概览](https://www.bitget.com/zh-CN/api-doc/classic/common/account/All-Account-Balance)、[官方 REST 错误码](https://www.bitget.com/zh-CN/api-doc/classic/broker/error-code/restapi)。

## 6. 建议的验收样本（不涉及下单）

使用一个新建、IP 绑定、仅 Read-Only 的 Classic API Key，且全程只发送 `GET`：

1. 在 Bitget UI 创建/运行一个 USDT futures bot，记录 UI 的机器人账户 USDT 权益与时间；不读取订单。
2. 调用 `bot-assets?accountType=futures`，验证 USDT 行 `equity` 与 `usdtValue` 的展示/总额口径，并保存经脱敏的响应结构。
3. 同一时点读取现有 Spot、Funding、Savings；确认它们没有重复增加机器人资金。
4. 可选读取 Assets overview：确认其 `bots` 是独立分类；仅作诊断，不参与计算。
5. 停止机器人，等待资金回转后再同步：机器人分区应归零，资金只在回转后的目标 Classic 账户出现一次。
6. 覆盖 429、权限不足、IP 白名单不匹配、`code != 00000` 与空数组/overview 不一致，验证不产生部分或归零快照。

该验收仅证明只读数据口径；不发送创建、停止、下单、撤单、划转或提现请求。
