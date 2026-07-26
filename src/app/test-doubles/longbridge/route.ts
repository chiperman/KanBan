import { getTestServices, isTestEnv } from "@/server/composition";
import type { FakeLongbridgeConfig } from "@/server/testing/fakes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
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
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).length,
    savedSecrets: services.secrets.size(),
    fetchedPositionPages: services.longbridge.fetchedPositionPages,
  });
}
