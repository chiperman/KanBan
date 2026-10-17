# 02 — 修复正式日结 CLI 的模块加载

Status: resolved
Type: task
Priority: 高
Phase: 立即处理
Evidence: 确定存在
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 02](../../../active/project-health-hardening-delivery/issues/02-restore-settlement-cli.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

正式日结 CLI 经生产组合根导入会话认证模块时，Node 的 ESM 解析无法找到 Next headers 子路径，任务在进入业务逻辑前退出；定时执行器复用同一入口。

**审查证据：** 审查使用 Node 24.15 与临时数据目录运行正式命令，退出码 1，错误 ERR_MODULE_NOT_FOUND 指向 next/headers；失败发生在数据写入前。

**位置（模块/函数）：** 正式日结 CLI 顶层导入；SessionOwnerAuth 所在模块的 next/headers 导入；TS alias resolve。

## Solution

恢复独立日结入口的可启动性，变更面很小。

**修改风险：** 低。

## User Stories

1. 作为所有者，我希望修复正式日结 CLI 的模块加载，以便恢复独立日结入口的可启动性，变更面很小。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 先验证认证模块的 Next headers 导入是否可用最小的显式扩展名修改解决，并验证 Next 应用仍可使用。仅当不成立时才考虑隔离 CLI 不需要的 Web 依赖。
- CLI 的参数、退出码和正式日结业务语义保持不变；不为解决一个导入问题添加第二套加载器。

## Testing Decisions

最高入口为 CLI 子进程，复用现有 TS alias 注册器、正式日结样例与 launchd 命令生成；认证使用既有 HTTP/浏览器测试。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 在隔离临时数据目录中通过真实 CLI 子进程启动，不再发生模块解析错误，空数据按既定业务契约退出。
- [ ] 确定性就绪与未就绪样例各自给出正确结果及退出码，不用真实平台调用验收模块加载。
- [ ] 生成的 launchd 命令与已验证入口一致；不安装、启停或覆盖所有者现有服务。
- [ ] 认证 HTTP 入口仍能工作；明确区分 CLI 启动通过与真实市场日结采集成功。

## Out of Scope

不安装定时服务，不读取真实凭证，不重定义收盘时间或补造漏采日结。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [src/server/auth/session-auth.ts](../../../../src/server/auth/session-auth.ts)
- [scripts/run-formal-daily-settlement.ts](../../../../scripts/run-formal-daily-settlement.ts)
- [scripts/ts-alias-loader.mjs](../../../../scripts/ts-alias-loader.mjs)
- [scripts/formal-daily-settlement-launchd.mjs](../../../../scripts/formal-daily-settlement-launchd.mjs)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
