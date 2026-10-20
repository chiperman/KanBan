# 认证访问入口

默认运行于 localhost HTTP。HTTPS 或反向代理部署必须显式设置 `PAD_PUBLIC_ORIGIN=https://实际主机名[:端口]`（纯 origin，无路径、末尾斜线、用户名）。该配置同时确定 WebAuthn origin/RP-ID 和认证 Cookie 的 Secure 标志；不信任客户端提供的 Forwarded 或 X-Forwarded-Proto。

HTTP 仅支持 localhost、127.0.0.1、[::1]。非本机部署使用 HTTPS；反向代理须阻止外部直接访问后端 HTTP 端口。切换主机名不能跨 RP-ID 复用凭证。

会话 Cookie 为 HttpOnly、SameSite=Lax、浏览器会话有效期；挑战 Cookie 为 HttpOnly、SameSite=Strict、五分钟有效期。HTTPS 下设置与删除均携带 Secure。登录失败会清理挑战 Cookie；服务端单次消费独立约束重放。会话与挑战保存在单进程内存中，重启失效；不支持无共享状态的多实例认证部署。

## 验证入口

现有 [专项脚本](../../scripts/check-https-auth.mjs) 可在已构建的隔离副本中通过 `node scripts/check-https-auth.mjs` 运行，使用临时 TLS 代理和 Chromium 虚拟认证器检查注册、登录、失败清理及退出。证书、密钥与测试数据在临时目录生成并清理，不访问所有者凭证；它不在 `pnpm test` 中，也不代表真实域名证书或反向代理已经验收。

现有离线认证单测在 [passkey-auth.test.ts](../../src/server/auth/passkey-auth.test.ts)，验证范围见 [测试纪律](../../AGENTS.md#测试纪律)。
