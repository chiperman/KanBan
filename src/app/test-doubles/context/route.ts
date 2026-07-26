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
      binanceConnections: "in-memory-binance-preview-state",
      okx: "fake-okx-read-only",
      okxConnections: "in-memory-okx-preview-state",
      prices: "fake-prices",
      auth: "in-memory-session-auth",
      ownerCredentials: "in-memory-owner-credential-store",
      secrets: "in-memory-secret-store",
    },
  });
}
