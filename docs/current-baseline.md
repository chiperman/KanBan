# 个人资产看板当前基线

更新时间：2026-10-02

本文是现役能力、验证范围和后续工作的入口。历史验收按发生日期解读，不代表当前全仓回归、真实账户或部署已通过。

## 当前能力与约束

- 本地优先、单所有者、只读资产看板；认证后包含总览、资产与持仓、收益分析、资产来源、设置与安全五个入口。数据健康并入资产来源，旧 `/data-health` 跳转到来源页面。
- 锁定页仅提供身份验证与演示入口；`/?mode=demo` 使用进程内固定虚构数据，不初始化所有者服务、不请求真实资产接口、不落盘。
- 现有来源包括长桥、Binance、OKX、Bitget、BIT、Ethereum 与 BNB Smart Chain 观察钱包、手工资产记录。它们是否能访问真实平台须独立验收，代码接入不等于账户可用。
- 不提供交易、划转、提现、钱包签名、私钥或助记词收集，也不提供多用户、公开注册或公开资产分享。已接入的协议仓位范围以来源 Adapter 为准，不宣称全量 DeFi 覆盖。
- 长桥生产资产、行情、K 线与日结读取统一使用 CLI/serve；Keychain 负责 OAuth 与身份绑定，不作生产数据读取回退。详见 [服务生命周期](operations/service-composition.md)。
- 金额、本金、来源账本、历史汇率与观测完整性遵循 [CONTEXT](../CONTEXT.md) 和 [ADR](adr/)。本轮整理没有修改这些业务规则。

## 当前界面与兼容数据

- 首页使用 `DailyOverviewWorkspace` 展示总额、今日变化、本金收益、近 7 日趋势和来源摘要；来源接入为独立页面，手工资产记录在来源详情维护。
- 旧 `TotalAssetOverview`、`FormalDailySettlementSummary`、`HeaderUtilities` 与卡片拖拽编辑器已无生产调用，本轮删除其实现和专用拖拽依赖，不恢复旧卡片拼贴。
- 资产卡片布局元数据仍保留排序、1/2/3 格宽度、隐藏与强制换行；布局接口、旧数据解析、SQLite 和无凭证备份继续保存、恢复和校验。删除 UI 不等于删除历史数据。
- 正式日结不再展示在首页；后台采集、不可变日结记录、备份与设置页调度状态继续保留。
- 统一刷新保持服务端周期预占和客户端共享状态，页面重载不能绕过在途全量刷新；单来源刷新不改变统一周期。
- 视觉系统以 [DESIGN](../DESIGN.md) 固定版本为准，使用现有 Vibe 模块与 Token。运行时字体为 Doto、Geist、Geist Mono、Newsreader Italic；旧 Space Grotesk/Space Mono 和三列卡片描述不是现行合同。

## 本轮整理与验证（2026-10-02）

- 修改前已复现两条旧浏览器断言失败：仍寻找旧总览元素。总览测试现覆盖桌面/手机查看、隐私重载、来源详情导航和旧布局入口不回归。
- 手工资产测试迁移至独立接入和来源详情，保留每日唯一、历史编辑删除回退、默认币种、非法输入、手工来源不可刷新/断开、低频趋势和不写入合成记录等断言。
- 拖拽命中、预览等退役实现专用测试随实现移除；新增布局元数据校验、HTTP 权限与拒绝非法写入、SQLite 重新打开及备份恢复验证。测试数量下降不代表关闭保留能力的验收。
- 分类接口继续测试金额与完整性不变；原币种分布守恒由领域测试承接。当前没有页面分类入口，见下方待办，不能把接口测试写成 UI 已通过。
- `pnpm exec tsc --noEmit --incremental false`、`pnpm test:unit` 261/261、离线冻结安装、隔离目录生产构建均通过。原 263 项单测退役 7 项专用拖拽算法测试，新增 4 项布局兼容测试和 1 项分类分布守恒测试。
- 同一轮 51 项浏览器回归全部通过，覆盖刷新、布局兼容、演示隔离、日结后台/设置、计数器、手工资产/币种/历史汇率和工作台导航；其中包含默认 smoke 的全部用例。另行生产模式测试接口隔离 1/1 通过，不合并成一轮 52 项。
- 首次扩大回归为 50/51：保存历史记录后的页面重读与币种选项点击发生竞争。测试改为等待最新记录出现再操作，失败用例连续 5/5 通过后重新执行整组，取得上述 51/51；没有添加重试或跳过测试。
- 受控浏览器只使用测试替身、虚构数据和虚拟认证器；生产入口检查使用隔离目录。未访问真实账户、真实凭证或操作本机正式日结任务。

复现本轮浏览器范围（先设置独立 `NEXT_DIST_DIR` 并构建，再设置空闲的 `PLAYWRIGHT_TEST_PORT`）：

