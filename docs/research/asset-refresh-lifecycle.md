# 资产数据刷新生命周期调研

调研范围：当前源码与运行配置；未运行服务或浏览器。本结论只描述代码定义的行为。

## 结论

| 页面状态 | 是否会发起新的自动刷新 | 说明 |
| --- | --- | --- |
| 可见 | 会 | 首次挂载自动同步；非 EVM 随后每 30 秒检查一次：余额/持仓距上次成功满 5 分钟则完整刷新，否则行情距上次成功满 30 秒则只刷新行情。 |
| 后台/隐藏 | 不会 | 定时器仍存在，但每次 tick 发现 `document.visibilityState === "hidden"` 即返回，不调用 API；恢复可见时立即发起一次全量、全范围刷新。 |
| 页面关闭/组件卸载 | 不会 | effect cleanup 清除定时器并移除可见性、手动刷新监听，因此不会再产生客户端触发。已在途的 `fetch` 未使用 `AbortController` 取消；关闭浏览器后该请求能否在运行环境中继续完成，源码没有保证。 |

## 客户端触发链

- `AssetRefreshControls` 是客户端组件（`"use client"`），刷新由浏览器 `fetch` POST 到 `/api/asset-sources/refresh`；成功后调用 `router.refresh()` 更新页面数据。[src/ui/asset-refresh-controls.tsx:1](../../src/ui/asset-refresh-controls.tsx#L1) [src/ui/asset-refresh-controls.tsx:40-85](../../src/ui/asset-refresh-controls.tsx#L40-L85)
- 首次挂载时：有非 EVM 来源发起 `all/non-evm`；EVM 当个上海自然日尚未尝试行情刷新时发起 `prices/evm`。此 effect 不检查页面可见性。[src/ui/asset-refresh-controls.tsx:103-115](../../src/ui/asset-refresh-controls.tsx#L103-L115)
- 非 EVM 周期检查由 `window.setInterval(..., 30_000)` 驱动；隐藏状态或已有在途请求时直接返回。组件卸载时清理 interval。[src/ui/asset-refresh-controls.tsx:117-130](../../src/ui/asset-refresh-controls.tsx#L117-L130)
- 监听 `visibilitychange`，仅在状态变为 `visible` 时执行 `all/all`，并在卸载时移除监听。[src/ui/asset-refresh-controls.tsx:132-141](../../src/ui/asset-refresh-controls.tsx#L132-L141)
- 看板只在存在未断开来源时挂载该控件；来源分类与 EVM 当日判断在所有者看板完成。[src/ui/owner-dashboard.tsx:209-224](../../src/ui/owner-dashboard.tsx#L209-L224) [src/ui/owner-dashboard.tsx:816-821](../../src/ui/owner-dashboard.tsx#L816-L821)

浏览器回归测试也覆盖上述行为：隐藏后快进 5 分钟，调用序列不增加；恢复可见后增加一次 `all/all`。测试同时验证 EVM 的首次自动操作仅为 `prices/evm`，恢复可见仍为 `all/all`。[e2e/refresh-stale-data.spec.ts:88-149](../../e2e/refresh-stale-data.spec.ts#L88-L149)

## API 与服务端边界

- API route 只响应收到的 `POST`：校验所有者 session、`mode` 与 `scope`，随后调用 `services.assetSynchronization.refresh()`；它不是定时任务入口。[src/app/api/asset-sources/refresh/route.ts:4-27](../../src/app/api/asset-sources/refresh/route.ts#L4-L27)
- 同步服务只把调用串行化，并对本次请求中的每个来源执行刷新；其 `setTimeout` 是单来源超时，不是调度器。生产装配的超时为 60 秒。[src/server/asset-synchronization.ts:18-39](../../src/server/asset-synchronization.ts#L18-L39) [src/server/asset-synchronization.ts:55-80](../../src/server/asset-synchronization.ts#L55-L80) [src/server/production.ts:2349-2363](../../src/server/production.ts#L2349-L2363)
- 当前 `package.json` 仅定义开发、构建、启动、类型检查和测试脚本，依赖中也没有 cron/队列调度组件；`next.config.ts` 仅配置主页的 `Cache-Control`。仓库中没有独立 scheduler、cron、后台 worker 或部署级 cron 配置。[package.json:5-33](../../package.json#L5-L33) [next.config.ts:3-14](../../next.config.ts#L3-L14)

因此，资产刷新当前是**打开且已认证页面驱动的按需同步**，不是脱离页面持续运行的服务端任务。若需要页面关闭后仍刷新，须新增受认证/防重入保护的服务端调度机制；现有 API route 本身不会自行唤醒。
