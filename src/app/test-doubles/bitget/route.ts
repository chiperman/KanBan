import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    scenario?: unknown;
  } | null;
  if (typeof body?.scenario !== "string") {
    return Response.json({ error: "Bitget 测试场景无效" }, { status: 400 });
  }
  const services = getTestServices();
  if (body.scenario === "refresh-failure") {
    services.assetSynchronization.reset("bitget-refresh-failure");
    return Response.json({ ok: true });
  }
  services.bitget.configure(
    body.scenario === "commit-failure" ? "valid" : body.scenario,
  );
  services.assetSourceConnections.failNext(
    body.scenario === "commit-failure" ? "原子事务写入失败" : undefined,
  );
  if ((await services.cards.list()).length === 0) {
    await services.cards.replaceAll([{
      id: "bitget-login-card",
      kind: "markdown",
      access: "private",
      title: "Bitget 测试登录入口",
      markdown: "仅用于浏览器验收",
      span: 1,
    }]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).filter(
      ({ kind }) => kind === "bitget",
    ).length,
    savedSecrets: services.secrets.size(),
  });
}
