# 浏览器全量回归基线对照（2026-09-19）

基线 9328360。全量后另有定向修正和复验，未拼接成新的全量通过率。按文件与用例名称比较，忽略行号。

| 配置 | 旧基线 | 本轮全量原始结果 | 同名失败 |
| --- | --- | --- | --- |
| APP_ENV=test | 329：196 通过 / 133 失败 | 340：207 通过 / 133 失败 | 129 |
| production | 43：22 通过 / 21 失败 | 43：22 通过 / 21 失败 | 21，名称完全一致 |

## 差异及定向复验

- 新增旧备份确认和详情区间：初次因选择器失败，修正后 2/2 通过。
- 刷新可见性：旧夹具仅续期服务端，页面空闲一小时；修正为真实交互后两个统一周期用例 2/2 通过，保留 30 分钟锁定。
- 覆盖不完整展示：初次本轮失败、基线通过；独立重跑 1/1，随后本轮与基线各连续 5/5 通过。全量中的竞争或隔离根因尚未确定，保留待定位，不能宣称已修复。
- 迁移/生命周期夹具修正 1ee0bb9：旧 schema 移除 v18 两列，并提供合成 OAuth 配置；重新构建后 SQLite 持久化 29 项、无凭证备份恢复 8 项，共 37/37 通过。原始全量失败快照仍保留。
- 以下基线失败、本轮通过；其中多标签周期可能受时序影响，不能全归因为确定性修复：
  - e2e/owner-auth.spec.ts › 浏览器不支持 Passkey 时首次预置提供可执行的恢复说明
  - e2e/refresh-stale-data.spec.ts › 页面重载与多标签共享统一周期且到期只执行一轮 Adapter
  - e2e/command-menu-visual-language.spec.ts › 未认证状态无命令菜单，所有者可用 Command-K 与 Ctrl-K 前往工作台入口
  - e2e/formal-daily-settlement.spec.ts › 手工资产保留已知金额但不阻塞正式日结

## APP_ENV=test：129 个同名失败

以下为原始全量快照，后来定向修正的夹具仍列出。只证明基线也失败，不保证根因相同或业务正确。金额与完整性断言需单独排查，不改变业务口径迎合测试。

