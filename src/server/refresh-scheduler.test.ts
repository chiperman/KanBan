import assert from "node:assert/strict";
import test from "node:test";
import type { AssetRefreshReport } from "@/server/ports";
import { RefreshScheduler, type RefreshPlan } from "./refresh-scheduler";

test("排队单来源升级为全量后共用请求且不与当前批次并发", async () => {
  const plans: RefreshPlan[] = [];
  let finish!: (report: AssetRefreshReport) => void;
  const scheduler = new RefreshScheduler(async (plan) => {
    plans.push(plan);
    if (plans.length === 1) return new Promise((resolve) => { finish = resolve; });
    return { successCount: 2, failureCount: 0 };
  });
  const active = scheduler.request({ intent: { reason: "manual-source", sourceId: "alpha" } });
  await Promise.resolve();
  const pending = scheduler.request({ intent: { reason: "manual-source", sourceId: "beta" } });
  assert.equal(scheduler.request({ intent: { reason: "manual-global" } }), pending);
  assert.equal(plans.length, 1);
  finish({ successCount: 1, failureCount: 0 });
  await active;
  assert.deepEqual(await pending, { successCount: 2, failureCount: 0 });
  assert.equal(plans.length, 2);
  assert.equal(plans[1].kind, "unified");
  if (plans[1].kind === "unified") {
    assert.equal(plans[1].full, true);
    assert.equal(plans[1].automatic, false);
    assert.equal(plans[1].sourceIds.size, 0);
  }
});

test("批次异常释放队列并继续执行后续来源", async () => {
  const plans: RefreshPlan[] = [];
  let fail!: (error: Error) => void;
  const scheduler = new RefreshScheduler(async (plan) => {
    plans.push(plan);
    if (plans.length === 1) return new Promise((_, reject) => { fail = reject; });
    return { successCount: 1, failureCount: 0 };
  });
  const first = scheduler.request({ intent: { reason: "manual-source", sourceId: "alpha" } });
  const rejected = assert.rejects(first, /fixture failure/);
  await Promise.resolve();
  const next = scheduler.request({ intent: { reason: "manual-source", sourceId: "beta" } });
  fail(new Error("fixture failure"));
  await rejected;
  assert.deepEqual(await next, { successCount: 1, failureCount: 0 });
  assert.equal(plans.length, 2);
});
