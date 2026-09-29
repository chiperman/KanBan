import type { AssetFullRefreshState, Clock } from "@/server/ports";

export const ASSET_SOURCE_TIMEOUT_MS = 60_000;

export function fullRefreshLeaseMs(sourceTimeoutMs = ASSET_SOURCE_TIMEOUT_MS): number {
  return Math.max(sourceTimeoutMs + 5_000, 60_000);
}

/** 页面和状态查询沿用服务端 claim 的租约，过期标记仅保留作诊断。 */
export async function readAssetRefreshState(services: {
  assetFullRefreshState: AssetFullRefreshState;
  clock: Clock;
}) {
  const state = await services.assetFullRefreshState.read();
  const startedAt = state.inProgressAt === null ? NaN : Date.parse(state.inProgressAt);
  const active = Number.isFinite(startedAt) &&
    services.clock.now().getTime() - startedAt < fullRefreshLeaseMs();
  return { ...state, inProgressAt: active ? state.inProgressAt : null };
}
