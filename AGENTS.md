## Agent 技能

### Issue 跟踪器

Issue 以本地 Markdown 文件形式保存在 `.scratch/` 下。详见 `docs/agents/issue-tracker.md`。

### Triage 标签

使用默认的五类 triage 标签词汇。详见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库采用 single-context 布局。详见 `docs/agents/domain.md`。

### 设计开发

凡涉及 UI、交互、视觉样式或设计评审，必须先：

1. 阅读仓库根目录的 `DESIGN.md`；
2. 在线阅读 `DESIGN.md` 中固定 commit 对应的 GitHub `SPEC.md`、`DESIGN.md` 和 `index.html`；
3. 复用 `src/ui/vibe/` 与现有运行时 Token，不另建第二套视觉语言；
4. 不把上游仓库完整复制或 vendoring 到本仓库。

若 GitHub 暂时不可访问，必须明确说明未完成上游核对，不得声称已经按最新或固定版本验收。
