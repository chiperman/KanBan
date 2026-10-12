import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { ObservedFormalSettlementRunner } from "@/server/formal-settlement-execution";
const hook = registerHooks({ resolve(s, c, next) { return next(s === "next/headers" ? "next/headers.js" : s, c); } });
const { SqliteDashboardDatabase, DatabaseFormalSettlementExecutions } = await import("@/server/production");
hook.deregister();

test("顶层异常脱敏并持久化，重建存储后仍可读取最近执行", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-execution-"));
  try {
    const database = () => new SqliteDashboardDatabase(path.join(root, "dashboard.sqlite"));
    const executions = new DatabaseFormalSettlementExecutions(database());
    const clock = { now: () => new Date("2026-09-18T00:05:00.000Z") };
    const runner = new ObservedFormalSettlementRunner({ run: async () => { throw new Error("token=PRIVATE_PROVIDER_SECRET"); } }, executions, clock);
    assert.deepEqual(await runner.run(), { outcome: "error", reason: "execution-failed" });
    const record = await new DatabaseFormalSettlementExecutions(database()).latest();
    assert.deepEqual(record, {
      startedAt: "2026-09-18T00:05:00.000Z", finishedAt: "2026-09-18T00:05:00.000Z",
      outcome: "error", reason: "execution-failed", settlementStatus: null,
    });
    assert.ok(!JSON.stringify(record).includes("PRIVATE_PROVIDER_SECRET"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("较早开始的慢执行最后完成，不覆盖较新执行的持久化结果", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-execution-race-"));
  try {
    const store = () => new DatabaseFormalSettlementExecutions(new SqliteDashboardDatabase(path.join(root, "dashboard.sqlite")));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const old = new ObservedFormalSettlementRunner({ run: async () => { await gate; return { outcome: "error", reason: "source-read-failed" }; } }, store(), { now: () => new Date("2026-09-18T00:00:00.000Z") });
    const pending = old.run();
    const newer = new ObservedFormalSettlementRunner({ run: async () => ({ outcome: "waiting", reason: "official-close-pending" }) }, store(), { now: () => new Date("2026-09-18T00:15:00.000Z") });
    await newer.run();
    release();
    await pending;
    assert.deepEqual(await store().latest(), {
      startedAt: "2026-09-18T00:15:00.000Z", finishedAt: "2026-09-18T00:15:00.000Z",
      outcome: "waiting", reason: "official-close-pending", settlementStatus: null,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("执行记录写入失败时返回安全错误，不声称已保存", async () => {
  const runner = new ObservedFormalSettlementRunner({ run: async () => ({ outcome: "recorded", settlementStatus: "incomplete" }) }, {
    latest: async () => null,
    record: async () => { throw new Error("private-database-path"); },
  }, { now: () => new Date("2026-09-18T00:00:00Z") });
  assert.deepEqual(await runner.run(), { outcome: "error", reason: "execution-record-failed" });
});
