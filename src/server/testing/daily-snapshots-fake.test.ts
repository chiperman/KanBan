import assert from "node:assert/strict";
import test from "node:test";

import type { DailyAssetSnapshot } from "@/server/ports";
import { InMemoryDailyAssetSnapshots } from "@/server/testing/fakes";

test("部分成功观测首次完整恢复时只建立一份基准和一条同日趋势", async () => {
  const observations = new InMemoryDailyAssetSnapshots();
  const partial: DailyAssetSnapshot = {
    day: "2026-04-01",
    capturedAt: "2026-04-01T08:00:00.000Z",
    complete: true,
    status: "expired",
    total: { USD: "110", CNY: "792", HKD: "858" },
    exchangeRates: [],
    sources: [{
      sourceId: "fixture",
      label: "fixture",
      kind: "longbridge",
      capturedAt: "2026-04-01T08:00:00.000Z",
      complete: true,
      status: "expired",
      total: { USD: "110", CNY: "792", HKD: "858" },
    }],
  };
  await observations.record(partial, false);
  assert.deepEqual(await observations.list(), []);
  assert.deepEqual(await observations.listTrendObservations(), [partial]);

  const complete: DailyAssetSnapshot = {
    ...partial,
    capturedAt: "2026-04-01T09:00:00.000Z",
    status: "complete",
    total: { USD: "100", CNY: "720", HKD: "780" },
    sources: [{
      ...partial.sources[0],
      capturedAt: "2026-04-01T09:00:00.000Z",
      status: "complete",
      total: { USD: "100", CNY: "720", HKD: "780" },
    }],
  };
  await observations.record(complete, true);
  assert.deepEqual(await observations.list(), [complete]);
  assert.deepEqual(await observations.listTrendObservations(), [complete]);
  await observations.record(complete, true);
  assert.deepEqual(await observations.list(), [complete]);
  assert.deepEqual(await observations.listTrendObservations(), [complete]);
});
