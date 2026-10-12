import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildDailyAssetSnapshot,
  sourceTrendClassTotals,
} from "@/domain/daily-asset-snapshots";
import { buildSnapshotFromPositions } from "@/domain/valuation";
import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetSourceSummary, Card } from "@/server/ports";
import { SqliteDashboardDatabase } from "@/server/production";

export const dynamic = "force-dynamic";

const INITIAL_AT = "2026-04-01T15:59:50.000Z";

function sourceFixture(input: {
  id: string;
  kind?: string;
  label: string;
  amount: string;
  credentialReference: string;
  assetClass?: "securities" | "crypto";
  platformProfit?: string | null;
  rate?: string;
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind ?? "daily-fixture",
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
        assetClass: input.assetClass ?? "securities",
        currentPrice: { amount: input.amount, currency: "USD" },
        priceSource: `${input.label} 初始行情`,
        pricedAt: INITIAL_AT,
        costPrice: null,
        platformProfit: input.platformProfit ?? null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: input.rate ?? "7.2",
        source: "每日快照确定性汇率",
        observedAt: INITIAL_AT,
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "每日快照确定性港币汇率",
        observedAt: INITIAL_AT,
      }],
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

function sourceCard(source: AssetSourceSummary, index: number): Card {
  return {
    id: `daily-card-${index}`,
    kind: "asset",
    title: source.label,
    body: "每日快照浏览器测试来源",
    sourceId: source.id,
    span: 1,
  };
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    iso?: unknown;
    keepSourcesConnected?: unknown;
    rate?: unknown;
  } | null;
  const services = getTestServices();

  if (body?.action === "production-persistence") {
    const root = await mkdtemp(path.join(tmpdir(), "pad-daily-snapshot-"));
    try {
      const dashboardPath = path.join(root, "dashboard.sqlite");
      const database = new SqliteDashboardDatabase(dashboardPath);
      const snapshot = buildDailyAssetSnapshot(
        await services.assetSources.list(),
        services.clock.now().toISOString(),
      );
      const first = await database.createDailyAssetSnapshotIfAbsent(snapshot);
      const duplicate = await database.createDailyAssetSnapshotIfAbsent({
        ...snapshot,
        capturedAt: new Date(
          new Date(snapshot.capturedAt).getTime() + 1_000,
        ).toISOString(),
      });
      const trendCapturedAt = new Date(
        new Date(snapshot.capturedAt).getTime() + 60_000,
      ).toISOString();
      await database.recordDailyAssetObservation(
        {
          ...snapshot,
          capturedAt: trendCapturedAt,
          total: { ...snapshot.total, USD: "303" },
          sources: snapshot.sources.map((source, index) => ({
            ...source,
            capturedAt: trendCapturedAt,
            total: {
              ...source.total,
              USD: index === 0 ? "101" : "202",
            },
          })),
        },
        true,
      );
      const reloaded = new SqliteDashboardDatabase(dashboardPath);
      const [baseline] = await reloaded.listDailyAssetSnapshots();
      const [trend] = await reloaded.listDailyAssetTrendObservations();
      return Response.json({
        first,
        duplicate,
        count: (await reloaded.listDailyAssetSnapshots()).length,
        baselineCapturedAt: baseline?.capturedAt,
        trendCapturedAt: trend?.capturedAt,
        baselineUsd: baseline?.total.USD,
        trendUsd: trend?.total.USD,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  if (body?.action === "production-incomplete-baseline-repair") {
    const root = await mkdtemp(path.join(tmpdir(), "pad-daily-snapshot-"));
    try {
      const dashboardPath = path.join(root, "dashboard.sqlite");
      const database = new SqliteDashboardDatabase(dashboardPath);
      const snapshot = buildDailyAssetSnapshot(
        await services.assetSources.list(),
        services.clock.now().toISOString(),
      );
      await database.createDailyAssetSnapshotIfAbsent({
        ...snapshot,
        complete: false,
        status: "expired",
        sources: snapshot.sources.map((source, index) =>
          index === 0
            ? source
            : { ...source, complete: false, status: "expired" },
        ),
      });
      const repairedAt = new Date(
        new Date(snapshot.capturedAt).getTime() + 60_000,
      ).toISOString();
      await database.recordDailyAssetObservation(
        {
          ...snapshot,
          capturedAt: repairedAt,
          total: { ...snapshot.total, USD: "303" },
          sources: snapshot.sources.map((source, index) => ({
            ...source,
            capturedAt: repairedAt,
            total: {
              ...source.total,
              USD: index === 0 ? "101" : "202",
            },
          })),
        },
        true,
      );
      const reloaded = new SqliteDashboardDatabase(dashboardPath);
      const [baseline] = await reloaded.listDailyAssetSnapshots();
      return Response.json({
        count: (await reloaded.listDailyAssetSnapshots()).length,
        capturedAt: baseline?.capturedAt,
        complete: baseline?.complete,
        status: baseline?.status,
        totalUsd: baseline?.total.USD,
        sourceCount: baseline?.sources.length,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  if (body?.action === "connect-before-failed-refresh") {
    services.clock.set(INITIAL_AT);
    services.assetSynchronization.reset("all-failure");
    const fixture = sourceFixture({
      id: "connection-preview",
      label: "Confirmed Securities",
      amount: "88",
      credentialReference: "unused-preview-reference",
      platformProfit: "5.00",
    });
    await services.assetSourceConnections.connectLongbridge({
      credentials: "confirmed-readonly-credentials",
      permissions: ["market-data", "account", "positions"],
      account: { id: "confirmed-account", label: "Confirmed Securities" },
      snapshot: fixture.snapshot,
    });
    return Response.json({ ok: true });
  }

  if (body?.action === "seed-total-trend-history") {
    const sourceList = await services.assetSources.list();
    const observations = [
      {
        day: "2026-03-01",
        capturedAt: "2026-03-01T04:00:00.000Z",
        totals: [
          { USD: "30", CNY: "216", HKD: "234" },
          { USD: "70", CNY: "504", HKD: "546" },
        ],
      },
      {
        day: "2026-03-02",
        capturedAt: "2026-03-02T04:00:00.000Z",
        totals: [
          { USD: "40", CNY: "288", HKD: "312" },
          { USD: "80", CNY: "576", HKD: "624" },
        ],
      },
      {
        day: "2026-03-04",
        capturedAt: "2026-03-04T04:00:00.000Z",
        totals: [
          { USD: "50", CNY: "360", HKD: "390" },
          { USD: "60", CNY: "432", HKD: "468" },
        ],
      },
    ] as const;
    for (const observation of observations) {
      const base = buildDailyAssetSnapshot(sourceList, observation.capturedAt);
      await services.dailyAssetSnapshots.record(
        {
          ...base,
          day: observation.day,
          capturedAt: observation.capturedAt,
          exchangeRates: (base.exchangeRates ?? []).map((rate) => ({
            ...rate,
            observedAt: observation.capturedAt,
          })),
          total: {
            USD: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.USD),
                0,
              ),
            ),
            CNY: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.CNY),
                0,
              ),
            ),
            HKD: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.HKD),
                0,
              ),
            ),
          },
          sources: base.sources.map((source, index) => ({
            ...source,
            capturedAt: observation.capturedAt,
            total: observation.totals[index] ?? source.total,
          })),
        },
        true,
      );
    }
    services.clock.set("2026-03-04T12:00:00.000Z");
    await services.assetSources.replaceAll(sourceList.map((source) => ({
      ...source,
      lifecycle: "disconnected",
      credentialReference: null,
    })));
    services.assetSynchronization.reset("all-failure");
    return Response.json({ ok: true });
  }

  if (body?.action === "disable-automatic-refresh") {
    await services.assetSources.replaceAll(
      (await services.assetSources.list()).map((source) => ({
        ...source,
        lifecycle: "disconnected",
        credentialReference: null,
      })),
    );
    return Response.json({ ok: true });
  }

  if (body?.action === "seed-trend-range-history") {
    const sourceList = await services.assetSources.list();
    const start = new Date("2026-02-01T04:00:00.000Z");
    for (let index = 0; index < 35; index += 1) {
      const capturedAt = new Date(start);
      capturedAt.setUTCDate(start.getUTCDate() + index);
      const capturedAtIso = capturedAt.toISOString();
      const alphaUsd = 40 + index;
      const betaUsd = 60;
      const sourceTotals = [
        {
          USD: String(alphaUsd),
          CNY: String(alphaUsd * 7.2),
          HKD: String(alphaUsd * 7.8),
        },
        { USD: String(betaUsd), CNY: "432", HKD: "468" },
      ];
      const base = buildDailyAssetSnapshot(sourceList, capturedAtIso);
      await services.dailyAssetSnapshots.record(
        {
          ...base,
          capturedAt: capturedAtIso,
          exchangeRates: (base.exchangeRates ?? []).map((rate) => ({
            ...rate,
            observedAt: capturedAtIso,
          })),
          total: {
            USD: String(alphaUsd + betaUsd),
            CNY: String((alphaUsd + betaUsd) * 7.2),
            HKD: String((alphaUsd + betaUsd) * 7.8),
          },
          sources: base.sources.map((source, sourceIndex) => ({
            ...source,
            capturedAt: capturedAtIso,
            total: sourceTotals[sourceIndex] ?? source.total,
          })),
        },
        true,
      );
    }
    services.clock.set("2026-03-07T12:00:00.000Z");
    await services.assetSources.replaceAll(sourceList.map((source) => ({
      ...source,
      lifecycle: "disconnected",
      credentialReference: null,
    })));
    services.assetSynchronization.reset("all-failure");
    return Response.json({ ok: true });
  }

  if (body?.action === "seed-source-trend-gap") {
    const sourceList = await services.assetSources.list();
    const observations = [
      { day: "2026-03-01", alpha: 100, beta: 200 },
      { day: "2026-03-02", alpha: 120, beta: 200 },
      { day: "2026-03-03", alpha: null, beta: 350 },
      { day: "2026-03-04", alpha: 110, beta: 250 },
    ] as const;
    for (const observation of observations) {
      const capturedAt = `${observation.day}T04:00:00.000Z`;
      const base = buildDailyAssetSnapshot(sourceList, capturedAt);
      const sourceAmounts = [observation.alpha, observation.beta];
      const sources = base.sources.flatMap((source, index) => {
        const usd = sourceAmounts[index];
        if (usd === null || usd === undefined) return [];
        return [{
          ...source,
          capturedAt,
          total: {
            USD: String(usd),
            CNY: String(usd * 7.2),
            HKD: String(usd * 7.8),
          },
        }];
      });
      const totalUsd = sources.reduce(
        (sum, source) => sum + Number(source.total.USD),
        0,
      );
      await services.dailyAssetSnapshots.record(
        {
          ...base,
          day: observation.day,
          capturedAt,
          exchangeRates: (base.exchangeRates ?? []).map((rate) => ({
            ...rate,
            observedAt: capturedAt,
          })),
          total: {
            USD: String(totalUsd),
            CNY: String(totalUsd * 7.2),
            HKD: String(totalUsd * 7.8),
          },
          sources,
        },
        true,
      );
    }
    services.clock.set("2026-03-04T12:00:00.000Z");
    if (body?.keepSourcesConnected !== true) {
      await services.assetSources.replaceAll(sourceList.map((source) => ({
        ...source,
        lifecycle: "disconnected",
        credentialReference: null,
      })));
      services.assetSynchronization.reset("all-failure");
    }
    return Response.json({ ok: true });
  }

  if (body?.action === "set-time" && typeof body.iso === "string") {
    services.clock.set(body.iso);
    return Response.json({ ok: true });
  }
  if (body?.action === "seed-imported-source-history") {
    services.dailyAssetSnapshots.seedImportedSourceHistory([
      { day: "2026-01-01", amount: "100" },
      { day: "2026-01-02", amount: "110" },
    ].map(({ day, amount }) => ({
      capturedAt: day + "T04:00:00.000Z",
      complete: true,
      day,
      kind: "longbridge",
      label: "长桥",
      sourceId: "legacy-source",
      status: "complete" as const,
      total: { USD: amount, CNY: null, HKD: null },
    })));
    return Response.json({ ok: true });
  }
  if (body?.action === "seed-classified-performance-history") {
    const sourceList = await services.assetSources.list();
    const observations = [
      {
        day: "2026-03-01",
        capturedAt: "2026-03-01T04:00:00.000Z",
        totals: [
          { USD: "100", CNY: "720", HKD: "780" },
          { USD: "200", CNY: "1440", HKD: "1560" },
        ],
      },
      {
        day: "2026-03-02",
        capturedAt: "2026-03-02T04:00:00.000Z",
        totals: [
          { USD: "130", CNY: "936", HKD: "1014" },
          { USD: "150", CNY: "1080", HKD: "1170" },
        ],
      },
      {
        day: "2026-03-04",
        capturedAt: "2026-03-04T04:00:00.000Z",
        totals: [
          { USD: "120", CNY: "864", HKD: "936" },
          { USD: "180", CNY: "1296", HKD: "1404" },
        ],
      },
    ] as const;
    for (const observation of observations) {
      const base = buildDailyAssetSnapshot(sourceList, observation.capturedAt);
      await services.dailyAssetSnapshots.record(
        {
          ...base,
          day: observation.day,
          capturedAt: observation.capturedAt,
          total: {
            USD: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.USD),
                0,
              ),
            ),
            CNY: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.CNY),
                0,
              ),
            ),
            HKD: String(
              observation.totals.reduce(
                (sum, source) => sum + Number(source.HKD),
                0,
              ),
            ),
          },
          sources: base.sources.map((source, index) => {
            const total = observation.totals[index] ?? source.total;
            const sourceObservation = {
              ...source,
              capturedAt: observation.capturedAt,
              total,
            };
            return {
              ...sourceObservation,
              assetClassTotals: sourceTrendClassTotals(
                sourceList[index]!,
                sourceObservation,
              ),
            };
          }),
        },
        true,
      );
    }
    services.clock.set("2026-03-04T12:00:00.000Z");
    await services.assetSources.replaceAll(sourceList.map((source) => ({
      ...source,
      lifecycle: "disconnected",
      credentialReference: null,
    })));
    services.assetSynchronization.reset("all-failure");
    return Response.json({ ok: true });
  }
  if (body?.action === "remove-beta-cross-currency-rates") {
    await services.assetSources.replaceAll(
      (await services.assetSources.list()).map((source) =>
        source.id !== "source-beta"
          ? source
          : {
              ...source,
              snapshot: {
                ...source.snapshot,
                exchangeRates: [],
              },
            }
      ),
    );
    return Response.json({ ok: true });
  }
  if (body?.action === "record-current-observation") {
    const capturedAt = services.clock.now().toISOString();
    await services.dailyAssetSnapshots.record(
      buildDailyAssetSnapshot(await services.assetSources.list(), capturedAt),
      true,
    );
    return Response.json({ ok: true });
  }
  if (body?.action === "record-complete-observation") {
    const capturedAt = services.clock.now().toISOString();
    const snapshot = buildDailyAssetSnapshot(
      await services.assetSources.list(),
      capturedAt,
    );
    const sourceTotals = [
      { USD: "100", CNY: "720", HKD: "780" },
      { USD: "200", CNY: "1440", HKD: "1560" },
    ];
    await services.dailyAssetSnapshots.record(
      {
        ...snapshot,
        capturedAt,
        complete: true,
        status: "complete",
        total: { USD: "300", CNY: "2160", HKD: "2340" },
        sources: snapshot.sources.map((source, index) => ({
          ...source,
          capturedAt,
          complete: true,
          status: "complete",
          total: sourceTotals[index] ?? source.total,
        })),
      },
      true,
    );
    return Response.json({ ok: true });
  }
  if (body?.action === "fail-all") {
    services.assetSynchronization.reset("all-failure");
    return Response.json({ ok: true });
  }
  if (body?.action === "partial-failure") {
    services.assetSynchronization.reset("partial-failure");
    return Response.json({ ok: true });
  }
  if (body?.action === "recover") {
    services.assetSynchronization.reset("schedule");
    return Response.json({ ok: true });
  }
  if (body?.action === "remove-hkd-rate") {
    await services.assetSources.replaceAll(
      (await services.assetSources.list()).map((source) => ({
        ...source,
        snapshot: {
          ...source.snapshot,
          exchangeRates: source.snapshot.exchangeRates.filter(
            (rate) =>
              !(
                (rate.baseCurrency === "USD" && rate.quoteCurrency === "HKD") ||
                (rate.baseCurrency === "HKD" && rate.quoteCurrency === "USD")
              ),
          ),
        },
      })),
    );
    return Response.json({ ok: true });
  }
  if (body?.action === "set-hkd-rate" && typeof body.rate === "string") {
    const hkdRate = body.rate;
    await services.assetSources.replaceAll(
      (await services.assetSources.list()).map((source) => ({
        ...source,
        snapshot: {
          ...source.snapshot,
          exchangeRates: source.snapshot.exchangeRates.map((rate) =>
            rate.baseCurrency === "USD" && rate.quoteCurrency === "HKD"
              ? {
                  ...rate,
                  rate: hkdRate,
                  observedAt: services.clock.now().toISOString(),
                }
              : rate,
          ),
        },
      })),
    );
    return Response.json({ ok: true });
  }
  if (body?.action === "add-unvalued-source") {
    const credentialReference = await services.secrets.put("unvalued-readonly");
    const source: AssetSourceSummary = {
      ...sourceFixture({
        id: "source-unvalued",
        label: "Unknown Wallet",
        amount: "0",
        credentialReference,
      }),
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
        exchangeRates: [{
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.2",
          source: "每日快照确定性汇率",
          observedAt: INITIAL_AT,
        }, {
          baseCurrency: "USD",
          quoteCurrency: "HKD",
          rate: "7.8",
          source: "每日快照确定性港币汇率",
          observedAt: INITIAL_AT,
        }],
        syncedAt: INITIAL_AT,
      }),
    };
    const sources = [...(await services.assetSources.list()), source];
    await services.assetSources.replaceAll(sources);
    await services.assetCards.replaceAll([
      ...(await services.assetCards.list()),
      sourceCard(source, sources.length),
    ]);
    return Response.json({ ok: true });
  }
  if (body?.action === "add-option-quote-unavailable-source") {
    const credentialReference = await services.secrets.put(
      "option-quote-unavailable-readonly",
    );
    const base = sourceFixture({
      id: "source-option-quote-unavailable",
      label: "长桥期权账户",
      amount: "88",
      credentialReference,
    });
    const source: AssetSourceSummary = {
      ...base,
      kind: "longbridge",
      displayName: "长桥期权账户",
      snapshot: {
        ...base.snapshot,
        holdings: [...base.snapshot.holdings, {
          symbol: "NVDA260805C210000.US",
          name: "NVDA 260805 210 Call",
          quantity: "-1",
          currency: "USD",
          assetClass: "securities",
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "quote-unavailable",
            reason: "Longbridge Open API 未接入期权行情",
          },
          costPrice: "0.450",
          platformProfit: null,
          changePercent: null,
        }],
      },
    };
    const sources = [...(await services.assetSources.list()), source];
    await services.assetSources.replaceAll(sources);
    await services.assetCards.replaceAll([
      ...(await services.assetCards.list()),
      sourceCard(source, sources.length),
    ]);
    return Response.json({ ok: true });
  }
  if (
    body?.action !== "configure" &&
    body?.action !== "configure-longbridge" &&
    body?.action !== "configure-classified"
  ) {
    return Response.json({ error: "每日快照测试配置无效" }, { status: 400 });
  }

  services.clock.set(INITIAL_AT);
  services.assetSynchronization.reset("schedule");
  const alphaReference = await services.secrets.put("alpha-readonly");
  const betaReference = await services.secrets.put("beta-readonly");
  const sourceKind = body.action === "configure-longbridge"
    ? "longbridge"
    : undefined;
  const sources = [
    sourceFixture({
      id: "source-alpha",
      kind: body.action === "configure-classified" ? "longbridge" : sourceKind,
      label: "Alpha Securities",
      amount: "100",
      credentialReference: alphaReference,
      platformProfit: "12.34",
    }),
    sourceFixture({
      id: "source-beta",
      kind: body.action === "configure-classified" ? "binance" : sourceKind,
      label: "Beta Crypto",
      amount: "200",
      credentialReference: betaReference,
      assetClass: "crypto",
      rate: "7.1",
    }),
  ];
  await services.assetSources.replaceAll(sources);
  await services.assetCards.replaceAll(sources.map(sourceCard));
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const dailySnapshots = getTestServices().dailyAssetSnapshots;
  const baselines = await dailySnapshots.list();
  return Response.json({
    /** 兼容旧测试与既有日初基准读取方。 */
    days: baselines,
    baselines,
    trendObservations: await dailySnapshots.listTrendObservations(),
  });
}
