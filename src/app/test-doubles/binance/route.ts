import { getTestServices, isTestEnv } from "@/server/composition";
import type { Card } from "@/server/ports";
import { BINANCE_OBSERVED_AT, BINANCE_USDT_USD_QUOTE } from "@/server/testing/binance-fixtures";

export const dynamic = "force-dynamic";

const LOGIN_CARD: Card = {
  id: "binance-login-card",
  kind: "markdown",
  title: "私密内容",
  markdown: "Binance 测试登录入口",
  access: "private",
  span: 1,
};

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    scenario?: unknown;
  } | null;
  if (typeof body?.scenario !== "string") {
    return Response.json({ error: "Binance 测试场景无效" }, { status: 400 });
  }
  const services = getTestServices();
  if (body.scenario === "refresh-failure") {
    services.assetSynchronization.reset("binance-refresh-failure");
    return Response.json({ ok: true });
  }
  services.clock.set(BINANCE_OBSERVED_AT);
  services.prices.setQuote(BINANCE_USDT_USD_QUOTE);
  services.binance.configure(
    body.scenario === "commit-failure" ? "valid" : body.scenario,
  );
  services.assetSourceConnections.failNext(
    body.scenario === "commit-failure" ? "原子事务写入失败" : undefined,
  );
  if ((await services.cards.list()).length === 0) {
    await services.cards.replaceAll([LOGIN_CARD]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).filter(
      ({ kind }) => kind === "binance",
    ).length,
    savedSecrets: services.secrets.size(),
  });
}
