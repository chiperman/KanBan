# 长桥 OAuth Client ID 与回调地址配置调研

- 调研日期：2026-07-26（Asia/Shanghai）
- 对应 Ticket：06 — 长桥首个资产来源闭环
- 调研范围：Longbridge Developers 官方 OAuth 文档及当前 KanBan 实现；未创建 OAuth 客户端、未写入环境变量、未接触任何凭证。

## 结论

`LONGBRIDGE_OAUTH_CLIENT_ID` 应填入**长桥 OAuth 动态注册接口返回的 `client_id`**，不是旧版 App Key、App Secret、Access Token，也不是用户账户信息。

注册客户端时，`redirect_uris` 必须包含 KanBan 实际运行地址加上以下固定路径：

```text
https://<KanBan 实际域名>/api/asset-sources/longbridge/oauth/callback
```

本地开发若通过默认 Next 开发地址访问，则相应填写：

```text
http://localhost:3000/api/asset-sources/longbridge/oauth/callback
```

部署域名与本地地址是不同的回调 URI；若两者都会使用，应在注册请求的 `redirect_uris` 数组中同时列出。不能把示例域名、前端首页或末尾不同的路径当作回调地址。

## 官方注册方法

Longbridge 官方文档说明，若没有可视化创建入口，可以向 `POST https://openapi.longbridge.com/oauth2/register` 动态注册 OAuth 客户端；注册请求应声明 `authorization_code` 与 `refresh_token`，响应会返回 `client_id`。官方 discovery 同时声明 token endpoint 的认证方法为 `none`、支持 PKCE `S256`。

按本项目的只读 OAuth + PKCE 设计，可在**自己的终端**用占位值替换后执行如下请求：

```bash
curl -X POST https://openapi.longbridge.com/oauth2/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "KanBan Personal Asset Dashboard",
    "redirect_uris": [
      "https://<KanBan 实际域名>/api/asset-sources/longbridge/oauth/callback"
    ],
    "token_endpoint_auth_method": "none",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"]
  }'
```

从 JSON 响应中只取 `client_id`，再在运行 KanBan 的服务端环境中设置：

```env
LONGBRIDGE_OAUTH_CLIENT_ID=<注册响应中的 client_id>
```

不要把 OAuth `access_token`、`refresh_token` 或注册响应中的管理凭证写进该变量、仓库或前端环境变量。官方也明确要求 OAuth Token 安全存储，而不是放入环境变量。

## 与当前 KanBan 实现的逐项对应

| 配置项 | 应使用的值 | 依据 |
| --- | --- | --- |
| `LONGBRIDGE_OAUTH_CLIENT_ID` | 注册响应的 `client_id` | 生产实现读取该环境变量，并作为授权、换 token 请求的 `client_id`。 |
| `redirect_uris` | `https://<实际 origin>/api/asset-sources/longbridge/oauth/callback` | `start` 路由以收到请求的 origin 加固定 callback path 构造 `redirect_uri`。 |
| 授权请求 `redirect_uri` | 与注册值逐字符一致的运行时 callback | 官方授权 URL 和 token 兑换请求都使用同一 `redirect_uri`；项目也将启动时的同一字符串保存后用于兑换。 |
| `token_endpoint_auth_method` | `none` | 官方 discovery 仅声明 `none`；项目以 PKCE `S256` 和 `code_verifier` 兑换 token，未使用 client secret。 |
| scope | `6` | 项目固定只请求并只接受长桥账户读取 scope `6`。 |

### 当前实现的关键行为

- 未设置 `LONGBRIDGE_OAUTH_CLIENT_ID` 时，开始授权会立即报“未配置 LONGBRIDGE_OAUTH_CLIENT_ID”。
- 回调 URI 不是另一个环境变量：它由 `POST /api/asset-sources/longbridge/oauth/start` 所收到的请求 URL 生成。
- 因此，反向代理/部署平台必须向 Next 正确传递外部协议和域名；否则项目生成的 `redirect_uri` 会与注册值不一致。这是基于当前代码的部署推论，不是长桥文档的额外要求。

## 最小操作顺序

1. 确定用户浏览器实际访问 KanBan 的 URL（本地或生产域名）。
2. 使用该 URL 加固定 callback path 注册 OAuth 客户端，并安全保存响应中的 `client_id`。
3. 仅在对应 KanBan 服务端运行环境设置 `LONGBRIDGE_OAUTH_CLIENT_ID`，重启/重新部署服务。
4. 以所有者身份点击“开始 OAuth 授权”；长桥完成授权后将回到同一个 callback URI。

若以后更换域名或端口，需要重新检查注册的 `redirect_uris` 是否覆盖新的完整 callback URI；官方页面没有说明可在控制台编辑既有注册项，故在未核实管理接口前，不应假设可直接修改。

## 官方来源

- [Longbridge Developers：快速开始（OAuth 客户端注册、client_id、token 安全）](https://open.longbridge.com/zh-CN/docs/getting-started)
- [Longbridge Developers：Overview（OAuth 2.0 实际接入流程、授权回调与 token 兑换）](https://open.longbridge.com/zh-CN/docs/how-to-access-api)
- [Longbridge OAuth Authorization Server Metadata（端点、授权类型、PKCE 与 public-client 认证方式）](https://openapi.longbridge.com/.well-known/oauth-authorization-server)
- 本地实现核对：`src/app/api/asset-sources/longbridge/oauth/start/route.ts`、`src/server/asset-sources/longbridge.ts`（非外部资料）。
