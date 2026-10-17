# Issue 跟踪器：本地 Markdown

本仓库的 Issue 和规格文档（也可称为 PRD）以 Markdown 文件形式保存在 `.scratch/` 中。

目录入口和现有功能导航见 [本地规格与 Issue 索引](../../.scratch/README.md)。

## 约定

- 新功能使用一个目录：`.scratch/active/<feature-slug>/`
- 规格文档为 `.scratch/active/<feature-slug>/spec.md`
- 实现 Issue 按 Ticket 分别保存为 `.scratch/active/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号；禁止合并为单个 Ticket 文件
- Triage 状态记录在每个 Issue 文件顶部附近的 `Status:` 行中（角色字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件底部的 `## 评论` 标题下
- `spec.md`、`map.md` 和 `research/` 按需创建，不创建空目录或占位文档
- 功能整体归档到 `.scratch/archive/<feature-slug>/`，保留规格、Ticket、调研和验收历史；只要仍有未关闭 Ticket 或待确认范围，就不能仅依据父规格状态归档
- 目录整理不自动关闭任务，不改写历史状态和验收日期；归档记录中的通过结论仍受其原验收边界约束
- 临时脚本、扫描日志、截图和上游副本放入已忽略的 `tmp/scratch/<topic>/`，不得混入正式跟踪目录

## 当技能要求“发布到 Issue 跟踪器”时

在 `.scratch/active/<feature-slug>/` 下创建新文件；如目录不存在，则一并创建。先查索引和归档，避免为同一功能建立重复目录；需要继续归档功能时先整体移回 `active/` 并同步引用。

## 当技能要求“获取相关 Ticket”时

读取引用路径中的文件。用户通常会直接提供文件路径或 Issue 编号。旧路径失效时，先在 `active/` 和 `archive/` 中按功能名与 Ticket 编号查找，不重新创建同名 Ticket。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图**是一个文件，每个 Ticket 对应一个**子文件**。

- **地图**：`.scratch/active/<effort>/map.md`，包含 Notes、Decisions-so-far 和 Fog 正文。
- **子 Ticket**：`.scratch/active/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文记录问题。`Type:` 行记录 Ticket 类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **阻塞关系**：在文件顶部附近使用 `Blocked by: NN, NN` 行。只有当列出的所有文件均为 `resolved` 时，Ticket 才解除阻塞。
- **前沿任务**：扫描 `.scratch/active/<effort>/issues/`，查找仍开放、未阻塞且未认领的文件；编号最小者优先。不把 `archive/` 中保留的旧状态当作当前任务。
- **认领**：开始任何工作前，将 `Status:` 设为 `claimed` 并保存。
- **解决**：在 `## 答案` 标题下追加答案，将 `Status:` 设为 `resolved`，然后在 `map.md` 的 Decisions-so-far 中追加上下文指针（摘要与链接）。