- e2e/manual-asset-records.spec.ts › 手工资产可在来源管理中设置资产类别并正确归入分布
- e2e/manual-asset-records.spec.ts › 手工资产来源在卡片内按上海自然日保存一条，并可在当天编辑总额
- e2e/manual-asset-records.spec.ts › 手工资产历史可编辑、删除，并回退到最新保留记录
- e2e/manual-asset-records.spec.ts › 低频手工记录不降低完整性，并按最近记录延用趋势金额
- e2e/manual-asset-records.spec.ts › 手工记录拒绝非法金额和非手工来源编辑，并在文件存储中覆盖当天记录
- e2e/overview-layout-mode.spec.ts › 总览仅保留日常查看和快捷控制，来源摘要不展开持仓或管理操作
- e2e/overview-layout-mode.spec.ts › 布局管理模式以键盘可达入口即时保存排序、宽度、换行和隐藏，并在重开后保持
- e2e/overview-layout-mode.spec.ts › 手机总览可明确进入和退出布局管理，且无横向溢出
- e2e/overview-layout-mode.spec.ts › 手机总览默认及布局管理时保留分布和趋势
- e2e/assets-holdings-workspace.spec.ts › 资产与持仓把来源总额与明细观察分层，不用持仓差额改写总额
- e2e/bit-source.spec.ts › BIT / Matrixport 同步异常时来源详情明确标记失败
- e2e/p1-ui-improvements.spec.ts › 看板时间、来源状态和普通卡片遵守 Vibe 视觉层级
- e2e/p1-ui-improvements.spec.ts › 中等宽度控制区保持横排，手机端才改为纵向堆叠
- e2e/card-layout-responsive.spec.ts › 三格资产卡片可缩小并放入两格卡片右侧空位
- e2e/p1-ui-improvements.spec.ts › 空状态说明在 Light 和 Dark 下保持正文级对比度
- e2e/card-layout-responsive.spec.ts › 同一行候选使用互不重叠的固定命中区域
- e2e/rebuild-overview-confidence.spec.ts › 总览以来源总额为真相，解释今日判断并收口至收益与来源
- e2e/card-layout-responsive.spec.ts › 拖动经过插入位置时兄弟资产卡片会在松手前实时让位
- e2e/rebuild-overview-confidence.spec.ts › 首页近 7 日趋势显示观测时保存的 CNY 和 HKD 金额
- e2e/card-layout-responsive.spec.ts › 向左拖动首次进入左侧插入位置时兄弟卡片平滑向右让位
- e2e/rebuild-overview-confidence.spec.ts › 完整日初基准与长桥参考汇率可计算 CNY 和 HKD 今日资产变化
- e2e/rebuild-overview-confidence.spec.ts › 正向今日资产变化也会跟随盈亏颜色设置
- e2e/card-layout-responsive.spec.ts › Escape 取消网格放置且不保存布局
- e2e/rebuild-overview-confidence.spec.ts › 总览保留过期来源总额，标明未估值与明细仅汇总而不制造对账异常
- e2e/card-layout-responsive.spec.ts › 键盘可以选择与指针相同的自适应缩小候选
- e2e/rebuild-release-acceptance.spec.ts › 全产品核心路径在三种宽度、浅深色与减少动态下保持可读、可导航且无控制台错误
- e2e/card-layout-responsive.spec.ts › 布局保存失败时恢复拖动前布局
- e2e/rebuild-return-analysis.spec.ts › 收益分析支持自定义起止日期，并按所选连续上海自然日解释区间
- e2e/card-layout-responsive.spec.ts › 拖拽说明 ID 在首次渲染和刷新后保持稳定
- e2e/rebuild-return-analysis.spec.ts › 收益分析按真实资产观测和资金账本解释收益，并支持安全维护历史记录
- e2e/card-layout-responsive.spec.ts › 未认证状态不能调整布局，所有者进入布局管理后可排序并调整资产卡片宽度
- e2e/card-layout-responsive.spec.ts › 旧高度数据不会撑大资产卡片，卡片高度始终跟随内容
- e2e/card-layout-responsive.spec.ts › 所有者通过卡片手柄排序并调整宽度后刷新仍保留布局
- e2e/card-layout-responsive.spec.ts › 所有者拖至末尾会强制从新行开始并在刷新后保留
- e2e/card-layout-responsive.spec.ts › 拖动末尾 Web3 ETH 卡片时新行预览紧接最后一张可见卡片
- e2e/card-layout-responsive.spec.ts › 卡片较多时可从视口顶部拖到页面底部新行
- e2e/card-layout-responsive.spec.ts › 手机端在明确进入布局管理后可用排序按钮立即保存
- e2e/card-layout-responsive.spec.ts › 手机端总资产默认展示分布和趋势
- e2e/card-layout-responsive.spec.ts › 桌面视口按同一桌面顺序自动重排并保持内容高度
- e2e/card-layout-responsive.spec.ts › 中等视口按同一桌面顺序自动重排并保持内容高度
- e2e/card-layout-responsive.spec.ts › 手机视口按同一桌面顺序自动重排并保持内容高度
- e2e/command-menu-visual-language.spec.ts › 已登录看板遵守 Nothing 字体层级、操作语义和点击区域
- e2e/responsive.spec.ts › 桌面宽度下无横向溢出且内容可访问
- e2e/responsive.spec.ts › 中等宽度下无横向溢出且内容可访问
- e2e/cross-source-release-acceptance.spec.ts › 六类来源形成正确总额、分布、真实稳定币价格与失败隔离
- e2e/responsive.spec.ts › 手机宽度下无横向溢出且内容可访问
- e2e/cross-source-release-acceptance.spec.ts › 完整锁定到所有者再锁定旅程不泄露敏感数据且不存在越界入口
- e2e/settings-security-consolidation.spec.ts › 设置与安全集中低频入口，计价货币属于总览且隐私开关全局可用
- e2e/daily-snapshots-asset-change.spec.ts › 今日资产变化使用昨日最后一条完整趋势快照，不依赖正式日结任务
- e2e/daily-snapshots-asset-change.spec.ts › 当天部分成功的资产总额会作为今日变化兜底
- e2e/settings-security-consolidation.spec.ts › 备份与恢复入口不回显外部来源凭证，且可用键盘预演恢复
- e2e/daily-snapshots-asset-change.spec.ts › 当天完整观测不会因后续刷新失败而失去资产变化
- e2e/daily-snapshots-asset-change.spec.ts › 缺少昨日观测时回退到最近完整记录，并明确累计间隔
- e2e/source-dialog-ui.spec.ts › 添加来源先选择类型再配置，返回保留草稿而取消会清空
- e2e/source-dialog-ui.spec.ts › 来源 Dialog 打开后捕获焦点，Escape 关闭并恢复触发按钮
- e2e/daily-snapshots-asset-change.spec.ts › 来源趋势位于总资产金额下方且先于持仓仪表
- e2e/source-dialog-ui.spec.ts › 验证只读凭证时明确显示进行态且禁用态不响应悬停
- e2e/daily-snapshots-asset-change.spec.ts › 同次观测可共享可靠汇率，不把来源单独缺少展示币种误判为不完整
- e2e/source-dialog-ui.spec.ts › 移动端来源配置采用全屏 sheet，页头设置操作收进本机设置
- e2e/daily-snapshots-asset-change.spec.ts › 北京时间日界线建立唯一基准，同日幂等且跨日不回填
- e2e/source-dialog-ui.spec.ts › 宽屏扩展来源工作区但约束总览阅读宽度
- e2e/daily-snapshots-asset-change.spec.ts › 同日后续成功刷新只更新每日趋势观测，失败保留最后观测并标明过期
- e2e/source-lifecycle.spec.ts › 所有者可自定义资产来源名称并清空恢复默认名称
- e2e/daily-snapshots-asset-change.spec.ts › 首轮部分失败不冻结日初基准，首次完整同步才建立
- e2e/source-lifecycle.spec.ts › 来源管理直接显示断开和永久删除操作
- e2e/daily-snapshots-asset-change.spec.ts › 未估值趋势不伪造零值，平台盈亏只出现在来源提供的范围
- e2e/source-lifecycle.spec.ts › 隐藏与恢复只改变卡片可见性，来源仍同步并计入总额与快照
- e2e/daily-snapshots-asset-change.spec.ts › 缺少可靠 HKD 汇率时趋势金额不可用且观测不完整
- e2e/source-lifecycle.spec.ts › 断开 EVM 观察钱包时保留公开地址配置、来源身份和已有快照
- e2e/daily-snapshots-asset-change.spec.ts › 历史 HKD 金额固定使用各自观测时汇率
- e2e/source-lifecycle.spec.ts › 已断开的 EVM 观察钱包恢复原卡片和历史
- e2e/daily-snapshots-asset-change.spec.ts › 期权行情未接入不降低每日总额观测完整性
- e2e/source-lifecycle.spec.ts › 原凭证不存在时重新输入相同公开地址，恢复原卡片和历史
- e2e/daily-snapshots-asset-change.spec.ts › 来源确认的首次可信快照先建基准，随后刷新全失败也不会丢失
- e2e/source-lifecycle.spec.ts › 重新添加相同公开地址时恢复原来源，不创建重复卡片
- e2e/daily-snapshots-asset-change.spec.ts › 同日新增来源从首次成功同步开始加入来源趋势但不改写总基准
- e2e/source-lifecycle.spec.ts › 不同公开地址不能替换旧来源
- e2e/daily-snapshots-asset-change.spec.ts › 总资产趋势默认展示 30 日连续直线、缺失提示与区间资产变动
- e2e/source-lifecycle.spec.ts › 其他来源次日成功同步时，不为已断开来源生成新快照
- e2e/daily-snapshots-asset-change.spec.ts › 趋势区间会记忆，且每日明细分页独立于图表区间
- e2e/source-lifecycle.spec.ts › 永久删除需要第二次确认，取消无变化，确认后清除来源及全部历史
- e2e/daily-snapshots-asset-change.spec.ts › 来源详情趋势跨过缺失日期连接已有观测
- e2e/source-list-detail-lifecycle.spec.ts › 资产来源统一列出自动账户、观察钱包和手工资产，并从总览摘要进入真实详情
- e2e/daily-snapshots-asset-change.spec.ts › 移动端可查看总资产每日观测明细且不产生横向溢出
- e2e/source-list-detail-lifecycle.spec.ts › 来源详情可以切换 USD、CNY 与 HKD 计价货币
- e2e/daily-snapshots-asset-change.spec.ts › 移动端来源摘要将变化置于当前金额下方且不横向溢出
- e2e/source-list-detail-lifecycle.spec.ts › 来源详情保留隐藏、断开、恢复与永久删除的确认保护
- e2e/daily-snapshots-asset-change.spec.ts › 移动端总资产趋势入口、键盘操作与窄屏图保持可访问
- e2e/data-health-diagnostics.spec.ts › 数据健康诊断同步、估值与历史缺口，但不提供修复操作
- e2e/source-onboarding-page-flow.spec.ts › 资产来源页通过独立步骤页完成只读验证、预览与保存，不泄露凭证
- e2e/source-onboarding-page-flow.spec.ts › 手工资产也通过独立流程创建，且不伪造凭证、持仓或同步
- e2e/data-health-diagnostics.spec.ts › 单来源刷新失败保留最后成功数据，并提供可理解的重试
- e2e/source-onboarding-page-flow.spec.ts › 观察钱包重新授权只接受同一公开地址，并保留来源、快照和卡片
- e2e/sqlite-business-data-persistence.spec.ts › 空库启动后由 SQLite 持久化业务数据
- e2e/sqlite-business-data-persistence.spec.ts › 首次启动完整导入 JSON 并保留私有备份
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v2 自动迁移并持久化 Binance 覆盖证据
- e2e/sqlite-business-data-persistence.spec.ts › 旧版 SQLite 原地升级保留业务数据且首次失败建立统一周期
- e2e/sqlite-business-data-persistence.spec.ts › 最后一个自动来源断开或删除会清理周期，重新连接重新建立
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v4 升级后分离日初基准与每日趋势观测并跨重启保留
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v6 升级后持久化 HKD 金额与观测时汇率
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v8 升级后可创建并记录手工资产来源
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v12 增量迁移保存资金账本且不改写资产观测
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v14 升级后保留旧分类未知，并跨重启持久化新分类趋势
- e2e/sqlite-business-data-persistence.spec.ts › SQLite schema v15 按来源类别回填历史证券与加密趋势
- e2e/sqlite-business-data-persistence.spec.ts › 资产来源自定义名称跨 SQLite 重启保留，清空后恢复默认
- e2e/sqlite-business-data-persistence.spec.ts › EVM 代币忽略与保留状态跨 SQLite 重启持久化
- e2e/sqlite-business-data-persistence.spec.ts › EVM 待确认代币跨 SQLite 重启持久化
- e2e/sqlite-business-data-persistence.spec.ts › 迁移标记阻止第二次导入旧 JSON
- e2e/data-health-diagnostics.spec.ts › 全局刷新成功后自动收起状态提示
- e2e/sqlite-business-data-persistence.spec.ts › 连接写入失败时不留下来源、卡片、快照或凭证
- e2e/sqlite-business-data-persistence.spec.ts › 每日快照按上海日期和来源保持幂等
- e2e/sqlite-business-data-persistence.spec.ts › 断开保留快照，永久删除清理全部来源业务数据
- e2e/sqlite-business-data-persistence.spec.ts › 删除非末位来源后仍可继续连接新来源
- e2e/demo-mode.spec.ts › 未登录可进入零落盘演示模式，且不请求或泄露真实资产数据
- e2e/valuation-distribution-truth.spec.ts › 总览隐藏关键数据时同时遮蔽总额、来源身份和同步状态
- e2e/ethereum-watch-wallet-production.spec.ts › Ethereum 余额失败只使该来源过期，BSC 继续当前且未认证状态收不到地址与资产
- e2e/valuation-distribution-truth.spec.ts › 期权行情缺失与明细仅汇总不会否定来源账户总额
- e2e/ethereum-watch-wallet.spec.ts › 待确认 EVM 资产在对应钱包的设置页中管理
- e2e/valuation-distribution-truth.spec.ts › 平台账户总额与持仓明细存在差异时，总览保留总额并在来源详情解释
- e2e/external-service-settings.spec.ts › 外部服务只在本机设置中加密配置，EVM 来源仅提示依赖
- e2e/workbench-display-preferences.spec.ts › 同一来源同步失败在总览、资产、来源列表和数据健康中使用一致口径
- e2e/foreground-control-layering.spec.ts › 总览裸页面上的次级控件遮住点阵，主刷新保持实心
- e2e/workbench-migration-acceptance.spec.ts › 既有自动来源、观察钱包与手工记录经工作台入口保持身份、持仓、趋势和只读授权
- e2e/live-counter.spec.ts › 资产数字复用 44 Live Counter 并保留财务格式
- e2e/workbench-migration-acceptance.spec.ts › 工作台在关键宽度下保持一致内容基线、可用宽度和无横向溢出
- e2e/workbench-migration-acceptance.spec.ts › 同级标准操作保持统一的 44px 高度和响应式宽度
- e2e/live-counter.spec.ts › 减少动态效果时直接显示最终数字
- e2e/locked-setup-accessibility.spec.ts › 所有者预置页在桌面提供合理正文宽度和可读反馈
- e2e/longbridge-source-loop.spec.ts › 长桥持仓刷新失败时保留最后成功数据并明确标记过期

