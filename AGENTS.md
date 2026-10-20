## Agent 工作约定

### 现行规则与历史资料

开始任务先读 `docs/README.md`，按主题读取现行合同与 `docs/current-baseline.md`，并沿源码入口核对实现。历史讨论从 Git 查询；旧规格、验收记录和历史授权不能替代现行合同或本次授权。

### 轻量开发流程

- 不再维护 `.scratch/`，不强制创建 spec、本地 Ticket、任务地图或 triage 状态。小改直接按当前要求实施；复杂改动先在会话中明确范围与验收。
- 跨会话仍需跟进的事项只维护在 `docs/backlog.md`；执行前复核当前源码，完成后移除，不复制历史任务树。
- 临时计划和一次性调查放已忽略的 `tmp/<topic>/`；生效规则更新所属现行文档，不另建一套规格。
- 有提交授权时，在提交正文记录原因、行为变化、实际验证和未验证范围；未获授权时在交付回复中说明，不自动提交。历史过程由 Git 保存。

### 测试纪律

- 默认不做多余的测试。改动以最小范围交付，不被要求时**不得主动新增测试文件**（不写 `*.test.ts` / `*.test.mjs` / `*.spec.ts`）。
- 小改（文案、视觉 Token、局部组件、单一函数修复）**不新增测试**，只在既有相关测试报错时同步修正，不扩大覆盖范围。
- 浏览器端到端测试（`e2e/`）已从仓库移除，默认不重建；除非用户明确要求恢复或新增某条用户流程验收，否则不引入 Playwright 规格、配置或运行浏览器的检查。
- 提交门禁（`pnpm test`）只保留轻量、离线、与当前改动同目录的单测（`typecheck` + `design:lint` + `test:unit`）。CI 与本地都不自动跑浏览器测试。
- 用户主动要求"加测试 / 补测试 / 验收"时，先确认范围与覆盖目标，再按授权实施；不要为提高覆盖率顺手铺测试。

### 领域文档

本仓库采用 single-context 布局。详见 `docs/agents/domain.md`。

### 设计开发

凡涉及 UI、交互、视觉样式或设计评审，必须先：

1. 阅读仓库根目录的 `DESIGN.md`；
2. 在线阅读 `DESIGN.md` 中固定 commit 对应的 GitHub `SPEC.md`、`DESIGN.md` 和 `index.html`；
3. 复用 `src/ui/vibe/` 与现有运行时 Token，不另建第二套视觉语言；
4. 不把上游仓库完整复制或 vendoring 到本仓库；
5. 需要组件契约、页面模式、无障碍门槛或偏差判定时，查 `docs/design-system/`；改动 Token 或组件配方后运行 `pnpm design:styleguide` 重新生成样式指南，并在浏览器中运行 `pnpm design:styleguide:verify` 验收生成物。字号、色值、圆角、断点等裸值由 `pnpm design:lint` 守门，它已接入 `pnpm test`，会随开发门禁自动运行；不许先改基线绕过。新增字号档位只能通过 `design-tokens.css` 的 `--vibe-type-*`，不要往脚本里加白名单。

若 GitHub 暂时不可访问，必须明确说明未完成上游核对，不得声称已经按最新或固定版本验收。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
