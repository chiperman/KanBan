# 22 — 本地数据文件权限硬化

**What to build:** 统一收紧个人资产看板本地数据目录和认证相关文件权限，修复不同写入路径依赖默认 umask、导致文件可能被同机其他账户读取的问题。

**Blocked by:** None

**Priority:** P0

**Status:** resolved

- [x] `data/` 目录在创建和启动检查后权限为 `0700`。
- [x] Dashboard/SQLite、遗留 JSON、SecretStore、所有者 Passkey 凭证和恢复认证文件权限统一为 `0600`。
- [x] 临时文件、迁移备份和原子替换后的目标文件继承相同的受限权限，不因 rename 或默认 umask 放宽。
- [x] 应用启动时检查并修正已有文件权限；修正失败时给出明确错误，不继续以不安全权限运行。
- [x] 权限硬化不得修改、输出、清空或重新生成任何现有凭证和资产数据。
- [x] 使用临时目录的自动化测试覆盖首次创建、已有宽松权限修正、原子写入和修正失败路径。

## 审查证据

- 2026-07-27 实机只读检查：`dashboard.json` 与 `secrets.json` 为 `0600`，但 `cards.json` 与 `owner-credential.json` 为 `0644`。
- `FileOwnerCredentialStore` 和 `FileOwnerRecoveryCredentialStore` 写入时没有显式指定文件 mode。

## 评论

- 所有者公钥本身不是平台密钥，但认证元数据和遗留资产文件仍应遵循个人资产看板的本地私密默认值。
- 2026-07-28：统一本地数据权限边界；启动递归修正目录与已有数据文件，Dashboard、SecretStore、Passkey 和恢复认证写入统一使用 `0600` 原子替换，失败时拒绝继续。
- 自动化验收：`pnpm typecheck` 通过；权限用例连续 10 轮共 40/40 通过；`pnpm test` 构建成功且 107/109 通过，剩余两条既有锁定页测试把合法显示的上海当前时间误判为资产快照时间，本 Issue 未修改相关页面、时钟或断言。
