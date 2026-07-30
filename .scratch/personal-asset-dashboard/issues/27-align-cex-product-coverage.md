# 27 — 对齐中心化资产来源产品覆盖

**What to build:** 复用现有产品覆盖模型，让 OKX 与 Bitget 和 Binance 一样明确展示已读取、仅汇总、间接或未覆盖的投资产品，并让完整性状态进入总资产与历史快照判断。

**Blocked by:** None

**Priority:** P1

**Status:** resolved

- [x] 产品覆盖组件不再绑定 Binance，Binance、OKX、Bitget 资产卡片使用同一展示结构和状态语义。
- [x] OKX 快照声明 Spot、Funding、Trading Bots、Simple Earn Flexible，以及当前无法完整读取的 Simple Earn Fixed 与 On-chain Earn。
- [x] Bitget 快照按 Classic / UTA 账户模式声明 Spot、Funding、Savings、合约交易机器人及当前未接入的 SharkFin、On-chain Earn。
- [x] OKX 与 Bitget 无法证明平台全部投资产品余额已纳入时，来源覆盖状态不得宣称 `complete`。
- [x] 价格刷新保留最近一次余额同步形成的产品覆盖证据；同步失败统一把覆盖产品标记为过期。
- [x] 生产适配器边界和浏览器资产卡片边界均有定向回归测试。

## 测试 seam

- 生产资产来源适配器返回的 `AssetSnapshot.coverage`。
- 所有者已连接来源后，资产卡片展示的产品覆盖列表与不完整状态。

## 评论

- 2026-07-30：已在线核对仓库固定的 Vibe-Nothing-UI revision `46661e55ae04537215a229be49f2ac1bd37a4255`；本 Ticket 复用现有 `vibe-coverage` 结构和运行时 Token，不创建新视觉语言。
- 2026-07-30：OKX 官方当前仍提供 Simple Earn Flexible 与 On-chain Earn 只读查询；Simple Earn Fixed 旧接口已下线。Bitget 官方当前提供 Savings、SharkFin 与 On-chain Earn 资产查询。当前适配器尚未读取的产品必须显式列为未覆盖，而不是推断为零。
- 2026-07-30：OKX 固定输出 6 项覆盖证据；Bitget Classic 输出 7 项、UTA 输出 6 项。Bitget Earn 总览与逐仓明细不一致时，Savings Flexible/Fixed 会降级为“仅汇总”。
- 2026-07-30：Next.js 生产构建与 `pnpm typecheck` 通过；OKX/Bitget 定向回归 23/23、跨来源相关回归中的本 Ticket 场景全部通过。Playwright 全量 194/198，4 个失败分别属于本 Ticket 前已有的移动摘要严格定位、Binance 宽度调整时序、TOTP 手机溢出和宽屏总览宽度脏改动；Binance 宽度测试隔离复跑通过。
