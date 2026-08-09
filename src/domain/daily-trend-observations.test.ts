import assert from "node:assert/strict";
import test from "node:test";

import {
  daysForTrendRange,
  sourceTrendObservationStatus,
  totalTrendObservationStatus,
} from "@/domain/daily-trend-observations";

test("趋势区间保留连续上海自然日，包括没有观测的日期", () => {
  assert.deepEqual(
    daysForTrendRange("all", "2026-08-09", "2026-08-06"),
    ["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"],
  );
  assert.deepEqual(
    daysForTrendRange("7d", "2026-08-09"),
    [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ],
  );
});

test("来源趋势保留过期状态，兼容旧观测的完整性标记", () => {
  assert.equal(
    sourceTrendObservationStatus({ complete: true, status: "expired" }),
    "expired",
  );
  assert.equal(
    sourceTrendObservationStatus({ complete: false }),
    "incomplete",
  );
});

test("总资产趋势只由自动来源决定过期与不完整状态", () => {
  assert.equal(
    totalTrendObservationStatus([
      { kind: "longbridge", complete: true, status: "complete" },
      { kind: "manual", complete: false, status: "expired" },
    ]),
    "complete",
  );
  assert.equal(
    totalTrendObservationStatus([
      { kind: "binance", complete: true, status: "expired" },
      { kind: "manual", complete: true, status: "complete" },
    ]),
    "expired",
  );
});
