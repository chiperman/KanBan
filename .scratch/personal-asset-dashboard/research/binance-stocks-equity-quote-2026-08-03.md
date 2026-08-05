# Binance Stocks（`EQ_*`）接入调研

- 调研日期：2026-08-03（Asia/Shanghai）
- 结论状态：已用于实现；等待持有账户的一次真实刷新验收

## 结论

`EQ_GLD` 是 **Binance 资产**。持仓继续由同一 Binance 只读 API Key 的 Funding 账户读取；不能把它迁到 Longbridge，也不需要新增行情服务或凭证。

此前实现只查询了 Spot Market Data：把所有资产拼为 `<asset>USDT`，所以对 `EQ_GLD` 查询了不存在的 `EQ_GLDUSDT`，才显示“没有可靠的现货价格”。这是接口分类错误，不是 Binance 没有该资产数据。

Binance 已发布独立的 Stocks Trading API，和 Spot API 并列：

1. `EQ_*` 是 Stocks 用户数据流的资产代码：官方订阅说明要求去掉 `EQ_` 前缀后，使用证券代码与其他 Stocks 接口匹配。因此 `EQ_GLD → GLD`。
2. `GET /sapi/v1/equity/market/quote?symbol=GLD`
   - API Key 鉴权，无签名。
   - 返回标的的最佳买价 `bidPrice` 与卖价 `askPrice`。

因此正确的统一链路是：

```text
Binance Funding 余额 EQ_GLD
  → 去掉 EQ_ 前缀得到 GLD
  → Binance Stocks quote(GLD)
  → USD 估值，并在看板归类为“证券”
```

## 已实现规则

- `EQ_*` 资产直接按官方规则去掉前缀取得证券代码；`EQ_GLD` 不再拼 Spot 交易对，也不依赖另一类 `*B` tokenized-assets 产品列表。
- `EQ_GLD` 保留为 Binance 内部资产标识；显示分类为 `securities`，计价货币为 USD。
- 单位价格为 `(bidPrice + askPrice) / 2`；持仓市值为数量乘该 USD 单位价格。
- 无法解析资产代码、缺报价或非法报价时保留持仓数量、标为未估值，绝不按零计入总资产。
- 30 秒价格刷新只读取 Spot 公共价与必要的 Stocks 市场数据；5 分钟余额刷新继续使用原有签名的 Binance 只读账户接口。没有新增写权限、转账或交易调用。

## 验收范围

自动回归验证了：

1. `EQ_GLD → GLD` 只走 Stocks 的 `quote`，不请求 `EQ_GLDUSDT`。
2. 行情使用同一 Binance API Key、没有签名/timestamp，且没有调用写端点。
3. 结果的 `assetClass` 是 `securities`、计价为 USD，代码或报价无效时正确降级为未估值。
4. 原有 Spot/Funding/Earn 加密资产读取与估值路径保持不变。

仍需用所有者已有的 Binance 连接做一次真实刷新，确认 API Key 获得 Stocks 市场数据访问并让真实 `EQ_GLD` 快照写入本地 SQLite。

## 一手来源

- [Binance Stocks Trading API](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data)
- [Get Tokenized Asset Quote](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data/tokenized-asset-quote)
- [Binance Stocks User Data Stream](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/websocket/user-data-stream)
- [Binance Spot Market Data API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
