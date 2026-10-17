# 09 — 按职责拆分生产组合与持久化模块

Status: resolved
Type: task
Priority: 中
Phase: 后续重构
Evidence: 职责集中已确认；无已证实静态运行时循环依赖
Review date: 2026-09-10
Blocked by: 03, 04, 06

> 2026-10-02 归档核对：本父级主题已由 [执行 14](../../../active/project-health-hardening-delivery/issues/14-extract-persistence-and-migration.md)、[执行 15](../../../active/project-health-hardening-delivery/issues/15-extract-credentials-and-connections.md)、[执行 16](../../../active/project-health-hardening-delivery/issues/16-compose-extracted-production-services.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

生产模块约 4626 行，混合 JSON 与 SQLite 持久化、迁移、秘密存储、来源连接和服务装配，维护时难以判断边界。文件体积是职责集中的证据，不独立证明运行 bug。

**审查证据：** 审查覆盖 193 个 TS 文件的静态运行时导入图，未发现强连通循环；FileDashboardDatabase 仍被测试使用，不是已确认死代码。

**位置（模块/函数）：** 生产组合根、FileDashboardDatabase、SQLite 数据库、迁移和服务工厂。

## Solution

缩小未来变更影响面，便于独立理解和测试。

**修改风险：** 中至高：迁移、组合缓存和凭证边界易受影响。

## User Stories

1. 作为所有者，我希望按职责拆分生产组合与持久化模块，以便缩小未来变更影响面，便于独立理解和测试。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 在备份、认证与历史查询修复稳定后，按持久化/迁移、秘密与连接、应用组合等少数职责逐步提取；先保留公开导出与现有端口。
- 每次仅移动一个内聚职责并运行相关已有测试；保证模块初始化顺序、生产单例和迁移幂等。
- 若移除旧 JSON 适配器，必须另有调用证据和迁移方案，本 Ticket 不按体积直接删除。

## Testing Decisions

沿用现有 HTTP/浏览器、SQLite 迁移与备份恢复测试；不为每个搬迁函数复制测试。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 备份、认证、来源和历史业务外部行为不变；新旧库样例迁移后事实一致。
- [ ] 生产单例生命周期明确，无重复连接或重复迁移；新进程和热重载相关检查分开报告。
- [ ] 最终职责边界可由模块公开接口解释，无新的运行时导入环。
- [ ] 不混入无关命名、格式化或业务语义修订。

## Out of Scope

不全量重写、不更换框架/数据库、不制造循环依赖清理任务。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [src/server/production.ts](../../../../src/server/production.ts)
- [e2e/sqlite-business-data-persistence.spec.ts](../../../../e2e/sqlite-business-data-persistence.spec.ts)
- [e2e/credential-free-backup-restore.spec.ts](../../../../e2e/credential-free-backup-restore.spec.ts)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
