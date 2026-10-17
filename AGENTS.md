## Agent 技能

### Issue 跟踪器

Issue 以本地 Markdown 文件形式保存在 `.scratch/active/`，历史功能整体保存在 `.scratch/archive/`。目录入口见 `.scratch/README.md`，完整约定见 `docs/agents/issue-tracker.md`。

### Triage 标签

使用默认的五类 triage 标签词汇。详见 `docs/agents/triage-labels.md`。

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
