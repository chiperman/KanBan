# 长桥 Node.js SDK 只读接入专项调研

- 调研日期：2026-07-26（Asia/Shanghai）
- 对应 Ticket：06 — 长桥首个资产来源闭环
- 调研边界：仅官方开发者站、官方 OAuth 服务、官方 npm 包与官方 GitHub 仓库；未调用真实账户，未修改产品代码。

## 结论

“只查看持仓、不下单”在长桥能力和权限层面完全可行：OAuth `scope=6` 当前是 **Account & Positions**，对应账户、股票持仓、基金持仓等只读 GET；`scope=11` 才是 **Trade Execution**，包含下单、改单和撤单。应用继续只申请并验证精确的 `scope=6`，同时保留服务器端 GET allowlist，即可形成双重只读边界。[OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server) · [官方授权页](https://open.longbridge.com/connect)

但官方 Node SDK `longbridge@4.4.1` 目前不能无缝替换现有 MCP 行情适配器：公开 Node API 只能通过 `OAuth.build(clientId, onOpenUrl, callbackPort?)` 创建 OAuth 对象，默认把 token 写入 `~/.longbridge/openapi/tokens/<client_id>`；它没有公开“从现有 Bearer access token 构造 OAuth”的方法，也没有把自定义 token storage 暴露给 JavaScript。因此，若坚持“现有 OAuth/refresh token 继续进加密 SecretStore，SDK 调用时仅在服务端内存短暂解密”，当前官方 Node 包还缺一个公开 token 注入入口。[Node OAuth wrapper](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/src/oauth.rs) · [OAuth storage](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/storage.rs)

本项目最终没有改用 SDK 自带授权，也没有 fork SDK。实施采用 POSIX 匿名管道桥接：专用 Node 子进程把 SDK 固定的 token cache 路径创建为指向 `/dev/fd/3` 的符号链接，应用从现有加密 SecretStore 解密 access token 后只向该匿名管道写入一次；`OAuth.build` 从管道加载到内存，随后由官方 `Config.fromOAuth` 与 `QuoteContext.quote` 读取行情。临时目录中只有符号链接，不存在 token 正文；SDK refresh 被禁用，刷新和 scope 校验仍由应用控制。该方案在不 fork 官方包、不产生明文 token 文件的前提下移除了 MCP，但当前仅支持 macOS/Linux。

## 1. 官方 Node.js SDK、版本、运行时与行情 API

### 包与版本

- 官方包名是 `longbridge`；官方 SDK 页面给出的安装命令为 `npm install longbridge --save`。旧包名 `longport` 已弃用。[官方 SDK 页面](https://open.longbridge.com/sdk)
- 2026-07-26 查询 npm 官方 registry，`latest` 为 **4.4.1**；包对应官方仓库 `longbridge/openapi`，npm `gitHead` 为 `e6238609d9268021249ee0a9cc1379e598e57346`。[npm latest metadata](https://registry.npmjs.org/longbridge/latest) · [官方仓库](https://github.com/longbridge/openapi/tree/e6238609d9268021249ee0a9cc1379e598e57346/nodejs)
- 官方变更日志截至 2026-07-20 仍以 “SDK v4.4.0” 为发布标题；实现时应以 npm registry 的 `4.4.1` 精确锁定，不使用浮动范围。[官方 changelog](https://open.longbridge.com/docs/changelog)

### 运行时和部署

- 包元数据声明 `engines.node >= 10`，它是 N-API 原生扩展，不是纯 JavaScript。[官方 package.json](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/package.json)
- 官方预编译目标覆盖 Windows x64、Linux x64 glibc/musl、Linux arm64 glibc、macOS x64/arm64；部署环境必须安装成功对应 optional native package。[官方 package.json](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/package.json)
- 本项目当前 Next.js 运行时边界高于 SDK 自身最低值；实现时应继续以项目现有 Node/Next 约束为准，不能因为 SDK 写着 Node 10 就下调应用运行时。

### `QuoteContext` 的准确用法

```ts
import { Config, OAuth, QuoteContext } from "longbridge";

const oauth = await OAuth.build(clientId, (_error, url) => {
  // 官方流程要求打开 url；此流程会使用 SDK 的磁盘 token cache。
});
const config = Config.fromOAuth(oauth);
const context = QuoteContext.new(config);
const quotes = await context.quote(["AAPL.US", "700.HK"]);
```

官方 Node API 是：

- `OAuth.build(clientId, onOpenUrl, callbackPort?) -> Promise<OAuth>`
- `Config.fromOAuth(oauth, extra?) -> Config`
- `QuoteContext.new(config) -> QuoteContext`
- `QuoteContext#quote(symbols: string[]) -> Promise<SecurityQuote[]>`

`SecurityQuote` 对 Ticket 06 有用的字段为 `symbol`、`lastDone`、`prevClose`、`timestamp`；`lastDone`/`prevClose` 是 SDK `Decimal`，映射时应保留字符串精度，不先转 JavaScript `number`。[官方 Node 快速开始](https://longbridge.github.io/openapi/nodejs/index.html) · [官方 Quotes 文档](https://open.longbridge.com/docs/quote/pull/quote) · [4.4.1 类型定义](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/index.d.ts)

证券代码继续使用 `ticker.region`，例如 `AAPL.US`、`700.HK`；单次 `quote` 最多 500 个 symbol。[官方 Quotes 文档](https://open.longbridge.com/docs/quote/pull/quote)

## 2. Token 注入、仅内存和 SecretStore 兼容性

### 公开 Node API 的现状

官方 Node 4.4.1 提供两种配置入口：

1. `Config.fromApikey(appKey, appSecret, accessToken, extra?)`：旧版 API Key/HMAC 鉴权；参数可直接从服务端内存传入。
2. `OAuth.build(...)` + `Config.fromOAuth(...)`：推荐的 OAuth Bearer 鉴权；SDK 自动刷新并默认持久化 token。

这两种 token 不是可互换的鉴权模式，不能把 OAuth Bearer access token 塞进 `Config.fromApikey` 并伪造 app key/secret。[官方 Getting Started](https://open.longbridge.com/docs/getting-started) · [Node Config 源码](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/src/config.rs)

`OAuth.build` 的默认路径是 `~/.longbridge/openapi/tokens/<client_id>`（Windows 为用户目录下同一路径），会读取、刷新并重新写入 access/refresh token。[官方 Getting Started](https://open.longbridge.com/docs/getting-started) · [OAuth builder](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/builder.rs) · [Token file implementation](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/token.rs)

公开 Node 类型和 N-API wrapper 目前只有 `OAuth.build`，没有：

- `OAuth.fromToken(accessToken)`；
- access token getter；
- refresh token getter/setter；
- 自定义 `TokenStorage` 回调。

[Node OAuth wrapper](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/src/oauth.rs) · [4.4.1 类型定义](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/index.d.ts)

底层官方 Rust core 已有 `OAuth::from_token(access_token)`，且注释明确用于服务端已有外部 token 的场景；该对象不负责 refresh。Rust builder 也支持自定义 `TokenStorage`。缺口只在这些能力没有导出到 Node wrapper。[Rust `OAuth::from_token`](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/client.rs) · [Rust custom storage](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/builder.rs)

### 与现有 SecretStore 的推荐兼容模型

理想且最小的模型是：

1. 保留当前应用自己的 OAuth Authorization Code + PKCE、`POST /oauth2/token` refresh 和 refresh-token rotation。
2. access/refresh token 继续只保存在现有加密 SecretStore；同步开始时在服务端内存解密。
3. 将 access token 注入一个无持久化能力的 SDK OAuth handle，创建 `Config`/`QuoteContext`，完成 quote 后释放引用。
4. SDK 不负责 refresh；应用沿用当前 refresh 流程，成功轮换后原子更新 SecretStore。[官方 OAuth refresh 文档](https://open.longbridge.com/docs/api?page=overview)

第 3 步在底层 Rust 已可实现，但官方 Node 4.4.1 尚未公开。本项目用匿名文件描述符满足同一边界：只复用官方 TokenStorage 的读取入口，不解析 SDK 内部对象、不伪造鉴权模式，也不把 SecretStore 内容临时落盘。若上游将来公开 `OAuth.fromToken` 或自定义 storage，应直接删除该桥接进程。

另一个安全问题是：Node `OAuth.build` 不接受显式 scopes 参数；当前 core 授权 URL 添加的是空 scope，最终由服务端/授权页决定可选范围。它也不向调用方公开最终 token scope，因此不能替代现有代码对 `scope === "6"` 的强校验。[Node OAuth wrapper](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/src/oauth.rs) · [OAuth authorize source](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/rust/crates/oauth/src/client.rs)

## 3. 应保留的账户/持仓 REST GET

保持现有 OAuth Bearer REST client，并将核心账户读取限制为以下三个官方 GET：

| 用途 | Method | Path | 官方证据 |
|---|---|---|---|
| 账户资产/现金 | `GET` | `/v1/asset/account` | [Account Assets](https://open.longbridge.com/docs/trade/asset/account) |
| 股票/ETF/期权持仓 | `GET` | `/v1/asset/stock` | [Stock Positions](https://open.longbridge.com/docs/trade/asset/stock) |
| 基金持仓 | `GET` | `/v1/asset/fund` | [Fund Positions](https://open.longbridge.com/docs/trade/asset/fund) |

这些页面虽然把对应 SDK 方法放在 `TradeContext` 下，但 HTTP 方法均为 GET；“类名是 TradeContext”不等于“调用会下单”。不过本应用已存在准确的 Bearer REST GET 实现，没有必要为了三项读取引入 `TradeContext`，这样可以把 SDK 依赖边界缩到 `QuoteContext`。

现有 `/v1/asset/exchange_rates` 和 `/v1/portfolio/profit-analysis/by-market` 属于估值/平台盈亏的辅助读取，不是本问题要求的三项核心账户/持仓端点。若 Ticket 06 字段映射仍依赖它们，可以继续放在独立的 GET allowlist；不要扩展到 `/v1/trade/**`。

## 4. `scope=6` 与 `scope=11` 的当前含义

官方 OAuth discovery 当前声明支持 `4`、`6`、`10`、`11`。[OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server)

2026-07-26 从官方授权页所使用的一方 scope catalog 读取到：

- `6`：**Account & Positions / 账户资产与资金明细查询**，说明为读取基金持仓、股票持仓、账户现金/资金、资金流水；catalog 中相关接口全部是 GET，其中包括 `/asset/account`、`/asset/stock`、`/asset/fund`。
- `11`：**Trade Execution / 交易下单**，说明为买卖及其他交易执行；catalog 包含 `POST /trade/order`、`PUT /trade/order`、`DELETE /trade/order`，以及会改变定投计划的 POST。

可复核的官方只读请求（官方前端把 OpenAPI 路径转发至该一方接口）：

```bash
curl -fsSL \
  -H 'x-platform: Web' \
  -H 'x-bridge-token: none' \
  -H 'x-original-app-id: longbridge' \
  -H 'x-app-id: longbridge' \
  -H 'x-saas-host:' \
  -H 'accept-language: en' \
  'https://m-gl.lbkrs.com/api/forward/v1/mcp/scopes'
```

[官方授权页](https://open.longbridge.com/connect) · [官方 scope catalog](https://m-gl.lbkrs.com/api/forward/v1/mcp/scopes)

因此，现有策略“只接受精确 `6`；出现 `11` 立即拒绝”有当前官方证据支持。要注意 `6` 是一个较宽的账户读取组，还包括现金流、结单、盈亏分析等 GET；OAuth scope 负责排除写权限，应用自身 GET allowlist 负责进一步缩到 Ticket 需要的端点。

行情并不需要 `11`。官方授权页将行情、报价、基本面归为每次授权默认包含的基础数据能力；官方 Quote 文档也将行情权限与交易权限分开。[官方授权页](https://open.longbridge.com/connect) · [Quotes](https://open.longbridge.com/docs/quote/pull/quote)

## 5. SDK 的下单能力，以及如何证明应用不调用它

SDK 包本身确实包含下单能力：`TradeContext#submitOrder`、`replaceOrder`、`cancelOrder`；官方快速开始直接展示了 `submitOrder` 示例。[官方 Node API](https://longbridge.github.io/openapi/nodejs/index.html) · [Submit Order](https://open.longbridge.com/docs/trade/order/submit) · [TradeContext 类型](https://github.com/longbridge/openapi/blob/e6238609d9268021249ee0a9cc1379e598e57346/nodejs/index.d.ts)

不能用“依赖里没有下单代码”证明只读，因为同一个 `longbridge` 包同时发布 QuoteContext 和 TradeContext。应使用四层边界：

1. **权限边界**：OAuth 只请求并验证精确 `scope=6`，拒绝 `11`。
2. **代码边界**：建立 server-only `LongbridgeQuoteClient`，接口只暴露 `quote(symbols)`；生产适配器只导入 `Config`、`OAuth`、`QuoteContext`，禁止导入/引用 `TradeContext`、`submitOrder`、`replaceOrder`、`cancelOrder`。
3. **HTTP 边界**：账户 REST client 只允许明确的 GET 路径；任何非 GET 或 `/v1/trade/` 立即抛错。
4. **最高层浏览器测试边界**：浏览器走完整“授权预览 → 确认 → 首次同步/刷新 → 查看详情”流程；服务器测试替身记录真实生产端口的 SDK 方法名与 REST method/path，最终断言：
   - SDK 记录只有 `QuoteContext.quote`；
   - REST 记录只有允许的 GET；
   - `orderCalls` 始终为 0；
   - 出现任意 `/v1/trade/**`、POST/PUT/DELETE（OAuth token endpoint 除外）即使测试失败；
   - 浏览器响应和页面文本中没有 access/refresh token。

Playwright 仅拦截浏览器网络不能观察 Next.js 服务器内部的 SDK/WebSocket 流量，因此测试替身必须放在服务器生产端口/依赖注入边界，浏览器测试只负责从最高层触发并读取无秘密的调用摘要。再增加一条静态测试或 lint 规则，扫描产品代码禁止上述 TradeContext/订单标识符，防止后续回归。

## 6. 移除 MCP 的迁移建议与风险

### 推荐顺序

1. 保留现有 `ProductionLongbridgeOAuth`、refresh rotation、SecretStore 和三个资产 GET。
2. 新建最小 server-only quote port，业务层只依赖 `quote(symbols)`。
3. 用专用 Node 子进程和 `/dev/fd/3` 匿名管道向官方 `OAuth.build` 注入已校验 access token；临时目录只允许出现指向匿名 fd 的符号链接。
4. 通过 `QuoteContext.new(config).quote(symbols)` 读取行情，保持业务返回模型不变；子进程不导入 `TradeContext`。
5. 浏览器级验证 native package、只读调用摘要、Token 不泄露和失败恢复后，删除 MCP transport/tool-call 代码与依赖。
6. 执行依赖树、源码字符串和 lockfile 检查；上游提供 `OAuth.fromToken` 后优先替换匿名管道桥。

### 主要风险

- **OAuth/SecretStore 不兼容（高）**：官方 Node 4.4.1 默认磁盘 cache，不能直接消费现有 SecretStore token。
- **匿名管道平台限制（中）**：当前 `/dev/fd` 桥只支持 macOS/Linux；Windows 必须等待上游 `OAuth.fromToken`，不能回退到明文 cache。
- **scope 证明退化（高）**：SDK 自带 OAuth 不暴露显式 scope 选择或最终 scope 校验；直接替换会削弱现有精确 `6` 验证。
- **原生依赖部署（中）**：需要对应平台 optional binary；CI、生产镜像使用 `--omit=optional` 会导致加载失败。
- **上游 fork 维护（中）**：N-API ABI、包版本和 native artifacts 都需跟随上游；应把 fork 当临时方案。
- **错误模型变化（中）**：MCP JSON 工具返回改为 SDK `Decimal`/Date/native error，需要保持现有价格缺失、精度和时间戳语义。
- **行情权限（中）**：SDK QuoteContext 仍受账户行情套餐限制；缺少对应市场权限时应按现有 stale/error 语义失败，不能伪造价格。[官方 Quotes 权限说明](https://open.longbridge.com/docs/quote/pull/quote)

## 实施决策

- 可以继续 Goal 的只读设计和测试准备。
- 可以确认 `scope=6` 正确、`scope=11` 必须拒绝，三个资产 REST GET 正确。
- 可以确认 SDK 本身能用 `QuoteContext` 读行情，持仓也可通过 GET 读取，无需下单。
- 已采用匿名管道解决 Node token 注入缺口；MCP 可移除，现有应用侧 refresh、scope 校验和加密 SecretStore 均保留。
- 上游包新增 `OAuth.fromToken`/自定义 storage 后，应以官方入口替换匿名管道，不保留双轨实现。

## 官方来源索引

- [Longbridge SDK](https://open.longbridge.com/sdk)
- [Node.js SDK 文档](https://longbridge.github.io/openapi/nodejs/index.html)
- [官方 GitHub Node SDK](https://github.com/longbridge/openapi/tree/e6238609d9268021249ee0a9cc1379e598e57346/nodejs)
- [npm `longbridge` 4.4.1 metadata](https://registry.npmjs.org/longbridge/latest)
- [Getting Started / OAuth](https://open.longbridge.com/docs/getting-started)
- [OAuth/API overview and refresh](https://open.longbridge.com/docs/api?page=overview)
- [OAuth discovery](https://openapi.longbridge.com/.well-known/oauth-authorization-server)
- [Quotes](https://open.longbridge.com/docs/quote/pull/quote)
- [Account Assets](https://open.longbridge.com/docs/trade/asset/account)
- [Stock Positions](https://open.longbridge.com/docs/trade/asset/stock)
- [Fund Positions](https://open.longbridge.com/docs/trade/asset/fund)
- [Submit Order](https://open.longbridge.com/docs/trade/order/submit)
