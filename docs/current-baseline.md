# 当前能力与源码导航

源码导航复核日期：2026-10-18；对应代码基线：`dda468c`。本次仅核对文档和相关源码入口，未重新运行构建、自动化测试、真实账户或部署验收。阅读顺序与文档效力见 [文档入口](README.md)。

本项目是本地优先、单所有者、只读的个人资产看板。产品边界、金额、本金、来源账本与历史口径以 [CONTEXT](../CONTEXT.md) 和 [有效 ADR](adr/) 为准，本文只维护职责摘要与源码导航。

## 页面职责

| 页面 | 当前职责 | 源码入口 |
| --- | --- | --- |
| `/` 总览 | 总资产、今日变化、本金与收益、近 7 日趋势；资产分布保留各来源总额、较昨日变化与昨日金额 | [页面](../src/app/page.tsx) / [DailyOverviewWorkspace](../src/ui/daily-overview-workspace.tsx) |
| `/assets` 资产与持仓 | 查看、筛选持仓；保留手工及无持仓明细来源的“按总额记录的资产”，不再重复完整来源总额列表 | [页面](../src/app/assets/page.tsx) / [AssetsHoldingsWorkspace](../src/ui/assets-holdings-workspace.tsx) |
| `/performance` 收益分析 | 查看投资表现、外部资金流水与来源本金相关信息 | [页面](../src/app/performance/page.tsx) |
| `/asset-sources` 来源管理 | 来源接入、连接与同步状态、诊断和历史覆盖 | [页面](../src/app/asset-sources/page.tsx) / [AssetSourceDirectory](../src/ui/asset-source-directory.tsx) |
| `/asset-sources/[id]` 来源详情 | 查看来源详情，按来源类型维护相关记录与设置；手工来源包含资产类别表单 | [页面](../src/app/asset-sources/[id]/page.tsx) / [AssetSourceDetail](../src/ui/asset-source-detail.tsx) / [手工类别表单](../src/ui/source-manual-asset-class-form.tsx) |
| `/settings` 设置与安全 | 安全、备份与正式日结调度状态等设置 | [页面](../src/app/settings/page.tsx) |
| `/data-health` 兼容入口 | 认证后跳转来源管理的历史覆盖区域 | [跳转入口](../src/app/data-health/page.tsx) |

导航分组以 [WorkbenchShell](../src/ui/workbench-shell.tsx) 为准。正式日结不在首页展示，设置页与后台相关能力仍保留；不能按旧规格把首页日结面板恢复。

## 其他实现入口

- 锁定与演示入口在 [首页路由](../src/app/page.tsx)。`/?mode=demo` 使用固定虚构数据，路由在进入所有者服务之前处理演示分支。
- 统一刷新从 [AssetRefreshProvider](../src/ui/asset-refresh-provider.tsx)、[Coordinator](../src/ui/asset-refresh-coordinator.ts) 沿 [刷新接口](../src/app/api/asset-sources/refresh/route.ts) 追踪到 [服务端刷新状态](../src/server/asset-refresh-state.ts) 和 [SQLite 周期状态](../src/server/persistence/sqlite-refresh-state-store.ts)。客户端共享状态与服务端并发控制需一并核对，不能照历史轮询计划重建刷新逻辑。
- 长桥生产读取与身份绑定的职责见 [服务生命周期](operations/service-composition.md)；安装与启动约束见 [工具链](operations/toolchain.md)。
- 视觉规则维护在 [DESIGN](../DESIGN.md) 和 [设计系统](design-system/README.md)，复用现有 Vibe 组件与 Token，不从旧规格提取字号、字体或页面布局。

## 任务与验证边界

待跟进事项统一见 [未完成事项](backlog.md)，执行前核对当前实现。手工来源分类入口已存在，本次只确认源码入口，未完成其 UI 验收。

组合趋势写入门槛存在文档与实现差异：`CONTEXT.md` 要求自动来源整批成功，当前记录器允许部分成功后记录观测；差异与确认范围见 [待核定事项](backlog.md#组合趋势写入合同与实现核定)。本次未改变口径。

历次测试命令、通过数量、真实来源确认和交付限制保存在 [审查与验收索引](audits/README.md)，原 2026-10-02 基线完整保留为 [历史基线记录](audits/baseline-2026-10-02.md)。它们不能证明当前版本已全量通过，也不能作为本次执行、提交或部署授权。

页面职责和源码入口改变时更新本文；业务合同或运行行为改变时，同次更新所属现行文档。新的验证结果记录在获授权的提交正文中，必要时才保留带日期的验收报告，不把历史计数累积成“当前已通过”声明。
