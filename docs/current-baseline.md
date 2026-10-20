# 当前能力与源码导航

源码导航复核日期：2026-10-19；页面分区、导航与三本投资账的职责入口已随本次实现更新。验证结果以本次交付说明或获授权的提交正文为准，不继承旧基线验收。阅读顺序与文档效力见 [文档入口](README.md)。

本项目是本地优先、单所有者、只读的个人资产看板。产品边界、金额、本金、来源账本与历史口径以 [CONTEXT](../CONTEXT.md) 和 [有效 ADR](adr/) 为准，本文只维护职责摘要与源码导航。

## 页面职责

| 页面 | 当前职责 | 源码入口 |
| --- | --- | --- |
| `/` 总览 | 总资产、今日变化、默认全部历史的完整趋势；按原币种展示三本账的本金与收益；按来源分布保留各来源总额、较昨日变化与昨日金额 | [页面](../src/app/page.tsx) / [DailyOverviewWorkspace](../src/ui/daily-overview-workspace.tsx) |
| `/assets` 资产 | “持仓”标题区提供“新增来源”，点击持仓中的账户名查看来源余额、趋势与连接信息；`?view=sources` 的“账户与来源”集中展示来源总额、连接与同步状态、接入、诊断和历史覆盖 | [页面](../src/app/assets/page.tsx) / [AssetsHoldingsWorkspace](../src/ui/assets-holdings-workspace.tsx) |
| `/performance` 投资账本 | 美股、A股、虚拟货币三本账；分“收益表现 / 记账记录 / 账本管理”，视角切换之后保留待确认来源范围与旧资金核对；记录支持类型筛选与每页 20 条分页；A股更新资产，美股与虚拟货币沿用自动同步 | [页面](../src/app/performance/page.tsx) / [InvestmentBooksWorkspace](../src/ui/investment-books-workspace.tsx) |
| `/asset-sources` 兼容入口 | 认证后跳转 `/assets?view=sources` | [页面](../src/app/asset-sources/page.tsx) / [AssetSourceDirectory](../src/ui/asset-source-directory.tsx) |
| `/asset-sources/[id]` 来源详情 | 以来源真实名称为标题；“资产概况”展示来源余额、趋势并进入所属投资账，“连接与管理”维护名称、类别、授权及生命周期；手工来源可更新资产总额，资金统一在三本账维护 | [页面](../src/app/asset-sources/[id]/page.tsx) / [AssetSourceDetail](../src/ui/asset-source-detail.tsx) / [资产更新表单](../src/ui/source-investment-record-dialog.tsx) / [手工类别表单](../src/ui/source-manual-asset-class-form.tsx) |
| `/settings` 设置 | 分“偏好 / 安全 / 数据与维护”；行情与链上服务、备份及正式日结状态归入数据与维护 | [页面](../src/app/settings/page.tsx) |
| `/data-health` 兼容入口 | 认证后跳转账户与来源的历史覆盖区域 | [跳转入口](../src/app/data-health/page.tsx) |

主导航为总览、资产、投资账本；桌面设置位于侧栏底部，手机底栏展示四项。实现以 [WorkbenchShell](../src/ui/workbench-shell.tsx) 为准。正式日结不在首页展示，设置页与后台相关能力仍保留；不能按旧规格把首页日结面板恢复。

## 其他实现入口

- 锁定与演示入口在 [首页路由](../src/app/page.tsx)。`/?mode=demo` 使用固定虚构数据，路由在进入所有者服务之前处理演示分支。
- 统一刷新从 [AssetRefreshProvider](../src/ui/asset-refresh-provider.tsx)、[Coordinator](../src/ui/asset-refresh-coordinator.ts) 沿 [刷新接口](../src/app/api/asset-sources/refresh/route.ts) 追踪到 [服务端刷新状态](../src/server/asset-refresh-state.ts) 和 [SQLite 周期状态](../src/server/persistence/sqlite-refresh-state-store.ts)。客户端共享状态与服务端并发控制需一并核对，不能照历史轮询计划重建刷新逻辑。
- 长桥生产读取与身份绑定的职责见 [服务生命周期](operations/service-composition.md)；安装与启动约束见 [工具链](operations/toolchain.md)。
- 三本账的归属、历史衔接和旧资金核对见 [ADR-0007](adr/0007-unify-investment-books.md)；计算入口为 [investment-books](../src/domain/investment-books.ts)，持久化与惰性迁移入口为 [SQLite 账本存储](../src/server/persistence/sqlite-investment-book-store.ts)，写入口为 [账本接口](../src/app/api/investment-books/route.ts)。业务备份包含已建立的规范账本及旧原件，单纯导出不触发迁移。
- 财务趋势共用 [AssetTrendPanel](../src/ui/asset-trend-panel.tsx) 的区间、自定义日期、实际记录覆盖与图表状态；首页、投资账、来源详情默认全部历史，指标与数据口径由各页提供。证券行情 K 线独立，不在此控件范围内。
- 视觉规则维护在 [DESIGN](../DESIGN.md) 和 [设计系统](design-system/README.md)，复用现有 Vibe 组件与 Token，不从旧规格提取字号、字体或页面布局。

## 任务与验证边界

待跟进事项统一见 [未完成事项](backlog.md)，执行前核对当前实现。自动同步沿用现有只读链路；本次本地验证不等同于真实供应商接口或部署验收。

组合趋势写入门槛存在文档与实现差异：`CONTEXT.md` 要求自动来源整批成功，当前记录器允许部分成功后记录观测；差异与确认范围见 [待核定事项](backlog.md#组合趋势写入合同与实现核定)。本次未改变口径。

历次测试命令、通过数量、真实来源确认和交付限制保存在 [审查与验收索引](audits/README.md)，原 2026-10-02 基线完整保留为 [历史基线记录](audits/baseline-2026-10-02.md)。它们不能证明当前版本已全量通过，也不能作为本次执行、提交或部署授权。

页面职责和源码入口改变时更新本文；业务合同或运行行为改变时，同次更新所属现行文档。新的验证结果记录在获授权的提交正文中，必要时才保留带日期的验收报告，不把历史计数累积成“当前已通过”声明。
