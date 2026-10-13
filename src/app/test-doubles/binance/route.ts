import { getTestServices } from "@/server/composition";
import type { Card } from "@/server/ports";
import { BINANCE_OBSERVED_AT, BINANCE_USDT_USD_QUOTE } from "@/server/testing/binance-fixtures";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

const LOGIN_CARD: Card = {
  id: "binance-login-card",
  kind: "asset",
  title: "私密内容",
  body: "Binance 测试登录入口",
  span: 1,
};

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    scenario?: unknown;
  } | null;
  if (typeof body?.scenario !== "string") {
    return Response.json({ error: "Binance 测试场景无效" }, { status: 400 });
  }
  const services = getTestServices();
  if (body.scenario === "forget-credential") {
    const source = (await services.assetSources.list()).find(
      ({ kind }) => kind === "binance",
    );
    if (!source?.credentialReference) {
      return Response.json({ error: "缺少 Binance 测试凭证" }, { status: 400 });
    }
    await services.secrets.remove(source.credentialReference);
    return Response.json({ ok: true });
  }
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
  if ((await services.assetCards.list()).length === 0) {
    await services.assetCards.replaceAll([LOGIN_CARD]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;
  const services = getTestServices();
  return Response.json({
    savedSources: (await services.assetSources.list()).filter(
      ({ kind }) => kind === "binance",
    ).length,
    savedSecrets: services.secrets.size(),
  });
}
