# 项目健康优化：已确认的执行 Ticket 索引

Status: resolved
Approved: 2026-09-10

本目录将原审查的 11 个主题细化为 16 个独立执行 Ticket。所有者确认切片后，已进一步授权实施与本地提交；最终结果见交付报告。原规格和原主题 Ticket 作为父级历史资料保留；2026-10-02 已补齐到本目录的映射并关闭重复父级待办。交付结果与验收边界以本目录为准，不重复执行旧主题。

[原项目健康度规格](../project-health-hardening/spec.md)

## 范围与排程

每个 Ticket 完整交付自身的外部可验证结果，并覆盖该结果实际涉及的层级。未涉及 UI 的 CLI、脚本或重构任务无需制造界面改动。

以下编号固定对应已批准方案；阻塞仅表示真实前置交付。建议晚做、共享文件或同属一个父级主题均不构成硬依赖。14、15 属后续重构，应避免与高优先级修复争用同一区域，但没有额外阻塞边。

## Ticket 索引

| Ticket | 阻塞 | 阶段 | 父级主题 |
| --- | --- | --- | --- |
| [01 补齐默认测试入口](issues/01-complete-default-tests.md) | 无 | 立即处理 | [原 01](../project-health-hardening/issues/01-complete-default-test-collection.md) |
| [02 恢复正式日结 CLI 启动](issues/02-restore-settlement-cli.md) | 无 | 立即处理 | [原 02](../project-health-hardening/issues/02-restore-formal-settlement-cli.md) |
| [03 完整备份与恢复业务历史](issues/03-complete-backup-roundtrip.md) | 无 | 立即处理 | [原 03](../project-health-hardening/issues/03-complete-business-backup-roundtrip.md) |
| [04 Passkey 挑战单次消费](issues/04-consume-passkey-challenges.md) | 无 | 立即处理 | [原 04](../project-health-hardening/issues/04-consume-webauthn-challenges-once.md) |
| [05 认证 Cookie 传输约束](issues/05-secure-auth-cookie-transport.md) | 无 | 立即处理 | [原 04](../project-health-hardening/issues/04-consume-webauthn-challenges-once.md) |
| [06 依赖公告核验与定向修复](issues/06-fix-dependency-advisories.md) | 无 | 立即处理 | [原 05](../project-health-hardening/issues/05-triage-and-fix-dependency-advisories.md) |
| [07 验证并声明支持的工具链](issues/07-declare-verified-toolchain.md) | 02 | 立即处理 | [原 11](../project-health-hardening/issues/11-declare-supported-toolchain.md) |
| [08 单日观测更新避免扫描全部历史](issues/08-bound-single-day-observation-write.md) | 无 | 本迭代处理 | [原 06](../project-health-hardening/issues/06-bound-history-read-work.md) |
| [09 来源详情按需读取](issues/09-bound-source-detail-reads.md) | 无 | 本迭代处理 | [原 06](../project-health-hardening/issues/06-bound-history-read-work.md) |
| [10 正式日结历史批量读取](issues/10-batch-formal-settlement-history.md) | 无 | 本迭代处理 | [原 06](../project-health-hardening/issues/06-bound-history-read-work.md) |
| [11 合并会话活动通知](issues/11-coalesce-session-activity.md) | 无 | 本迭代处理 | [原 07](../project-health-hardening/issues/07-coalesce-session-activity.md) |
| [12 修正命令菜单键盘目标](issues/12-correct-command-keyboard-target.md) | 无 | 本迭代处理 | [原 08](../project-health-hardening/issues/08-fix-command-menu-keyboard-target.md) |
| [13 原生产物构建与启动分离](issues/13-separate-native-build-and-start.md) | 07 | 后续重构 | [原 10](../project-health-hardening/issues/10-separate-native-build-from-start.md) |
| [14 提取持久化与迁移职责](issues/14-extract-persistence-and-migration.md) | 无 | 后续重构 | [原 09](../project-health-hardening/issues/09-split-production-responsibilities.md) |
| [15 提取凭证与来源连接职责](issues/15-extract-credentials-and-connections.md) | 无 | 后续重构 | [原 09](../project-health-hardening/issues/09-split-production-responsibilities.md) |
| [16 收敛生产服务装配](issues/16-compose-extracted-production-services.md) | 14, 15 | 后续重构 | [原 09](../project-health-hardening/issues/09-split-production-responsibilities.md) |

## 阻塞图

仅有以下硬依赖：

- 02 → 07：完整工具链承诺需要正式日结 CLI 已可启动。
- 07 → 13：原生产物兼容检查使用已验证的运行环境契约。
- 14、15 → 16：最终装配依赖两个已提取职责模块。

初始无硬阻塞：01—06、08—12、14、15。03、04、06 为优先处理的安全/数据项；01、02 为低成本独立修复。05 同属立即处理；07 在 02 完成后推进。08—12 本迭代处理；13—16 后续重构。

## 父级范围映射

- 原 01 → 执行 01；原 02 → 执行 02；原 03 → 执行 03。
- 原 04 → 执行 04、05；原 05 → 执行 06；原 11 → 执行 07。
- 原 06 → 执行 08、09、10；原 07 → 执行 11；原 08 → 执行 12。
- 原 10 → 执行 13；原 09 → 执行 14、15、16。

## 共同验收与授权边界

复用现有浏览器/HTTP 入口；CLI 使用独立子进程，恢复使用临时 SQLite，性能使用合成历史前后对照。没有新增真实账户验收承诺；敏感数据、平台调用、构建与共享开发产物需保持隔离。

每项实施前重新核对父级问题是否仍存在，并按原请求给出最小变更方案与涉及文件。后续“继续提交”“继续直到全部完成”已授权实施与本地原子提交；未授权推送、部署或真实账户操作。

后续必要预重构仅服务于具体切片，并在该切片行为变更前完成；不将大型拆分作为紧急修复前置。14、15 保留接口并接入实际生产路径，每步可验收；16 在二者交付后收敛，不采用全仓同时破坏式切换。

原主题的阶段性“等待修复稳定”是排程建议；本执行图按本轮已确认的真实阻塞关系细化。原规格保留审查时的编号和说明，不据此给本目录增加未经确认的依赖。

## 评论

- 2026-09-10：所有者回复“确定”，确认 16 个切片和阻塞关系。新增本执行索引及 16 份独立 Ticket，全部 ready-for-agent。

## 最终进度（2026-09-19）

已确认的 01—16 均已完成实现及范围内定向验收，并本地提交。立即处理 7/7，本迭代处理 5/5，后续重构 4/4。全仓浏览器门禁仍有失败，详见下列证据。

- [交付报告](delivery-report.md)：01—16 实现、提交、测试和性能测量。
- [全量回归对照](regression-baseline.md)：保留基线失败及偶发差异，不能据此宣称全仓全绿。
- 17 是此前独立集成保护记录，不属于本索引 16 个切片；保留未经复核的历史验收。
