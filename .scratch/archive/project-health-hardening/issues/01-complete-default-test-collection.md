# 01 — 补齐默认测试入口

Status: resolved
Type: task
Priority: 中
Phase: 立即处理
Evidence: 确定存在
Review date: 2026-09-10

> 2026-10-02 归档核对：本父级主题已由 [执行 01](../../../active/project-health-hardening-delivery/issues/01-complete-default-tests.md) 完成，交付状态及验收边界以执行 Ticket 为准。下文保留 2026-09-10 审查背景和原验收清单，不再作为第二份待实施任务。

## Problem Statement

默认单元测试命令使用白名单，遗漏同步、适配器、刷新协调器和本机脚本的五个测试文件；这些文件在审查中单独执行均通过，但默认入口无法阻止它们今后回归。默认 smoke 仅覆盖两个界面场景，不能代表完整业务验收。

**审查证据：** 审查时默认单元测试 43/43；遗漏文件补跑 38/38。未发现仓库内 GitHub Actions 配置，不据此推断外部 CI 不存在。

**位置（模块/函数）：** package.json 的 test:unit / test:smoke；scripts/test-command-contract.test.mjs 的命令契约。

## Solution

用现有测试消除默认质量门禁盲区，投入小。

**修改风险：** 低。

## User Stories

1. 作为所有者，我希望补齐默认测试入口，以便用现有测试消除默认质量门禁盲区，投入小。
2. 作为维护者，我希望用既有业务入口验证本 Ticket，以便修复不改变已接受的领域语义。
3. 作为所有者，我希望验收区分合成样例、自动化回归与真实环境结果，以便准确判断剩余风险。

## Implementation Decisions

- 最小修改默认测试清单，并更新已有测试命令契约检查；若采用自动发现，限制在明确的离线单元测试目录和后缀，不把浏览器或真实平台测试混入。
- 说明类型检查、单元测试、快速 smoke、完整浏览器回归各自覆盖范围；已有测试脚本的调用方式保持兼容。

## Testing Decisions

沿用现有 Node 测试运行器和测试命令契约测试，验证实际收集与失败传播；无需为清单做镜像断言。

测试边界为建议方案，已向所有者征询，本规格发布时未收到确认；实施前以其反馈更新。测试只验证对外结果，避免对搬迁后的内部函数或特定 SQL 文本做镜像断言。

**验收标准：**

- [ ] 默认单元测试入口实际执行审查遗漏的五个文件，任意被收集用例失败时命令非零退出。
- [ ] 受控目录中新添符合约定的单元测试时能够被收集，或遗漏会被命令契约检查明确拦截。
- [ ] 既有测试通过，未增加真实账户、网络或凭证依赖；报告完整回归是否执行，不把 smoke 标成全量。

## Out of Scope

不引入新的 CI 平台、付费服务或无关测试框架。

## Further Notes

**候选涉及文件（最小方案，实施时复核）：**

- [package.json](../../../../package.json)
- [scripts/test-command-contract.test.mjs](../../../../scripts/test-command-contract.test.mjs)
- [src/server/asset-synchronization.test.ts](../../../../src/server/asset-synchronization.test.ts)
- [src/server/asset-source-provider-adapters.test.ts](../../../../src/server/asset-source-provider-adapters.test.ts)
- [src/ui/asset-refresh-coordinator.test.ts](../../../../src/ui/asset-refresh-coordinator.test.ts)
- [scripts/local-network-environment.test.mjs](../../../../scripts/local-network-environment.test.mjs)
- [scripts/longbridge-keychain.test.mjs](../../../../scripts/longbridge-keychain.test.mjs)

上述列表包含需阅读或扩展的入口，不代表每个文件都必须修改；新增测试优先扩展现有文件。确需新增模块时，先在此 Ticket 记录具体文件清单，禁止扩大到无关改动。

界面或交互改动遵循仓库 DESIGN 与固定上游版本，并复用现有 UI 组件和 Token；不可访问上游时明确记录未完成核对。

验收完成后记录实际命令、结果、未执行项与回滚方式；审查时的成功结果不能替代修改后的验收。

## 评论

- 2026-09-10：由系统性代码审查整理为独立 Ticket；仅发布规格，尚未实施。

- 2026-10-02：核对现有实现及已归档执行 Ticket，关闭重复父级待办；历史证据不等于本轮全仓回归或真实账户验收。
