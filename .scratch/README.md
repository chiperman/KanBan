# 本地规格与 Issue 索引

本目录只保存需要进入版本控制的规格、Ticket、调研和验收记录，不存放临时脚本、日志、截图或上游文件副本。

## 目录结构

```text
.scratch/
  README.md
  active/<feature-slug>/
    spec.md
    map.md
    issues/NN-<slug>.md
    research/
  archive/<feature-slug>/
    ...
```

- `active/`：包含未关闭 Ticket，或仍需核对执行状态的规格；不表示所有文件都待实施，也不表示某个 Agent 当前仍在执行。
- `archive/`：Ticket 已关闭或被替代的完整功能记录；仍可作为当前实现的规格依据，归档不代表真实账户验收、全仓回归或部署通过。
- `spec.md`、`map.md` 和 `research/` 按需创建，不为了统一结构添加空文件。
- 临时产物使用仓库已忽略的 `tmp/scratch/<topic>/`；正式自动化才进入 `scripts/`。本地 Agent 记忆不属于 Issue，也不进入版本控制。

## 当前需跟进的入口

以下是 2026-10-18 整理时按原文件状态生成的导航，不是重新验收结果。后续以 Ticket 正文的 `Status:` 为准。

| 功能 | 未关闭 Ticket / 待核对规格 |
| --- | --- |
| 正式日结市场发现 | [01 刷新调度的市场证据](active/formal-settlement-market-discovery/issues/01-refresh-scheduling-market-evidence.md)（`needs-triage`） |
| 正式日结可观测性 | [01 状态与执行](active/formal-settlement-observability/issues/01-status-and-execution.md)（`ready-for-human`） |
| 证券收盘与跨资产日结 | [规格](active/market-close-daily-settlement/spec.md)（`ready-for-agent`，本次未核对实现进度） |
| 原资产看板 | [18 跨来源验收](active/personal-asset-dashboard/issues/18-cross-source-release-acceptance.md)、[28 CEX 当前总额估值](active/personal-asset-dashboard/issues/28-complete-cex-current-total-valuation.md)（均为 `ready-for-human`） |
| 项目健康优化交付 | [17 集成保护与 P2 边界](active/project-health-hardening-delivery/issues/17-repair-integration-protection-and-p2-boundary.md)（`claimed`，仅保留原记录，不推断仍在执行） |
| 工作台迁移收尾 | [01 手工来源分类入口](active/workbench-migration-cleanup/issues/01-restore-manual-source-class-control.md)（`needs-triage`，本次未重新审定） |

原资产看板的规格虽已被替代、健康优化父规格虽标为已解决，仍不能覆盖各自未关闭的 Ticket，因此这两个功能整体留在 `active/`。

## 归档导航

| 功能 | 规格 / 历史入口 |
| --- | --- |
| 个人资产看板重构 | [规格](archive/personal-asset-dashboard-rebuild/spec.md) / [地图](archive/personal-asset-dashboard-rebuild/map.md) |
| 资产管理工作台 | [规格](archive/asset-management-workbench/spec.md) |
| 资产刷新重设计 | [规格](archive/asset-refresh-redesign/spec.md) |
| 资产趋势图 | [规格](archive/asset-trend-chart/spec.md) |
| Binance 理财覆盖 | [规格](archive/binance-complete-investment-coverage/spec.md) |
| 投资分析运营台 | [已被替代的规格](archive/investment-performance-console/spec.md) |
| Lido 提现申请 | [规格](archive/lido-withdrawal-positions/spec.md) |
| Lista slisBNB 提现申请 | [规格](archive/lista-slisbnb-withdrawal-positions/spec.md) |
| 项目健康优化原审查 | [历史规格](archive/project-health-hardening/spec.md) |
| 证券行情交易时段 | [规格](archive/securities-quote-session-display/spec.md) |

部分旧规格顶部仍保留当时的 `ready-for-agent` 或 `proposed`。目录分类依据其 Ticket 与替代关系，不批量改写历史状态、日期和验收声明。

## 维护规则

1. 新功能统一建立在 `active/<feature-slug>/`，名称使用小写英文和连字符，不在根目录散放文件。
2. 每个 Ticket 独立保存为 `issues/NN-<slug>.md`，编号从 `01` 开始；不合并旧 Ticket，不因整理目录关闭任务。
3. 所有 Ticket 关闭且没有仍待实施或待确认的范围后，才把整个功能目录移到 `archive/`；被替代的规格需保留替代关系。状态冲突时先留在 `active/` 核对。
4. 恢复归档功能时先整体移回 `active/`，不要复制出第二套规格与状态。
5. 移动时同步 Markdown 链接、反引号中的路径和外部引用；旧证据即使对应代码已退役，也保留原指向，不伪造新验收。
6. 清理临时产物前确认没有正式引用；有价值的本地证据先做可校验备份，不依赖废纸篓恢复。

Ticket 状态、认领和 Wayfinding 的完整约定见 [Issue 跟踪器](../docs/agents/issue-tracker.md)。
