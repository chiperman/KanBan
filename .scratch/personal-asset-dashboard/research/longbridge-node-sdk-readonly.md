# 长桥 OAuth 只读 REST 接入调研

- 调研日期：2026-07-26（Asia/Shanghai）
- 对应 Ticket：06 — 长桥首个资产来源闭环
- 调研范围：官方开发者文档、OAuth discovery、npm registry 与官方 `longbridge/openapi` Node 源码/类型声明。

## 最终决策

本项目**不接入长桥行情 SDK，也不使用 MCP**。Ticket 06 当前只需账户总额、股票持仓、基金持仓和平台已给出的字段；它不需要 30 秒实时证券报价。生产实现采用自控 OAuth 2.0 Authorization Code + PKCE、服务端加密 Token 存储，以及官方 Bearer REST `GET` 读取。

30 秒价格刷新对长桥来源是无网络的快照保持操作；5 分钟持仓刷新才访问长桥。这样避免了 SDK 默认 Token 文件，且不改变 Binance、OKX、Bitget 的 REST 适配器设计。

## 官方事实核对

### 1. 实时行情 Pull API 能否使用 OAuth Bearer HTTP？

**不能。** 官方 Quote Overview 将 Pull 行情列为私有协议的长连接访问，明确给出的接入方式只有私有协议/长连接或 SDK；行情请求和业务数据使用 Protobuf。官方 HTTP API Host 用于 REST 资产类接口，但 Quote Overview 未提供带 OAuth Bearer 的 HTTP Pull 行情端点。[Quote Overview](https://open.longbridge.com/docs/quote/overview) · [Quotes](https://open.longbridge.com/docs/quote/pull/quote)

因此不应构造未公开的 HTTP 行情代理，也不应以 MCP 代替 SDK。

### 2. 最新官方 Node SDK 是否能安全消费现有 OAuth Token？

2026-07-26 npm `latest` 为 `longbridge@4.4.1`，官方仓库当前 main 提交为 `bc33287274d69a4617ab7a78167625e44ad83eb2`。Node 类型与 N-API wrapper 只导出：

```ts
OAuth.build(clientId, onOpenUrl, callbackPort?)
```

没有公开的：

- 已有 OAuth access token 内存注入（如 `OAuth.fromToken`）；
- 自定义 Token Storage；
- 禁用或替换默认 Token 文件；
- 以应用的 refresh-token rotation 重建 `QuoteContext` 的接口。

底层 Rust core 有 `OAuth::from_token` 与 `OAuthBuilder::token_storage`，但没有导出到 Node binding。故 Node SDK 不能在不规避默认文件存储的前提下满足本项目的服务端加密 Token 边界。项目既不需要行情，直接移除 SDK 依赖而非保留变通桥接。[npm metadata](https://registry.npmjs.org/longbridge/latest) · [Node types](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/index.d.ts) · [Node OAuth wrapper](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/nodejs/src/oauth.rs) · [Rust OAuth builder](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/builder.rs)

### 3. 默认 SDK Token 文件是否加密、权限如何？

**未加密，且源码没有显式文件权限控制。** 官方 Rust 实现用 `serde_json::to_string_pretty` 后直接 `std::fs::write` 到 `~/.longbridge/openapi/tokens/<client_id>`；Token JSON 包含 `access_token`、可选 `refresh_token`、`expires_at` 和 `client_id`。它没有加密逻辑、`chmod` 或创建时显式 mode，因此最终权限由运行环境的默认 umask 决定，不能把它视为本项目认可的安全存储。[官方 Token 实现](https://github.com/longbridge/openapi/blob/bc33287274d69a4617ab7a78167625e44ad83eb2/rust/crates/oauth/src/token.rs) · [Getting Started](https://open.longbridge.com/zh-CN/docs/getting-started)

### 4. OAuth scope 及只读证明

官方 OAuth discovery 当前声明 scopes 为 `4`、`6`、`10`、`11`，支持 Authorization Code、Refresh Token 和 PKCE `S256`。本应用只请求并只接受精确的 `6`（账户/持仓读取）；交易写权限 `11`、任何未知 scope、缺失 scope 或附加 scope 均在访问资产端点和保存凭证前拒绝。刷新响应也重新验证 scope；缺失时只沿用已加密保存、已验证的精确 `6` 证明。[OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server)

### 5. 允许的生产 REST 端点

所有持仓同步请求均携带服务端 Bearer Token、`no-store`，且为 `GET`：

| 用途 | 端点 |
| --- | --- |
| 账户总额 | `/v1/asset/account` |
| 股票持仓 | `/v1/asset/stock` |
| 基金持仓 | `/v1/asset/fund` |
| 汇率 | `/v1/asset/exchange_rates` |
| 平台盈亏明细 | `/v1/portfolio/profit-analysis/by-market` |

前三项为 Ticket 06 的官方账户读取基础端点。[Account Assets](https://open.longbridge.com/docs/trade/asset/account) · [Stock Positions](https://open.longbridge.com/docs/trade/asset/stock) · [Fund Positions](https://open.longbridge.com/docs/trade/asset/fund)

生产代码不调用 `/v1/trade/*`，不导入下单、改单或撤单能力。Access Token 与 Refresh Token 仅保存在服务端加密安全存储中；浏览器、普通资产数据、HTML、日志和测试响应只获得脱敏的预览或连接状态。

## 验收边界

- 不使用真实长桥凭证的自动测试只用官方响应样本及受控传输替身。
- 账户/持仓 GET 失败时，系统的同步层保留最后一次成功快照并标记过期，不归零。
- 无实时行情调用时，30 秒价格周期不向长桥发起网络请求，也不会把持仓端点当作行情接口。
