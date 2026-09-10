import { buildSnapshotFromPositions } from "@/domain/valuation";
import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetSourceSummary, Card } from "@/server/ports";
import type { FakeRefreshScenario } from "@/server/testing/fakes";

export const dynamic = "force-dynamic";

const INITIAL_AT = "2026-04-01T08:00:00.000Z";

function sourceFixture(input: {
  id: string;
  kind: "refresh-fixture" | "evm-watch-ethereum";
  label: string;
  amount: string;
  credentialReference: string;
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    accountId: input.id,
    permissions: ["market-data", "account", "positions"],
    credentialReference: input.credentialReference,
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: input.id.replace("source-", "").toUpperCase(),
        name: input.label,
        quantity: "1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: input.amount, currency: "USD" },
        priceSource: `${input.label} 初始行情`,
        pricedAt: INITIAL_AT,
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: [],
      syncedAt: INITIAL_AT,
    }),
    sync: {
      status: "current",
      lastSuccessfulAt: INITIAL_AT,
      lastAttemptAt: INITIAL_AT,
      error: null,
    },
  };
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    scenario?: unknown;
    sourceKind?: unknown;
    sourceCount?: unknown;
    hold?: unknown;
  } | null;
  const services = getTestServices();
  if (body?.action === "release") {
    services.assetSynchronization.release();
    return Response.json({ ok: true });
  }
  if (body?.action === "prepare-recovery") {
    services.assetSynchronization.prepareRecovery(body.hold === true);
    return Response.json({ ok: true });
  }
  if (body?.action === "reset-schedule") {
    services.assetSynchronization.reset("schedule");
    return Response.json({ ok: true });
  }
  if (body?.action === "anchor-full-refresh") {
    await services.assetFullRefreshState.clear();
    await services.assetFullRefreshState.initialize(
      new Date().toISOString(),
    );
    return Response.json(await services.assetFullRefreshState.read());
  }
  if (body?.action === "prepare-timeout") {
    services.assetSynchronization.reset("timeout-isolation");
    return Response.json({ ok: true });
  }
  if (body?.action === "connect-during-refresh") {
    const reference = await services.secrets.put("gamma-readonly-secret");
    const source = sourceFixture({
      id: "source-gamma",
      kind: "refresh-fixture",
      label: "Gamma Wallet",
      amount: "50",
      credentialReference: reference,
    });
    await services.assetSources.replaceAll([
      ...(await services.assetSources.list()),
      source,
    ]);
    await services.assetCards.replaceAll([
      ...(await services.assetCards.list()),
      {
        id: "refresh-card-3",
        kind: "asset",
        title: source.label,
        body: "并发新增刷新测试来源",
        sourceId: source.id,
        span: 1,
      },
    ]);
    return Response.json({ ok: true });
  }
  if (
    body?.action !== "configure" ||
    (body.scenario !== "schedule" &&
      body.scenario !== "partial-failure" &&
      body.scenario !== "all-failure") ||
    (body.sourceKind !== undefined &&
      body.sourceKind !== "refresh-fixture" &&
      body.sourceKind !== "evm-watch-ethereum") ||
    (body.sourceCount !== undefined && body.sourceCount !== 1 && body.sourceCount !== 2)
  ) {
    return Response.json({ error: "刷新测试配置无效" }, { status: 400 });
  }
  const scenario = body.scenario as FakeRefreshScenario;
  const sourceKind = (body.sourceKind ?? "refresh-fixture") as
    | "refresh-fixture"
    | "evm-watch-ethereum";
  services.clock.set("2026-04-02T08:00:00.000Z");
  services.assetSynchronization.reset(scenario);
  const alphaReference = await services.secrets.put("alpha-readonly-secret");
  const betaReference = await services.secrets.put("beta-readonly-secret");
  const sources = [
    sourceFixture({
      id: "source-alpha",
      kind: sourceKind,
      label: "Alpha Securities",
      amount: "100",
      credentialReference: alphaReference,
    }),
    sourceFixture({
      id: "source-beta",
      kind: sourceKind,
      label: "Beta Crypto",
      amount: "200",
      credentialReference: betaReference,
    }),
  ].slice(0, body.sourceCount === 1 ? 1 : 2);
  const cards: Card[] = sources.map((source, index) => ({
    id: `refresh-card-${index + 1}`,
    kind: "asset",
    title: source.label,
    body: "刷新浏览器测试来源",
    sourceId: source.id,
    span: 1,
  }));
  await services.assetSources.replaceAll(sources);
  await services.assetCards.replaceAll(cards);
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const synchronization = getTestServices().assetSynchronization;
  return Response.json({
    modes: synchronization.modes,
    scopes: synchronization.scopes,
    sourceIds: synchronization.sourceIds,
    active: synchronization.active,
    adapterCalls: synchronization.refresher.calls(),
  });
}
