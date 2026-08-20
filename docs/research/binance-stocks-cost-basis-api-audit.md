# Binance Stocks 成本价接口核对

检索日期：2026-08-20。范围为 Binance 官方开发者文档与当前仓库实现；未使用账户凭据发起请求。

## 结论

官方已提供 Binance Stocks 专用的成交与订单历史接口：

- `GET /sapi/v1/equity/trade/history`
- `GET /sapi/v1/equity/order/history`
- 需要 `USER_DATA`、API Key 和签名
- `order/history` 返回顶层 `page`、`rows`、`size`、`total`；每笔订单含 `side`、`filledQty`、`filledTotal`、`fee` 与 `updatedAt`

因此，`EQ_GLD` 的成本价**可以由官方订单历史重算**；它不是当前报价接口可以直接返回的字段，也不是应由现价倒推的数值。实现选择 `order/history`，以纳入官方返回的买入订单费用。

官方 Stocks 文档中未见直接返回“持仓平均成本价”或“累计持仓盈亏”的账户/持仓接口。`GET /sapi/v1/equity/account` 当前只返回用户协议状态，不提供持仓或成本字段。

当前实现已接入上述 Stocks 订单历史：完整同步读取 `GET /sapi/v1/equity/order/history` 并对数量严格守恒的持仓计算成本；行情刷新复用已保存成本，不重复读取私密订单历史。现货 `GET /api/v3/myTrades` 仍只用于 Spot，不能用于 Stocks。

## 当前实现核对

- Stocks 持仓来自 Funding 资产响应；`EQ_GLD` 使用对应 Stocks 订单历史计算成本。[src/server/asset-sources/binance.ts:330-359](../../src/server/asset-sources/binance.ts#L330-L359) [src/server/asset-sources/binance.ts:1260-1326](../../src/server/asset-sources/binance.ts#L1260-L1326)
- Stocks 客户端同时实现报价与签名订单历史请求。[src/server/asset-sources/binance.ts:1708-1726](../../src/server/asset-sources/binance.ts#L1708-L1726)
- Spot 成本计算只对 `account === "spot"` 且具有 `<asset>USDT` 交易对的资产调用 `GET /api/v3/myTrades`。[src/server/asset-sources/binance.ts:842-879](../../src/server/asset-sources/binance.ts#L842-L879) [src/server/asset-sources/binance.ts:1495-1500](../../src/server/asset-sources/binance.ts#L1495-L1500)

## 实施边界

1. 按分页完整读取 `GET /sapi/v1/equity/order/history`。
2. 对同一标的按订单时间、买卖方向和 `filledTotal` / 数量计算**当前剩余仓位的加权平均成本**；历史不足、数量无法守恒或存在非交易入库时保持为空。
3. 买入费用计入成本，来源标示为“Binance Stocks 订单成交计算（含费用）”；它仍不是平台原生平均成本。
4. 不调用现货 `myTrades` 查询 `GLD`，也不使用当前买一/卖一价格反推成本。

## 官方来源

- Binance Stocks API 变更日志（2026-07-20 公布交易历史等 Stocks 专用端点）：https://developers.binance.com/docs/zh-CN/binance-spot-api-docs/derivatives-stocks-trading/change-log
- Binance Stocks `Trade History`：https://developers.binance.com/docs/zh-CN/binance-spot-api-docs/derivatives-stocks-trading/trade/
- Binance Stocks `Order History`：https://developers.binance.com/docs/zh-CN/binance-spot-api-docs/derivatives-stocks-trading/order/
- Binance Stocks `Account`：https://developers.binance.com/docs/zh-CN/binance-spot-api-docs/derivatives-stocks-trading/account/
- Binance Stocks `Market Price`：https://developers.binance.com/docs/zh-CN/binance-spot-api-docs/derivatives-stocks-trading/market-data/
