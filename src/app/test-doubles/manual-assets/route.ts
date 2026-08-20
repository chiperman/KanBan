import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetSourceSummary } from "@/server/ports";
import {
  FileDashboardDatabase,
  SqliteDashboardDatabase,
} from "@/server/production";

export const dynamic = "force-dynamic";

function currentManualState() {
  const services = getTestServices();
  return Promise.all([
    services.assetSources.list(),
    services.dailyAssetSnapshots.list(),
    services.dailyAssetSnapshots.listTrendObservations(),
  ]).then(([sources, baselines, trendObservations]) => ({
    sources: sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      manualAssetClass: source.manualAssetClass,
      total: source.snapshot.total,
    })),
    baselines,
    trendObservations,
  }));
}

function longbridgeRateSource(capturedAt: string): AssetSourceSummary {
  return {
    id: "manual-assets-longbridge-rates",
    kind: "longbridge",
    label: "长桥汇率观测",
    accountId: "fixture:manual-assets-longbridge-rates",
    permissions: ["account"],
    credentialReference: null,
    lifecycle: "disconnected",
    snapshot: {
      total: { amount: "0", currency: "USD" },
      holdings: [],
      exchangeRates: [
        {
          baseCurrency: "CNY",
          quoteCurrency: "USD",
          rate: "0.14",
          source: "长桥测试汇率",
          observedAt: capturedAt,
        },
        {
          baseCurrency: "USD",
          quoteCurrency: "HKD",
          rate: "7.8",
          source: "长桥测试汇率",
          observedAt: capturedAt,
        },
      ],
      syncedAt: capturedAt,
    },
    sync: {
      status: "current",
      lastSuccessfulAt: capturedAt,
      lastAttemptAt: capturedAt,
      error: null,
    },
  };
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(await currentManualState());
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  if (body?.action === "file-persistence") {
    const root = await mkdtemp(path.join(tmpdir(), "pad-manual-assets-"));
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      const database = new FileDashboardDatabase(
        dashboardPath,
        path.join(root, "cards.json"),
      );
      const capturedAt = "2026-01-01T01:00:00.000Z";
      await database.createManualAssetSource(
        { label: "A股" },
        capturedAt,
      );
      const [source] = await database.listSources();
      await database.recordManualAssetSource(
        source.id,
        { day: "2026-01-01", amount: "108000", currency: "CNY" },
        "2026-01-01T08:00:00.000Z",
      );
      const reloaded = new FileDashboardDatabase(
        dashboardPath,
        path.join(root, "cards.json"),
      );
      const [baseline] = await reloaded.listDailyAssetSnapshots();
      const [trend] = await reloaded.listDailyAssetTrendObservations();
      return Response.json({
        source: (await reloaded.listSources())[0]?.snapshot.total,
        cards: (await reloaded.listAssetCards()).length,
        baseline: baseline?.sources.filter(
          (item) => item.sourceId === source.id,
        ),
        trend: trend?.sources.filter((item) => item.sourceId === source.id),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  if (body?.action === "sqlite-same-day-cny-observation") {
    const root = await mkdtemp(path.join(tmpdir(), "pad-manual-assets-sqlite-"));
    try {
      const database = new SqliteDashboardDatabase(
        path.join(root, "dashboard.sqlite"),
        path.join(root, "dashboard.json"),
        path.join(root, "cards.json"),
      );
      const firstCapturedAt = "2026-03-04T12:00:00.000Z";
      await database.replaceSources([longbridgeRateSource(firstCapturedAt)]);
      await database.createManualAssetSource({ label: "A股" }, firstCapturedAt);
      const source = (await database.listSources()).find(
        ({ kind, label }) => kind === "manual" && label === "A股",
      );
      if (!source) throw new Error("手工资产来源创建失败");
      await database.recordManualAssetSource(
        source.id,
        { day: "2026-03-04", amount: "100000", currency: "CNY" },
        firstCapturedAt,
      );
      await database.recordManualAssetSource(
        source.id,
        { day: "2026-03-04", amount: "108000", currency: "CNY" },
        "2026-03-04T12:05:00.000Z",
      );
      const sourceTotal = (snapshot: Awaited<ReturnType<typeof database.listDailyAssetSnapshots>>[number]) =>
        snapshot.sources.find(({ sourceId }) => sourceId === source.id)?.total ?? null;
      const [baseline] = await database.listDailyAssetSnapshots();
      const [trend] = await database.listDailyAssetTrendObservations();
      return Response.json({
        baseline: baseline === undefined ? null : sourceTotal(baseline),
        trend: trend === undefined ? null : sourceTotal(trend),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  if (body?.action === "seed-nonmanual") {
    const services = getTestServices();
    const capturedAt = services.clock.now().toISOString();
    const source: AssetSourceSummary = {
      id: "manual-assets-nonmanual",
      kind: "fixture",
      label: "外部测试来源",
      accountId: "fixture:manual-assets",
      permissions: ["account"],
      credentialReference: "fixture-credential",
      snapshot: {
        total: { amount: "1", currency: "USD" },
        holdings: [],
        exchangeRates: [],
        syncedAt: capturedAt,
      },
      sync: {
        status: "current",
        lastSuccessfulAt: capturedAt,
        lastAttemptAt: capturedAt,
        error: null,
      },
    };
    await services.assetSources.replaceAll([
      ...(await services.assetSources.list()),
      source,
    ]);
    return Response.json({ sourceId: source.id });
  }
  return Response.json({ error: "测试操作无效" }, { status: 400 });
}