## production：21 个同名失败

以下为原始全量快照，后来定向修正的夹具仍列出。只证明基线也失败，不保证根因相同或业务正确。金额与完整性断言需单独排查，不改变业务口径迎合测试。

- e2e/binance-source.spec.ts › 取消添加资产来源后再次打开时只读凭证字段为空
- e2e/binance-source.spec.ts › Binance 只读凭证先预览后原子保存，并展示现货、资金与 Earn 持仓
- e2e/binance-source.spec.ts › 重新验证同一 Binance 账户时替换凭证并保留原卡片
- e2e/binance-source.spec.ts › 已断开的 Binance 可直接恢复原卡片，不新增来源或删除凭证
- e2e/binance-source.spec.ts › 全局持仓搜索筛选 Binance 明细
- e2e/binance-source.spec.ts › Binance 写权限、缺失权限证明和原子保存失败均不留下来源或凭证
- e2e/binance-source.spec.ts › 生产 Binance 适配器只调用允许的读取端点并覆盖权限、分页、精度和未估值
- e2e/binance-source.spec.ts › Binance 默认隐藏低于 1 USDT 的持仓，并提供可见的手动展示控制
- e2e/binance-source.spec.ts › Binance 同步失败保留最后成功数据并接入过期状态和日快照
- e2e/binance-source.spec.ts › 未认证状态与生产测试替身都不能读取 Binance 私密来源或凭证
- e2e/bitget-source.spec.ts › Bitget 只读凭证先预览后原子保存，并展示现货、资金、Earn 与合约交易机器人持仓
- e2e/bitget-source.spec.ts › Bitget 写权限、确认前范围变化和保存失败均不留下来源或凭证
- e2e/bitget-source.spec.ts › 生产 Bitget Classic 适配器以账户分区守恒并覆盖 SharkFin 与 On-chain Elite
- e2e/bitget-source.spec.ts › Bitget 同步失败保留最后成功数据并接入过期状态和日快照
- e2e/bitget-source.spec.ts › 未认证状态与生产测试替身都不能读取 Bitget 私密来源或凭证
- e2e/okx-source.spec.ts › OKX 只读凭证先预览后原子保存，并展示现货、资金与 Earn 持仓
- e2e/okx-source.spec.ts › OKX 非纯 Read 权限、确认前权限变化和保存失败均不留下来源或凭证
- e2e/okx-source.spec.ts › 生产 OKX 适配器以平台总额守恒并覆盖 On-chain Earn P0 产品
- e2e/okx-source.spec.ts › OKX 确认前账户身份或范围漂移时拒绝保存
- e2e/okx-source.spec.ts › OKX 同步失败保留最后成功数据并接入过期状态和日快照
- e2e/okx-source.spec.ts › 未认证状态与生产测试替身都不能读取 OKX 私密来源或凭证

## 原始证据

本机临时目录（未纳入 Git，可能被系统清理）：

/var/folders/hh/cg4z8pk92z59lqmtrjqb385r0000gn/T/kanban-hardening-20260919-i5ok5arm

文件：baseline-browser.log、final-browser.log、baseline-production-browser.log、final-production-browser.log、suite-comparison.json、final-new-cases.log、final-refresh-corrected.log、final-coverage-repeat.log、baseline-coverage-repeat.log。
