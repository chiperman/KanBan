## Agent 工作约定

### 工作入口

从 [文档入口](docs/README.md) 按任务读取所属规范；需要定位实现时查 [源码导航](docs/current-baseline.md)，再沿源码确认。历史从 Git 查询，不能替代现行合同或本次授权。

### 轻量开发流程

- 小改直接实施；复杂改动先在会话中明确范围与验收，不强制另建规格或任务文档。
- 跨会话待办只维护在 [backlog](docs/backlog.md)，执行前复核，完成后移除。临时计划与一次性调查放已忽略的 `tmp/<topic>/`。
- 生效规则只更新所属文档。未经授权不提交；获授权后，在提交正文记录原因、行为变化、实际验证和未验证范围。

### 测试纪律

- 按影响范围验证，不为小改运行无关构建或测试。仅改文档时检查事实与引用。
- 未经用户要求，不主动新增测试文件；只在既有相关测试因本次改动报错时同步修正。
- `pnpm test` 为 `typecheck`、`design:lint`、`test:unit`，不启动浏览器。浏览器验收或新增测试以用户明确要求的范围为准，不恢复通用 E2E 套件。

### 领域文档

业务术语、财务口径与安全边界以 [CONTEXT](CONTEXT.md) 和 [有效 ADR](docs/adr/README.md) 为准，命名沿用已有词汇。新概念先明确含义；只有需要长期记录的决策与取舍才新增 ADR。

实现与现行合同冲突时，明确差异及依据，不静默覆盖，也不凭旧记录恢复功能。

### 设计开发

UI、交互、视觉样式或设计评审先读 [DESIGN](DESIGN.md) 及受影响的主题规范，复用现有组件和 Token。上游核对与验证范围由该文档维护，设计待办统一进入 backlog。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
