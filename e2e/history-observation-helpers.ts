import { expect, type APIRequestContext } from "@playwright/test";

import type { DailyAssetSnapshot } from "../src/server/ports";

export const REPORTING_RATE_SOURCE_ID = "history-longbridge-rates";

export async function seedReportingRates(request: APIRequestContext) {
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-reporting-rates" },
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ sourceId: REPORTING_RATE_SOURCE_ID });
}

export async function expectCompleteHistory(
  request: APIRequestContext,
  sourceIds: string[],
  day = "2026-01-01",
) {
  const response = await request.get("/test-doubles/daily-snapshots");
  expect(response.ok()).toBeTruthy();
  const history = await response.json() as {
    baselines: DailyAssetSnapshot[];
    trendObservations: DailyAssetSnapshot[];
  };
  for (const observations of [history.baselines, history.trendObservations]) {
    const observation = observations.find((item) => item.day === day);
    expect(observation).toMatchObject({ complete: true, status: "complete" });
    expect(observation!.sources.map(({ sourceId }) => sourceId).sort()).toEqual(
      [...sourceIds, REPORTING_RATE_SOURCE_ID].sort(),
    );
    for (const source of observation!.sources) {
      expect(source).toMatchObject({ complete: true, status: "complete" });
      for (const currency of ["USD", "CNY", "HKD"] as const) {
        expect(source.total[currency]).toMatch(/^\d+(?:\.\d+)?$/);
      }
    }
    expect(observation!.sources.find(({ sourceId }) => sourceId === REPORTING_RATE_SOURCE_ID)?.total)
      .toEqual({ USD: "0", CNY: "0", HKD: "0" });
    expect(observation!.exchangeRates).toEqual(expect.arrayContaining(
      ["CNY", "HKD"].map((quoteCurrency) => expect.objectContaining({
        baseCurrency: "USD", quoteCurrency, observedAt: observation!.capturedAt,
        source: "Longbridge 测试汇率观测",
      })),
    ));
  }
  return history;
}

export async function prepareCompleteHistory(
  request: APIRequestContext,
  sourceIds: string[],
  day = "2026-01-01",
) {
  await seedReportingRates(request);
  // Exercise the real full-batch recorder rather than forcing completeness flags.
  const response = await request.post("/api/asset-sources/refresh", {
    data: { mode: "all", intent: { reason: "manual-global" } },
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    successCount: sourceIds.length,
    failureCount: 0,
  });
  return expectCompleteHistory(request, sourceIds, day);
}
