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
