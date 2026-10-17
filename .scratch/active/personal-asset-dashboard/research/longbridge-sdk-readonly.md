# Longbridge SDK 只读接入调研（已被最终决策替代）

- 调研日期：2026-07-26（Asia/Shanghai）
- 状态：历史调研记录；最终实现决策见 `longbridge-node-sdk-readonly.md`

## 最终结论

此前“账户/持仓 REST + MCP 或 SDK 行情”的候选方案已废弃。Personal Asset Dashboard 当前只查看长桥账户总额、股票持仓和基金持仓，不需要证券行情，因此不接入 MCP、`longbridge` Node SDK、`QuoteContext` 或 WebSocket。

生产实现采用：

1. 服务端自控 OAuth 2.0 Authorization Code + PKCE。
2. 只请求并接受精确 `scope=6`；拒绝 `scope=11`、缺失、未知或任何附加 scope。
3. Access Token 与 Refresh Token 只进入现有服务端加密凭证存储，不写 SDK 默认明文 Token 文件，不返回浏览器。
4. 只允许三个官方 Bearer REST GET：
   - `/v1/asset/account`
   - `/v1/asset/stock`
   - `/v1/asset/fund`
5. 不导入或调用任何下单、改单、撤单接口，也不调用汇率、Portfolio P&L 或行情端点。

账户总额采用 `Account Assets.net_assets`。股票持仓响应没有可靠价格时只保留代码、数量、币种与成本并标记未估值；基金可使用响应自带净值字段。系统不补造持仓市值、涨跌或平台盈亏。

## 为什么不使用最新版 Node SDK

调研时 npm `latest` 为 `longbridge@4.4.1`。它的 Node binding 只公开 `OAuth.build(...)`，没有公开已有 OAuth Token 的内存注入、自定义 Token Storage 或禁用默认 Token 文件的接口；默认实现会把 Token JSON 写入 `~/.longbridge/openapi/tokens/<client_id>`，不满足项目现有的加密凭证边界。既然本 Ticket 不需要行情，直接使用三个官方 REST GET 比引入 SDK 更小、更安全。

官方证据：

- [OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server)
- [Node types](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/index.d.ts)
- [Node OAuth wrapper](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/src/oauth.rs)
- [官方 Token 实现](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/token.rs)
- [Account Assets](https://open.longbridge.com/docs/trade/asset/account)
- [Stock Positions](https://open.longbridge.com/docs/trade/asset/stock)
- [Fund Positions](https://open.longbridge.com/docs/trade/asset/fund)

## 刷新与验收边界

- 30 秒统一价格周期对长桥是严格无网络 no-op，包括不刷新 Token。
- 5 分钟持仓周期才执行三个 allowlisted GET。
- 任一读取失败时保留最后一次成功快照并标记过期，不归零。
- 浏览器级测试必须证明精确 endpoint allowlist、无订单调用、无 Token 泄露，以及授权、刷新和失败保留语义。
