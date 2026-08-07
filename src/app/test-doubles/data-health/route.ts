import { buildSnapshotFromPositions } from "@/domain/valuation";
import { getTestServices, isTestEnv } from "@/server/composition";
import type {
  AssetSourceSummary,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const CURRENT_AT = "2026-03-04T12:00:00.000Z";
const PREVIOUS_AT = "2026-03-03T12:00:00.000Z";

function valuedSource(input: {
  id: string;
  label: string;
  amount: string;
  kind?: string;
  credentialReference?: string | null;
  exchangeRates?: AssetSourceSummary["snapshot"]["exchangeRates"];
  lifecycle?: AssetSourceSummary["lifecycle"];
  sync: AssetSourceSummary["sync"];
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind ?? "data-health-fixture",
    label: input.label,
    displayName: input.label,
    accountId: input.id,
    permissions: ["market-data", "account", "positions"],
    credentialReference: input.credentialReference === undefined
      ? `test-${input.id}`
      : input.credentialReference,
    lifecycle: input.lifecycle ?? "connected",
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: input.id.replace("source-", "").toUpperCase(),
        name: input.label,
        quantity: "1",
        currency: "USD",
        assetClass: "securities",
        currentPrice: { amount: input.amount, currency: "USD" },
        priceSource: `${input.label} 确定性行情`,
        pricedAt: input.sync.lastSuccessfulAt,
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: input.exchangeRates ?? [],
      syncedAt: input.sync.lastSuccessfulAt,
    }),
    sync: input.sync,
  };
}

function manualCnySource(): AssetSourceSummary {
  return {
    id: "source-a-shares",
    kind: "manual",
    label: "A股",
    accountId: "manual:source-a-shares",
    permissions: [],
    credentialReference: null,
    lifecycle: "connected",
    hasManualRecord: true,
    manualAssetClass: "securities",
    snapshot: {
      total: { amount: "235396.50", currency: "CNY" },
      holdings: [],
      exchangeRates: [],
      syncedAt: CURRENT_AT,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: CURRENT_AT,
      lastAttemptAt: CURRENT_AT,
      error: null,
    },
  };
}

