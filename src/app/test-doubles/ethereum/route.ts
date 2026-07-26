import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { scenario?: string; commitError?: string };
  const services = getTestServices();
  if (body.scenario === "refresh-ethereum-failure") {
    services.assetSynchronization.reset("evm-ethereum-refresh-failure");
    return Response.json({ ok: true });
  }
  if (body.scenario === "refresh-ethereum-price-failure") {
    services.assetSynchronization.reset("evm-ethereum-price-refresh-failure");
    return Response.json({ ok: true });
  }
  if (body.scenario === "refresh-passthrough") {
    services.assetSynchronization.reset("passthrough");
    return Response.json({ ok: true });
  }
  services.evm.configure(body.scenario ?? "valid");
  services.assetSourceConnections.failNext(body.commitError);
  if ((await services.cards.list()).length === 0) {
    await services.cards.replaceAll([{
      id: "ethereum-test-private-card",
      kind: "asset",
      access: "private",
      title: "资产",
      body: "仅供身份测试的安全占位",
      span: 1,
    }]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).filter(({ kind }) => kind.startsWith("evm-watch-")).length,
    savedSecrets: services.secrets.size(),
  });
}
