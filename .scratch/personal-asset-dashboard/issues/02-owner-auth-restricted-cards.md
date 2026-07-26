# 02 — 所有者登录与受限卡片隔离

**What to build:** 让唯一所有者能够通过 Passkey 登录并在同一公开主页中解锁敏感内容，同时让访客看到不含真实数据的受限卡片遮罩。访问控制必须由服务端和数据边界执行，不能只依赖前端隐藏。

**Blocked by:** 01 — 公开主页与应用验证骨架

**Status:** ready-for-human

- [x] 系统只允许预置的唯一所有者登录，不提供公开注册入口。
- [x] 所有者可以使用 Passkey 完成登录，失败或取消后仍停留在安全的访客状态。
- [x] 访客点击受限卡片后进入登录流程，成功登录后在原页面位置看到敏感内容。
- [x] 未登录 HTML、序列化页面状态、接口响应和浏览器网络流量中均不存在真实敏感信息。
- [x] 受限卡片只使用安全占位模型呈现磨砂或设计化遮罩，不对真实数据进行 CSS 模糊。
- [x] 访客不能通过修改客户端状态、请求参数或直接访问私密接口取得敏感信息。
- [x] 所有者退出登录后，敏感内容立即恢复为受限卡片且不残留在客户端缓存视图中。
- [x] 浏览器级测试覆盖访客、登录成功、登录失败和退出登录四条完整路径。

## 评论

2026-07-26 实现完成（分支 `feat/owner-auth-restricted-cards`）：

- Passkey：基于 `@simplewebauthn/server` 13.x 真实 WebAuthn 校验；`/setup` 仅在无凭证时开放一次完成所有者预置，之后永久 404（无公开注册）。
- 会话：服务端内存会话 + `HttpOnly; SameSite=Strict` 会话 Cookie，不设过期时间，浏览器关闭即结束；主页 `Cache-Control: no-store`，退出后回退导航不恢复已验证视图。
- 数据边界：`Card.access` 引入 public/restricted；服务端渲染时访客的受限卡片替换为仅含 id/span 的安全占位模型（点阵设计化遮罩，无 CSS 模糊真实数据），真实内容不出现在 HTML、RSC 序列化状态或任何接口响应中。
- 路由：`/api/auth/register/options|verify`、`/api/auth/login/options|verify`、`/api/auth/logout`；rpID/origin 由请求推导，质询经短生命周期 HttpOnly Cookie 传递。
- 测试：`e2e/owner-auth.spec.ts` 使用 CDP 虚拟平台认证器走真实 WebAuthn 流程，覆盖访客（含网络流量泄露断言与伪造会话/私密接口探测）、登录成功、登录失败（无凭证认证器）、退出登录四条路径。
- 自动测试：`pnpm typecheck` 通过；`pnpm test`（构建 + 16 条浏览器级测试）全部通过。
- 人工验收待做：登录对话框与受限遮罩在浅色/深色 × 桌面/手机宽度下的视觉检查；真实硬件 Passkey 的本地手动验证（自动测试使用虚拟认证器）。
