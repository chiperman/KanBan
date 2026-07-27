# 26 — 对齐个人资产看板真相文档

**What to build:** 清理产品收口和布局调整后遗留的领域与规格矛盾，使 `CONTEXT.md`、规格、当前基线和仍开放 Ticket 对当前纯私有资产看板给出一致描述。

**Blocked by:** None

**Priority:** P2

**Status:** ready-for-agent

- [ ] `CONTEXT.md` 开头不再描述已删除的个人资料和个性化内容能力，并与“个人资产看板”术语定义一致。
- [ ] 规格删除可调最小高度和持久化 `minimum height` 的残留要求，统一为卡片高度始终随内容自适应。
- [ ] 测试决策不再要求验证已删除的卡片高度调整行为。
- [ ] 已被 Ticket 19 取代的历史 Ticket 保留历史记录，但明确的 `Superseded by` / `Adjusted by` 说明不得与当前范围冲突。
- [ ] `docs/current-baseline.md` 继续作为当前交付状态入口；真实来源人工验收仍只记录在 Ticket 18，不复制出第二套状态。
- [ ] 使用文本搜索证明当前有效文档中不存在个人资料/内容发布能力或可调最小高度仍属于当前范围的陈述。

## 审查证据

- 2026-07-27：`CONTEXT.md` 第 3 行仍称产品汇集“个人资料、个性化内容”，第 16 行却明确不承载个人资料和内容发布。
- `.scratch/personal-asset-dashboard/spec.md` 的 User Story 46、Implementation Decision 和 Testing Decision 仍保留 minimum height，而当前基线已经明确删除 `minHeight`。

## 评论

- 本 Ticket 只修正文档真相，不改写历史 Ticket 已发生的实现与验收记录。
