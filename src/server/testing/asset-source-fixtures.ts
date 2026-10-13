import { buildSnapshotFromPositions } from "@/domain/valuation";
import type { AssetSourceSummary } from "@/server/ports";

const REFRESH_INITIAL_AT = "2026-04-01T08:00:00.000Z";
export const DAILY_SNAPSHOT_FIXTURE_AT = "2026-04-01T15:59:50.000Z";

interface SourceFixtureInput {
  id: string;
  kind?: AssetSourceSummary["kind"];
  label: string;
  amount: string;
  credentialReference: string | null;
}

function currentSync(at: string): AssetSourceSummary["sync"] {
  return {
    status: "current",
    lastSuccessfulAt: at,
    lastAttemptAt: at,
    error: null,
  };
}

function valuedSourceFixture(input: SourceFixtureInput & {
  assetClass?: "securities" | "crypto";
  platformProfit?: string | null;
  exchangeRates?: AssetSourceSummary["snapshot"]["exchangeRates"];
  priceSource: string;
  sync: AssetSourceSummary["sync"];
}): AssetSourceSummary {
  return {
    id: input.id,
    kind: input.kind ?? "okx",
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
        priceSource: input.priceSource,
        pricedAt: input.sync.lastSuccessfulAt,
        costPrice: null,
        platformProfit: input.platformProfit ?? null,
        changePercent: null,
      }],
      sourceCurrency: "USD",
      exchangeRates: input.exchangeRates ?? [],
      syncedAt: input.sync.lastSuccessfulAt,
    }),
    sync: input.sync,
  };
}

export function refreshSourceFixture(input: SourceFixtureInput & {
  kind: AssetSourceSummary["kind"];
  credentialReference: string;
}): AssetSourceSummary {
  return valuedSourceFixture({
    ...input,
    priceSource: `${input.label} 初始行情`,
    sync: currentSync(REFRESH_INITIAL_AT),
  });
}

export function dailySnapshotSourceFixture(input: SourceFixtureInput & {
  credentialReference: string;
  assetClass?: "securities" | "crypto";
  platformProfit?: string | null;
  rate?: string;
}): AssetSourceSummary {
  return valuedSourceFixture({
    ...input,
    priceSource: `${input.label} 初始行情`,
    sync: currentSync(DAILY_SNAPSHOT_FIXTURE_AT),
    exchangeRates: [{
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: input.rate ?? "7.2",
      source: "每日快照确定性汇率",
      observedAt: DAILY_SNAPSHOT_FIXTURE_AT,
    }, {
      baseCurrency: "USD",
      quoteCurrency: "HKD",
      rate: "7.8",
      source: "每日快照确定性港币汇率",
      observedAt: DAILY_SNAPSHOT_FIXTURE_AT,
    }],
  });
}

export function dataHealthSourceFixture(input: Omit<SourceFixtureInput, "credentialReference"> & {
  credentialReference?: string | null;
  exchangeRates?: AssetSourceSummary["snapshot"]["exchangeRates"];
  lifecycle?: AssetSourceSummary["lifecycle"];
  sync: AssetSourceSummary["sync"];
}): AssetSourceSummary {
  return {
    ...valuedSourceFixture({
      ...input,
      credentialReference: input.credentialReference === undefined
        ? `test-${input.id}`
        : input.credentialReference,
      priceSource: `${input.label} 确定性行情`,
    }),
    displayName: input.label,
    lifecycle: input.lifecycle ?? "connected",
  };
}
