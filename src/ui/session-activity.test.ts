import assert from "node:assert/strict";
import test from "node:test";
import { trackSessionActivity, ACTIVITY_COALESCE_MS } from "./session-activity";
import { SESSION_IDLE_TIMEOUT_MS } from "@/shared/session-policy";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test("突发活动合并、同一时刻仅一个请求并发送尾部活动", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let calls = 0;
  let complete!: (value: { status: number; ok: boolean }) => void;
  const tracker = trackSessionActivity({ visible: () => true, lock: () => assert.fail("unexpected lock"), notify: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  for (let i = 0; i < 100; i++) tracker.activity();
  t.mock.timers.tick(ACTIVITY_COALESCE_MS * 2);
  assert.equal(calls, 1);
  complete({ status: 200, ok: true }); await flush(); t.mock.timers.tick(0);
  assert.equal(calls, 2);
  tracker.dispose(); complete({ status: 200, ok: true }); await flush();
  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS);
  assert.equal(calls, 2);
});
test("持续活动不能无限延长离线会话，隐藏页面不发送心跳", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let locks = 0, calls = 0;
  let visible = true;
  const tracker = trackSessionActivity({ visible: () => visible, lock: () => { locks++; }, notify: async () => { calls++; throw new Error("offline"); } });
  await flush();
  visible = false;
  tracker.visibilityChanged();
  t.mock.timers.tick(ACTIVITY_COALESCE_MS * 2); await flush();
  assert.equal(calls, 1);
  visible = true;
  for (let i = 0; i < 30; i++) { tracker.activity(); await flush(); t.mock.timers.tick(ACTIVITY_COALESCE_MS); await flush(); }
  assert.equal(locks, 1);
  tracker.dispose();
});
test("401立即锁定", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let locks = 0;
  const tracker = trackSessionActivity({ visible: () => true, lock: () => { locks++; }, notify: async () => ({ status: 401, ok: false }) });
  await flush(); assert.equal(locks, 1); tracker.dispose();
});
