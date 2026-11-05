## Agent 工作约定

### 工作入口

从 [文档入口](docs/README.md) 按任务读取所属规范；需要定位实现时查 [源码导航](docs/current-baseline.md)，再沿源码确认。历史从 Git 查询，不能替代现行合同或本次授权。

### 轻量开发流程

- 小改直接实施；复杂改动先在会话中明确范围与验收，不强制另建规格或任务文档。
- 跨会话待办只维护在 [backlog](docs/backlog.md)，执行前复核，完成后移除。临时计划与一次性调查放已忽略的 `tmp/<topic>/`。
- 生效规则只更新所属文档。未经授权不提交；获授权后，在提交正文记录原因、行为变化、实际验证和未验证范围。

### Git 与合并

- `main` 必须保持线性提交历史。PR 默认使用 Squash merge；需要保留多个独立提交时使用 Rebase merge，禁止创建 Merge Commit。
- 更新本地分支使用 `git pull --ff-only`；需要同步 `main` 时使用 rebase，不把 `main` merge 到功能分支。合并后核对 `main` 没有多父提交，并清理本次已合并的临时分支。

### 测试纪律

- 按影响范围验证，不为小改运行无关构建或测试。仅改文档时检查事实与引用。
- 未经用户要求，不主动新增测试文件；只在既有相关测试因本次改动报错时同步修正。
- `pnpm test` 为 `typecheck`、`design:lint`、`test:unit`，不启动浏览器。浏览器验收或新增测试以用户明确要求的范围为准，不恢复通用 E2E 套件。

### 领域文档

业务术语、财务口径与安全边界以 [CONTEXT](CONTEXT.md) 和 [有效 ADR](docs/adr/README.md) 为准，命名沿用已有词汇。新概念先明确含义；只有需要长期记录的决策与取舍才新增 ADR。

实现与现行合同冲突时，明确差异及依据，不静默覆盖，也不凭旧记录恢复功能。

### 设计开发

UI、交互、视觉样式或设计评审先读 [DESIGN](DESIGN.md) 及受影响的主题规范，复用现有组件和 Token。上游核对与验证范围由该文档维护，设计待办统一进入 backlog。

### 产品体验

开发或评审面向用户的功能时，优先检查以下三点，并在本次任务范围内落实：

- **操作流畅、符合直觉**：围绕用户目标组织信息与流程，让用户清楚当前位置、主要动作和操作结果。沿用一致的术语、控件与交互，减少不必要的步骤、重复输入和记忆负担；优先通过布局与交互表达含义，避免用多余标签和说明弥补设计问题。
- **异常清楚、能够恢复**：区分加载中、无数据、部分可用和失败；用用户能理解的语言说明发生了什么、对当前任务和数据有何影响、下一步能做什么，并提供与实际原因匹配的恢复入口。尽量保留已输入内容和可用数据，不把原始技术报错或笼统的“操作失败”作为唯一反馈；原因不明时如实说明，不猜测、不暗示成功。
- **遇到问题能快速联系与反馈**：提供位置稳定、容易找到的联系与问题反馈入口，无法自行恢复的异常应能直接到达。优先复用已有渠道，允许用户附带必要的问题上下文；诊断信息应脱敏，不自动发送敏感数据。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