```sh
pnpm exec playwright test e2e/smoke/asset-refresh-workbench.spec.ts \
  e2e/archive/card-layout-responsive.spec.ts e2e/archive/demo-mode.spec.ts \
  e2e/smoke/formal-daily-settlement.spec.ts e2e/archive/live-counter.spec.ts \
  e2e/archive/manual-asset-exchange-rate-snapshots.spec.ts \
  e2e/archive/manual-asset-records.spec.ts e2e/archive/manual-record-currency.spec.ts \
  e2e/smoke/overview-layout-mode.spec.ts e2e/smoke/workbench-shell-navigation.spec.ts
```

源码、范围内浏览器路径与文档为 `changed-and-verified`；现役 Agent 规则只读核对，未修改；记忆为生成只读资料；部署、真实账户与全仓浏览器为 `out-of-scope`。本轮交付仅包含本地提交，不推送或部署。隔离构建产物、测试结果与临时证据保留供复核，不计入 Git；本轮生成的 `tsconfig.json` include 路径已移除。Node 类型转换实验性提示与 ESM 模块类型提示仍保留，未为消除提示改变运行方式。

## 待处理事项

1. [手工来源资产类别页面入口](../.scratch/workbench-migration-cleanup/issues/01-restore-manual-source-class-control.md)：接口与持久化存在，旧来源管理弹窗退役后缺少现役编辑入口。
2. [正式日结新增市场发现](../.scratch/formal-settlement-market-discovery/issues/01-refresh-scheduling-market-evidence.md)：旧快照可能让后续定时执行错过新增市场窗口；本轮未修复，也未重新执行其隔离复现。
3. 剩余浏览器测试迁移：部分平台接入、旧总览趋势与旧管理弹窗断言仍在其他文件中。全量历史失败见 [2026-09-19 对照](../.scratch/project-health-hardening-delivery/regression-baseline.md)，不能据本轮定向回归宣称全部解决。
4. CSS 多轮覆盖与来源账本接口收敛属于后续局部重构；本轮不修改 CSS、数据库 schema 或金融计算。
5. [执行记录 17](../.scratch/project-health-hardening-delivery/issues/17-repair-integration-protection-and-p2-boundary.md) 是独立的旧集成保护记录，仍需核对历史现场，不随父级健康主题批量关闭。
6. 真实来源失败恢复/断开、真实设置页与调度运行、远程 CI、部署和完整人工视觉均不在本轮验收范围。

## 文档与 Ticket 导航

| 入口 | 职责 |
| --- | --- |
| [CONTEXT](../CONTEXT.md) / [ADR](adr/) | 领域词汇、财务口径与不可突破的产品约束 |
| [DESIGN](../DESIGN.md) | 固定上游视觉契约及运行时集成 |
| [工作台重构规格](../.scratch/personal-asset-dashboard-rebuild/spec.md) | 当前工作台范围与重构 Ticket |
| [健康优化执行索引](../.scratch/project-health-hardening-delivery/spec.md) | 16 项已交付工作的单一执行状态，保留验收限制 |
| [健康优化原规格](../.scratch/project-health-hardening/spec.md) | 2026-09-10 审查背景；11 个父级主题已映射归档，不重复实施 |
| [真实来源验收 Ticket](../.scratch/personal-asset-dashboard/issues/18-cross-source-release-acceptance.md) | 后续真实只读账户与跨来源验收的待确认项 |
| [工具链](operations/toolchain.md) / [服务生命周期](operations/service-composition.md) | 安装、构建、启动与持久化生命周期 |

代码与文档冲突时先核实当前实现和业务合同，不用历史 UI 或测试断言恢复已退役功能。历史事实保留原日期，新故障独立记录，不重新打开已完成的父级优化主题。

## 历史证据（不作为本轮通过声明）

- 2026-08-06 旧基线记录所有者确认：长桥、Binance、OKX、Bitget、Ethereum/BNB Smart Chain 已完成连接、持仓查看与单来源刷新；真实硬件 Passkey 已完成登录、退出与刷新后锁定验收。未记录认证材料。跨来源失败恢复与断开仍待确认，本轮未重新核验这些真实平台事实。
- 2026-08-20 所有者恢复零落盘演示模式，取代更早“完全移除演示入口”的阶段方案。
- 2026-09-10 集成记录：单元测试 83/83；105 项组合浏览器首轮 103 通过、2 失败，修正后仅定向复跑，两次结果未拼成全量全绿。原记录还包含日结汇率和旧界面断言失败，后续处理以相应 Ticket 为准。
- 2026-09-19 健康优化 16 项范围内交付完成。单元测试 155/155；全仓浏览器当时仍有失败，参见 [交付报告](../.scratch/project-health-hardening-delivery/delivery-report.md)。其中依赖公告归零是当日审计快照，不是当前安全保证；本轮未重新访问漏洞数据库。

## 更新条件

- 每次范围内回归后更新实际命令、结果及未执行项，不沿用旧计数。
- 领域含义或产品范围改变时先更新 CONTEXT、ADR 与相关 Ticket；视觉契约改变时按 DESIGN 的固定版本流程核对。
- 真实平台与设备验收仅记录实际观察结果，不能由测试替身、构建或类型检查代替。
