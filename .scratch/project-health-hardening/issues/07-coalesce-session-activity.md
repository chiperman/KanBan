# 07 — 合并会话活动请求并保持锁定边界

Status: resolved
Type: task
Priority: 中
Phase: 本迭代处理
Evidence: 确定存在
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 11](../../project-health-hardening-delivery/issues/11-coalesce-session-activity.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

会话守卫对每次 keydown、pointerdown 和 touchstart 都提交活动请求；连续输入和触屏重复事件产生大量同义请求。

**审查证据：** SessionGuard 的活动监听直接调用活动 POST，缺少节流与在途合并；实际每分钟流量尚未测量。

**位置（模块/函数）：** SessionGuard 活动事件处理与定时器；session/activity POST。

## Solution

减少输入期间无意义的请求与服务端写入。

**修改风险：** 低至中：需验证服务端空闲到期竞态。

## User Stories

1. 作为所有者，我希望合并会话活动请求并保持锁定边界，以便减少输入期间无意义的请求与服务端写入。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 每次真实交互仍立即更新本地活动时间，服务器活动通知做短窗口合并及在途去重。
- 节流窗口必须留出服务端空闲到期安全余量，必要时发送尾沿请求；不能用收到重复响应延长已过期会话。
- 收到明确会话失效时立即锁定；网络错误沿用既有策略并保留空闲上限，卸载清理定时器与监听器。

## Testing Decisions

扩展现有恢复与会话锁定浏览器测试，通过可控时间和 HTTP 请求观察验证外部行为。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 突发键盘输入和同一次触控的重叠事件产生有界请求，不重叠创建多个在途活动请求。
- [ ] 持续真实操作不因合并而误锁；完全空闲仍在既定期限锁定。
- [ ] 401/会话失效、网络异常、到期边缘交互与组件卸载有覆盖；无卸载后请求。
- [ ] 隐藏页面不因新增后台心跳无限维持会话。

## Out of Scope

不更改默认空闲时长、不添加后台保活、不放宽认证失败条件。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [src/ui/session-guard.tsx](../../../src/ui/session-guard.tsx)
- [src/app/api/auth/session/activity/route.ts](../../../src/app/api/auth/session/activity/route.ts)
- [src/shared/session-policy.ts](../../../src/shared/session-policy.ts)
- [e2e/recovery-session-lock.spec.ts](../../../e2e/recovery-session-lock.spec.ts)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
