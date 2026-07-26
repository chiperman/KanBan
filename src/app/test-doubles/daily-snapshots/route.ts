import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { buildSnapshotFromPositions } from "@/domain/valuation";
import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetSourceSummary, Card } from "@/server/ports";
import { FileDashboardDatabase } from "@/server/production";

export const dynamic = "force-dynamic";

const INITIAL_AT = "2026-04-01T15:59:50.000Z";

function sourceFixture(input: {
  id: string;
  label: string;
  amount: string;
  credentialReference: string;
  platformProfit?: string | null;
  rate?: string;
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: "daily-fixture",
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
    access: "private",
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
  } | null;
  const services = getTestServices();

  if (body?.action === "production-persistence") {
    const root = await mkdtemp(path.join(tmpdir(), "pad-daily-snapshot-"));
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      const legacyCardsPath = path.join(root, "cards.json");
      const database = new FileDashboardDatabase(dashboardPath, legacyCardsPath);
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
      const reloaded = new FileDashboardDatabase(dashboardPath, legacyCardsPath);
      const persisted = await reloaded.listDailyAssetSnapshots();
      return Response.json({
        first,
        duplicate,
        count: persisted.length,
        capturedAt: persisted[0]?.capturedAt,
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

  if (body?.action === "set-time" && typeof body.iso === "string") {
    services.clock.set(body.iso);
    return Response.json({ ok: true });
  }
  if (body?.action === "fail-all") {
    services.assetSynchronization.reset("all-failure");
    return Response.json({ ok: true });
  }
  if (body?.action === "recover") {
    services.assetSynchronization.reset("schedule");
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
        }],
        syncedAt: INITIAL_AT,
      }),
    };
    const sources = [...(await services.assetSources.list()), source];
    await services.assetSources.replaceAll(sources);
    await services.cards.replaceAll([
      ...(await services.cards.list()),
      sourceCard(source, sources.length),
    ]);
    return Response.json({ ok: true });
  }
  if (body?.action !== "configure") {
    return Response.json({ error: "每日快照测试配置无效" }, { status: 400 });
  }

  services.clock.set(INITIAL_AT);
  services.assetSynchronization.reset("schedule");
  const alphaReference = await services.secrets.put("alpha-readonly");
  const betaReference = await services.secrets.put("beta-readonly");
  const sources = [
    sourceFixture({
      id: "source-alpha",
      label: "Alpha Securities",
      amount: "100",
      credentialReference: alphaReference,
      platformProfit: "12.34",
    }),
    sourceFixture({
      id: "source-beta",
      label: "Beta Crypto",
      amount: "200",
      credentialReference: betaReference,
      rate: "7.1",
    }),
  ];
  await services.assetSources.replaceAll(sources);
  await services.cards.replaceAll(sources.map(sourceCard));
  return Response.json({ ok: true });
}

export async function GET() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ days: await getTestServices().dailyAssetSnapshots.list() });
}
