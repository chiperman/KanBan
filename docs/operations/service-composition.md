# 生产服务生命周期

- `composition.ts` 的进程级槽保存服务。重复请求及兼容模块重载复用同一对象；独立 CLI 进程拥有自己的服务。
- `production.ts` 只组装端口；`persistence/` 持有数据库、迁移和适配器，`credentials/` 保存秘密与所有者认证，`source-connections.ts` 协调授权与业务状态。旧公开导出继续兼容。
- SQLite 实例独占其连接，启动依次设置 PRAGMA、Schema 迁移、完整性校验和权限收紧。旧 JSON 不在运行时导入；需要迁移时单独执行 `pnpm migrate:json-to-sqlite`，迁移入口会校验目标库为空并保留源文件备份。Schema 模块借用该连接和事务，不自行连接。初始化失败关闭连接；正常连接与服务同寿命，由进程退出回收。
- 秘密恢复在读取来源引用后执行；ReadySecretStore 和来源连接等待同一恢复 Promise，失败向调用者传播。
- 长桥生产数据读取统一使用已登录的 CLI/serve：资产与报价刷新、授权后账户预览、指数、持仓 K 线、近五日走势和正式日结行情均不回退到 Keychain SDK。Keychain 仍负责现有 OAuth 授权与本地来源身份绑定；账户读取会前后核对 CLI 身份，失败保留上次资产快照。
- 修改服务端口、缓存格式或底层存储实现后应重新启动应用。兼容热更新用于已有服务的复用，不保证替换进程中已存在的类实例。
- 离线生命周期测试使用临时目录，覆盖新进程、模块重新求值、重复获取和重启数据保留；CLI 测试单独验证命令入口。历史验证只对应其提交与运行范围，不能代替当前真实服务器验收。

## 正式日结

- [日结执行器](../../src/server/formal-daily-settlement.ts) 使用独立只读采集与持久化，不调用实时刷新的记录写入路径，不改写实时资产快照、当日基准或每日趋势观测。
- 持有证券时按相关市场交易日历及已确认的常规盘日 K 收盘确定锚点；无证券时使用上海自然日加密资产截点。休市、半日市与夏令时不能由固定钟点代替。
- 每个锚点只保存一批记录；[SQLite 写入](../../src/server/persistence/sqlite-formal-settlements.ts) 通过唯一键忽略重复插入，重复运行或进程重启不能覆盖既有金额。窗口外记录漏采，不用后续持仓、价格或汇率补造历史总额；证据不足明确降级。
- [CLI](../../scripts/run-formal-daily-settlement.ts) 与页面使用同一服务装配和 `KANBAN_DATA_DIR`。本机 [launchd 管理脚本](../../scripts/formal-daily-settlement-launchd.mjs) 的安装、启停不是构建或启动页面的副作用，需明确操作授权。
- 设置页的 [调度状态读取](../../src/server/formal-settlement-scheduler.ts) 只查询本实例配置与加载证据，不安装任务、不采集资产，也不把“已加载”解释为采集健康或真实验收通过。未完成事项见 [待办](../backlog.md)。