function unvaluedSource(): AssetSourceSummary {
  return {
    id: "source-unvalued",
    kind: "data-health-fixture",
    label: "Unknown Wallet",
    accountId: "source-unvalued",
    permissions: ["market-data", "account", "positions"],
    credentialReference: "test-source-unvalued",
    lifecycle: "connected",
    snapshot: buildSnapshotFromPositions({
      positions: [{
        symbol: "UNKNOWN",
        name: "未知价格资产",
        quantity: "8",
        currency: "USD",
        assetClass: "crypto",
        currentPrice: null,
        unvaluedReason: "来源没有可靠价格",
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: [],
      syncedAt: CURRENT_AT,
    }),
    sync: {
      status: "current",
      lastSuccessfulAt: CURRENT_AT,
      lastAttemptAt: CURRENT_AT,
      error: null,
    },
  };
}

function sourceObservation(
  source: AssetSourceSummary,
  day: string,
  status: DailyAssetSourceSnapshot["status"],
): DailyAssetSourceSnapshot {
  const complete = status === "complete";
  return {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    capturedAt: `${day}T12:00:00.000Z`,
    complete,
    status,
    total: {
      USD: complete ? source.snapshot.total.amount : null,
      CNY: null,
      HKD: null,
    },
  };
}

function observation(input: {
  day: string;
  alpha?: DailyAssetSourceSnapshot;
  beta: DailyAssetSourceSnapshot;
  unvalued: DailyAssetSourceSnapshot;
}): DailyAssetTrendObservation {
  const sources = [
    ...(input.alpha === undefined ? [] : [input.alpha]),
    input.beta,
    input.unvalued,
  ];
  return {
    day: input.day,
    capturedAt: `${input.day}T12:00:00.000Z`,
    exchangeRates: [],
    complete: false,
    status: "incomplete",
    total: { USD: null, CNY: null, HKD: null },
    sources,
  };
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  if (body?.action !== "configure") {
    return Response.json({ error: "数据健康测试配置无效" }, { status: 400 });
  }

  const services = getTestServices();
  services.clock.set(CURRENT_AT);
  services.assetSynchronization.reset("all-failure");

  const alpha = valuedSource({
    id: "source-alpha",
    label: "Alpha Securities",
    amount: "100",
    sync: {
      status: "current",
      lastSuccessfulAt: CURRENT_AT,
      lastAttemptAt: CURRENT_AT,
      error: null,
    },
  });
  const longbridgeRates = valuedSource({
    id: "source-longbridge-rates",
    label: "Longbridge 汇率观测",
    amount: "1",
    kind: "longbridge",
    credentialReference: null,
    lifecycle: "disconnected",
    exchangeRates: [{
      baseCurrency: "CNY",
      quoteCurrency: "USD",
      rate: "0.14817",
      source: "Longbridge 官方账户汇率",
      observedAt: CURRENT_AT,
    }],
    sync: {
      status: "current",
      lastSuccessfulAt: CURRENT_AT,
      lastAttemptAt: CURRENT_AT,
      error: null,
    },
  });
  const beta = valuedSource({
    id: "source-beta",
    label: "Beta Crypto",
    amount: "200",
    sync: {
      status: "expired",
      lastSuccessfulAt: PREVIOUS_AT,
      lastAttemptAt: CURRENT_AT,
      error: "来源暂时不可用",
    },
  });
  const unvalued = unvaluedSource();
  const aShares = manualCnySource();
  await services.assetSources.replaceAll([
    alpha,
    beta,
    unvalued,
    aShares,
    longbridgeRates,
  ]);
  await services.assetCards.replaceAll([
    {
      id: "data-health-card-alpha",
      kind: "asset",
      title: alpha.label,
      body: "数据健康测试来源",
      sourceId: alpha.id,
      span: 1,
    },
    {
      id: "data-health-card-beta",
      kind: "asset",
      title: beta.label,
      body: "数据健康测试来源",
      sourceId: beta.id,
      span: 1,
    },
    {
      id: "data-health-card-unvalued",
      kind: "asset",
      title: unvalued.label,
      body: "数据健康测试来源",
      sourceId: unvalued.id,
      span: 1,
    },
    {
      id: "data-health-card-a-shares",
      kind: "asset",
      title: aShares.label,
      body: "数据健康测试来源",
      sourceId: aShares.id,
      span: 1,
    },
    {
      id: "data-health-card-longbridge-rates",
      kind: "asset",
      title: longbridgeRates.label,
      body: "数据健康测试汇率来源",
      sourceId: longbridgeRates.id,
      span: 1,
    },
  ]);

  await services.dailyAssetSnapshots.record(
    observation({
      day: "2026-03-01",
      alpha: sourceObservation(alpha, "2026-03-01", "complete"),
      beta: sourceObservation(beta, "2026-03-01", "complete"),
      unvalued: sourceObservation(unvalued, "2026-03-01", "incomplete"),
    }),
    true,
  );
  await services.dailyAssetSnapshots.record(
    observation({
      day: "2026-03-02",
      alpha: sourceObservation(alpha, "2026-03-02", "complete"),
      beta: sourceObservation(beta, "2026-03-02", "expired"),
      unvalued: sourceObservation(unvalued, "2026-03-02", "incomplete"),
    }),
    true,
  );
  await services.dailyAssetSnapshots.record(
    observation({
      day: "2026-03-03",
      beta: sourceObservation(beta, "2026-03-03", "expired"),
      unvalued: sourceObservation(unvalued, "2026-03-03", "incomplete"),
    }),
    true,
  );
  await services.dailyAssetSnapshots.record(
    observation({
      day: "2026-03-04",
      alpha: sourceObservation(alpha, "2026-03-04", "complete"),
      beta: sourceObservation(beta, "2026-03-04", "expired"),
      unvalued: sourceObservation(unvalued, "2026-03-04", "incomplete"),
    }),
    true,
  );

  return Response.json({ ok: true });
}
