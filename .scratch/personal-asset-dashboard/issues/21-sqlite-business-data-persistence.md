# 21 — SQLite 业务数据持久化

**What to build:** 用结构化、事务化的 SQLite 存储替换当前整文件 JSON 业务数据库，承载资产卡片、资产来源、当前快照、每日快照和来源生命周期，同时保留未来迁移 PostgreSQL 的清晰 seam。

**Blocked by:** None

**Priority:** P0

**Status:** ready-for-agent

- [ ] 生产环境不再把 `data/dashboard.json` 作为业务数据真相源；资产卡片、来源、当前快照和每日快照由 SQLite 读取和写入。
- [ ] 保持现有 `AssetCardStore`、`AssetSources`、`DailyAssetSnapshots` 和 `AssetSourceLifecycle` 接口，使用 SQLite adapter 替换文件实现，不把数据库细节泄露给页面和来源 adapter。
- [ ] 连接来源、保存凭证引用、写入资产卡片和首份快照在一个事务中完成；失败不得留下半连接来源、孤立卡片或部分快照。
- [ ] 每日快照以“上海日期 + 来源”为唯一约束，重复同步保持幂等；来源更新和生命周期操作具备事务保障。
- [ ] 首次启动能够一次性导入现有 `dashboard.json`；导入成功后保留权限为 `0600` 的只读备份，并用迁移标记保证不会重复导入。
- [ ] 导入前后资产来源、持仓、估值、快照、布局、隐藏状态和断开状态保持一致；旧 `cards.json` 只作为兼容输入，不继续参与运行时写入。
- [ ] API Key、OAuth Token、Passkey、恢复认证材料和加密密钥不得进入 SQLite；长桥 Token 继续留在 macOS Keychain，其他平台凭证继续通过独立 `SecretStore` 引用。
- [ ] SQLite 启用外键、合适的事务模式和完整性检查；损坏或迁移失败时停止启动并给出可恢复错误，不静默生成空数据库。
- [ ] 测试覆盖空库启动、JSON 导入、重复导入、事务回滚、并发写入、每日快照幂等、来源断开和永久删除。

## 审查证据

- 2026-07-27：`FileDashboardDatabase` 的每次 mutation 都会读取、解析并完整重写 `dashboard.json`，并发控制只存在于单个 Node 进程内。
- 每日快照会持续增长，继续使用整文件写入将增加写放大、并发丢失更新和故障恢复风险。

## 评论

- 本 Ticket 是存储实现替换，不改变个人资产看板的产品范围，也不顺手引入远程数据库或多用户能力。
