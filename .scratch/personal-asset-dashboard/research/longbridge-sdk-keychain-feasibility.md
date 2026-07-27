# Longbridge Node SDK OAuth 与 macOS Keychain 可行性

## 来源

- Longbridge 官方仓库 `v4.4.1` Node README：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/nodejs/README.md>
- Longbridge 官方仓库 `v4.4.1` Node N-API OAuth 绑定：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/nodejs/src/oauth.rs>
- Longbridge 官方仓库 `v4.4.1` Node 类型声明：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/nodejs/index.d.ts>
- Longbridge 官方仓库 `v4.4.1` OAuth builder：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/rust/crates/oauth/src/builder.rs>
- Longbridge 官方仓库 `v4.4.1` Token storage：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/rust/crates/oauth/src/storage.rs>
- Longbridge 官方仓库 `v4.4.1` OAuth client：<https://raw.githubusercontent.com/longbridge/openapi/v4.4.1/rust/crates/oauth/src/client.rs>

## 事实

1. Node README（84–104 行）规定 `OAuth.build()` 从 `~/.longbridge/openapi/tokens/<client_id>` 读取缓存，并在授权或刷新后继续写回该路径。
2. Node N-API 绑定（`nodejs/src/oauth.rs` 19–56 行）只导出 `OAuth.build(client_id, on_open_url, callback_port?)`；绑定内部创建 Rust `CoreOAuthBuilder::new(client_id)`，只设置回调端口后调用 `build`。没有导出 `token_storage`、`from_token` 或注入 Token 的参数。
3. Node 类型声明（`index.d.ts` 881–900 行）与绑定一致：`OAuth` 只有静态 `build`，且文档再次声明默认磁盘缓存路径。`Config.fromOAuth` 只接收 SDK 的 `OAuth` 句柄（262 行），不是 raw access/refresh token。
4. 同一官方 tag 的 Rust OAuth core 提供 `OAuthBuilder::token_storage(...)`（`builder.rs` 37–59 行），并在构建、刷新、授权后通过该后端加载/保存 Token（93–143 行）。
5. Rust `TokenStorage` 接口（`storage.rs` 38–48 行）允许替换默认文件存储，官方注释明确举例 OS keychain、加密存储和内存缓存；默认实现仍将 JSON 写入 `~/.longbridge/openapi/tokens/<client_id>`（50–66 行）。
6. Rust `OAuth::from_token(access_token)`（`client.rs` 55–75 行）可以从已有 access token 构造句柄，但官方注释明确该句柄不支持刷新，且只保留 access token；该 API 没有暴露 refresh token 构造参数。

## 结论

- **直接安装并使用官方 `longbridge@4.4.1` Node 包时：不能把 KanBan 现有 raw access/refresh token 注入 SDK，也不能通过公开 Node API 关闭或替换 `~/.longbridge/openapi/tokens` 缓存。**
- **Keychain 在官方核心抽象层是可行的**：Rust core 已定义可插拔 `TokenStorage`，并明确把 OS keychain 作为适用场景；但该能力没有被 4.4.1 Node N-API 绑定暴露出来。
- 因此，“统一 SDK + Keychain”不是现成 npm 配置项，而是需要扩展边界：修改/派生 Node N-API 绑定，暴露 `token_storage`（并实现 Keychain backend）以及必要的已有 Token 初始化能力；或者继续使用 KanBan 自己的 OAuth/Keychain 存储，再通过受控 HTTP 客户端访问 API。
- `OAuth::from_token` 不能解决完整 OAuth 生命周期：它没有 refresh token，且 Node 包没有导出该方法；把 access token 当永久凭证也不符合刷新需求。

## 建议

1. 不要把 `HOME`、软链接或临时文件作为 Keychain 替代方案；这只能改变文件位置，不能让 SDK 获得系统密钥保护。
2. 若坚持全量 SDK，优先做一个最小、只读的官方 fork/N-API 扩展：Node 侧接收一个抽象存储适配器或由服务端实现 Keychain backend；禁止导出下单等写操作到 KanBan 业务层，并为 Token 的 load/save/refresh 编写集成测试。
3. 若不维护 fork，保留当前服务端 OAuth，并把现有加密 Token 存储迁移到 macOS Keychain；报价和账户 API 仍由当前服务端受控调用。这样可立即使用 Keychain，但不宣称使用了 SDK 的 OAuth builder。
4. 无论采用哪条路径，Keychain 中至少保存 access token、refresh token、过期时间和 client id；日志、响应和前端接口只返回账户指纹/状态，不返回 Token 本身。
