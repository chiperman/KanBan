# BIT / Matrixport 持仓估值能力核对

检索日期：2026-08-04。

## 结论

BIT / Matrixport 的 Wallet 和 Balance+ 接口能返回币种与余额，但不返回 BTC/USD、BTC/USDT 市价或单项市值；不能仅依赖这些资产接口完成 BTC 估值。

BIT Trade 提供 `GET /trader/v2/api/rfq-price`，可对 `BTCUSDT` 请求一个短时有效的询价。它返回 `price_id`，文档明确该 ID 用于后续下单，且报价有倒计时，因此属于交易 RFQ，不应作为资产看板的通用持续参考行情。

看板不调用 RFQ 接口。BIT 适配器使用独立 `Prices` 查询 BTC/USD 与 USDT/USD；这不会扩大 BIT API Key 权限，也不会向 BIT 发起交易或报价请求。

## 官方接口观察

| 数据域 | 官方接口 | 能得到的估值数据 |
| --- | --- | --- |
| Wallet | `GET /mapi/v1/wallet/balance` | 仅 `currency`、`balance`、可用/冻结/待确认余额 |
| Balance+ | `GET /flexible/api/v2/app/homepage` | 币种余额、APY、利息；`total_balance_amount` 未标明计价货币 |
| Fixed Income | `GET /fixed-income/api/v3/user-asset/statistics_usd` | `total_asset`，明确为 USD 总资产 |
| DCP | `GET /dcp/api/v1/total-positions` | `total_position`，明确为 USD 总头寸 |
| Trade | `GET /trader/v2/api/rfq-price` | 指定交易对的短时 RFQ 报价，附带用于下单的 `price_id` |

## 建议

1. BTC、ETH 等现货余额使用独立、只读的参考价格服务；BTC 以 BTC/USD 或 BTC/USDT × USDT/USD 折算。
2. 不调用 RFQ 作为默认估值来源：它要求交易域的参数与权限边界，且价格是短时、可执行的询价。
3. 保留 Fixed Income 与 DCP 的官方 USD 聚合值，不将订单本金或逐币余额重复相加。
4. 报价服务失败时记录明确原因（缺少密钥、HTTP 状态、超时或响应字段异常），而不是一律显示“暂无可靠价格”。

## 官方来源

- Wallet API: https://www.bit.com/docs/en-us/wallet.html
- Balance+ API: https://www.bit.com/docs/en-us/balanceplus.html
- Fixed Income API: https://www.bit.com/docs/en-us/fixed_income.html
- DCP API: https://www.bit.com/docs/en-us/dcp.html
- Trade API: https://www.bit.com/docs/en-us/trade.html
