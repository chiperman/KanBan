# 04 — 使 Passkey 挑战具有服务端时效和单次使用约束

Status: resolved
Type: task
Priority: 高
Phase: 立即处理
Evidence: 确定存在；现实攻击仍要求取得此前有效响应和对应挑战
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 04](../../../active/project-health-hardening-delivery/issues/04-consume-passkey-challenges.md)、[执行 05](../../../active/project-health-hardening-delivery/issues/05-secure-auth-cookie-transport.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

挑战只放在带 Max-Age 的客户端 Cookie 中，验证端没有服务端签发状态、过期判断与原子消费；Cookie 的浏览器过期行为不能约束攻击者重发旧请求。合法零计数器凭证无法靠签名计数器阻止相同断言再次通过。

**审查证据：** 审查用合成 P256 密钥生成真实签名断言，验证库连续两次接受相同断言，持久计数器仍为 0；这不代表攻击者可以任意伪造签名。

**位置（模块/函数）：** 挑战 Cookie helper；login/register 的 options 与 verify 路由；会话创建与认证状态存储。

## Solution

关闭挑战重放路径，并保留合法零计数器 Passkey 的兼容性。

**修改风险：** 中：影响登录、首次预置与多标签页行为。

## User Stories

1. 作为所有者，我希望使 Passkey 挑战具有服务端时效和单次使用约束，以便关闭挑战重放路径，并保留合法零计数器 Passkey 的兼容性。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 注册和登录统一使用有服务端状态的随机挑战，绑定签发上下文、用途与过期时间；以原子状态转换保证一个挑战最多产生一次成功结果。
- 验证签名、origin、RP-ID、凭证归属仍由现有安全流程承担；服务端挑战状态不进入业务备份。多进程可见性必须与实际部署拓扑匹配。
- 采用单浏览器当前流程语义：重新签发使该浏览器同用途旧挑战失效，多标签页提示重新开始；不同用途不能互用。
- HTTPS 下认证 Cookie 使用 Secure，明确支持现有 localhost HTTP；安全判定来自可信配置，不盲信任意转发头。保持 HttpOnly、SameSite 与现有 TOTP 防重放和限流。

## Testing Decisions

优先现有所有者认证与恢复锁定浏览器测试，搭配虚拟认证器；精确过期、并发和重放通过真实 HTTP 入口与确定性时钟样例验证，不只测验证库。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 未签发、过期、用途不符、签发上下文不符及已消费挑战均被 HTTP 入口拒绝且不创建会话。
- [ ] 同一有效断言并发提交最多一次成功；会话签发或凭证注册不得绕过原子消费。
- [ ] 零计数器 Passkey 能以新挑战重复正常登录，旧挑战的同一断言不能再次成功。
- [ ] 注册与登录、多标签页重新签发、HTTPS Cookie 及本机 HTTP 场景有覆盖；服务器重启后旧挑战不能意外重新有效。
- [ ] 无新增公开注册或第二所有者；既有 TOTP 限流、一次性计数器、恢复和锁定行为保持。

## Out of Scope

不删除零计数器支持，不削弱 TOTP，不增加账号体系或第三方身份服务。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [src/server/auth/cookies.ts](../../../../src/server/auth/cookies.ts)
- [src/server/auth/session-auth.ts](../../../../src/server/auth/session-auth.ts)
- [src/app/api/auth/login/options/route.ts](../../../../src/app/api/auth/login/options/route.ts)
- [src/app/api/auth/login/verify/route.ts](../../../../src/app/api/auth/login/verify/route.ts)
- [src/app/api/auth/register/options/route.ts](../../../../src/app/api/auth/register/options/route.ts)
- [src/app/api/auth/register/verify/route.ts](../../../../src/app/api/auth/register/verify/route.ts)
- [e2e/owner-auth.spec.ts](../../../../e2e/owner-auth.spec.ts)
- [e2e/recovery-session-lock.spec.ts](../../../../e2e/recovery-session-lock.spec.ts)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
