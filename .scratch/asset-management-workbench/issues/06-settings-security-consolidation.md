# 06 — 设置与安全收口

**What to build:** 将低频的所有者安全、本机数据、备份恢复和默认偏好集中到设置与安全；总览继续保留显示币种和金额隐藏这两个即时查看控制。

**Blocked by:** 01 — 工作台应用壳与主导航.

**Status:** resolved

**Adjusted by:** `.scratch/personal-asset-dashboard-rebuild/issues/07-security-settings-backup-and-locked-surface.md`

- [x] 设置与安全集中提供既有 Passkey、TOTP、备份恢复、本机数据和默认偏好入口。
- [x] 显示币种切换与隐藏/显示金额继续属于总览快捷控制，不被埋入设置。
- [x] 备份和恢复继续只处理业务数据与安全元数据边界内的信息，不导出或回显外部来源凭证。
- [x] 所有设置与安全页面保持所有者会话保护、键盘可用性和手机宽度可用性。

## 答案

设置与安全已收口所有者 Passkey 状态、TOTP 备用登录、业务数据备份恢复、本机数据边界和默认偏好；计价货币与金额隐藏仍仅在总览。备份恢复只显示安全摘要，来源凭证、令牌和密钥不会被导出、回显或恢复。

## 评论

- 2026-08-07：新增 `test:ticket-06`，以真实 Web 应用 Playwright 覆盖设置入口、Passkey/TOTP、备份恢复预演与确认、凭证脱敏、锁定态隐私、键盘焦点、390px 手机宽度和无横向溢出；聚焦用例 22/22 通过。
- 验证：`pnpm typecheck`、`pnpm build`、`pnpm test`（单元 8/8、smoke 8/8）均通过；未运行 `pnpm test:regression`。
