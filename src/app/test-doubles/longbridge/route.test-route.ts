import { getTestServices } from "@/server/composition";
import type { FakeLongbridgeConfig } from "@/server/testing/fakes";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const config = (await request.json()) as FakeLongbridgeConfig & {
    scenario?: string;
  };
  const services = getTestServices();
  if (config.scenario === "refresh-failure") {
    services.assetSynchronization.reset("longbridge-refresh-failure");
    return Response.json({ ok: true });
  }
  services.longbridge.configure(config);
  services.assetSourceConnections.failNext(config.commitError);
  return Response.json({ ok: true });
}

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).length,
    savedSecrets: services.secrets.size(),
    fetchedPositionPages: services.longbridge.fetchedPositionPages,
  });
}
