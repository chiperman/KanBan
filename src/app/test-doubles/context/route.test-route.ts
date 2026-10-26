import { getTestServices } from "@/server/testing/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;

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
 * 模拟开发服务器热更新后，全局缓存仍保留旧服务契约的情形。
 * 仅测试环境可达，用于验证组合根会在服务契约扩展时自动重建。
 */
export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    staleContract?: "asset-source-lifecycle" | "longbridge-holding-candlesticks";
  };
  const staleServices = getTestServices();
  if (body.staleContract === "longbridge-holding-candlesticks") {
    Object.defineProperty(
      staleServices.longbridgeHoldingCandlesticks,
      "readFiveDayTrend",
      {
        configurable: true,
        value: undefined,
      },
    );
  } else {
    Object.defineProperty(
      staleServices.assetSourceLifecycle,
      "setEvmTokenPreference",
      {
        configurable: true,
        value: undefined,
      },
    );
  }

  const refreshedServices = getTestServices();
  return Response.json({
    supportsEvmTokenPreferences:
      typeof refreshedServices.assetSourceLifecycle.setEvmTokenPreference ===
      "function",
    supportsFiveDayTrend:
      typeof refreshedServices.longbridgeHoldingCandlesticks.readFiveDayTrend ===
      "function",
  });
}
