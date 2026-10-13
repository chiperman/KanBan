import { getTestServices } from "@/server/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    scenario?: unknown;
  } | null;
  if (typeof body?.scenario !== "string") {
    return Response.json({ error: "OKX 测试场景无效" }, { status: 400 });
  }
  const services = getTestServices();
  if (body.scenario === "refresh-failure") {
    services.assetSynchronization.reset("okx-refresh-failure");
    return Response.json({ ok: true });
  }
  services.okx.configure(
    body.scenario === "commit-failure" ? "valid" : body.scenario,
  );
  services.assetSourceConnections.failNext(
    body.scenario === "commit-failure" ? "原子事务写入失败" : undefined,
  );
  if ((await services.assetCards.list()).length === 0) {
    await services.assetCards.replaceAll([{
      id: "okx-login-card",
      kind: "asset",
      title: "OKX 测试登录入口",
      body: "仅用于浏览器验收",
      span: 1,
    }]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).filter(
      ({ kind }) => kind === "okx",
    ).length,
    savedSecrets: services.secrets.size(),
  });
}
