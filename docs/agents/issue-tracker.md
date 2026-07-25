# Issue 跟踪器：本地 Markdown

本仓库的 Issue 和规格文档（也可称为 PRD）以 Markdown 文件形式保存在 `.scratch/` 中。

## 约定

- 每个功能使用一个目录：`.scratch/<feature-slug>/`
- 规格文档为 `.scratch/<feature-slug>/spec.md`
- 实现 Issue 按 Ticket 分别保存为 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号；禁止合并为单个 Ticket 文件
- Triage 状态记录在每个 Issue 文件顶部附近的 `Status:` 行中（角色字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件底部的 `## 评论` 标题下

## 当技能要求“发布到 Issue 跟踪器”时

在 `.scratch/<feature-slug>/` 下创建新文件；如目录不存在，则一并创建。

## 当技能要求“获取相关 Ticket”时

读取引用路径中的文件。用户通常会直接提供文件路径或 Issue 编号。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图**是一个文件，每个 Ticket 对应一个**子文件**。

- **地图**：`.scratch/<effort>/map.md`，包含 Notes、Decisions-so-far 和 Fog 正文。
- **子 Ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文记录问题。`Type:` 行记录 Ticket 类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **阻塞关系**：在文件顶部附近使用 `Blocked by: NN, NN` 行。只有当列出的所有文件均为 `resolved` 时，Ticket 才解除阻塞。
- **前沿任务**：扫描 `.scratch/<effort>/issues/`，查找仍开放、未阻塞且未认领的文件；编号最小者优先。
- **认领**：开始任何工作前，将 `Status:` 设为 `claimed` 并保存。
- **解决**：在 `## 答案` 标题下追加答案，将 `Status:` 设为 `resolved`，然后在 `map.md` 的 Decisions-so-far 中追加上下文指针（摘要与链接）。
