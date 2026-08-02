import {
  getTestServices,
  isTestEnv,
} from "@/server/composition";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const services = getTestServices();
  return Response.json({
    env: "test",
    now: services.clock.now().toISOString(),
    doubles: {
      clock: "fake-clock",
      assetSources: "fake-asset-sources",
      assetSynchronization: "fake-asset-synchronization",
      dailyAssetSnapshots: "in-memory-daily-asset-snapshots",
      binance: "fake-binance-read-only",
      assetSourceOnboarding: "unified-encrypted-preview-state",
      okx: "fake-okx-read-only",
      bitget: "fake-bitget-read-only",
      evm: "fake-chain-configured-evm-watch-wallet",
      prices: "fake-prices",
      auth: "in-memory-session-auth",
      ownerCredentials: "in-memory-owner-credential-store",
      secrets: "in-memory-secret-store",
    },
  });
}

/**
 * 模拟开发服务器热更新后，全局缓存仍保留旧生命周期服务的情形。
 * 仅测试环境可达，用于验证组合根会在服务契约扩展时自动重建。
 */
export async function POST() {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const staleServices = getTestServices();
  Object.defineProperty(
    staleServices.assetSourceLifecycle,
    "setEvmTokenPreference",
    {
      configurable: true,
      value: undefined,
    },
  );

  const refreshedServices = getTestServices();
  return Response.json({
    supportsEvmTokenPreferences:
      typeof refreshedServices.assetSourceLifecycle.setEvmTokenPreference ===
      "function",
  });
}
