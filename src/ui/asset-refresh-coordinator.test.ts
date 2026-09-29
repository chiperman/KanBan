import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import {
  AssetRefreshCoordinator,
  planAssetRefresh,
} from "@/ui/asset-refresh-coordinator";
import type { AssetRefreshIntent } from "@/server/ports";

const INITIAL_AT = "2026-08-20T04:00:00.000Z";
const REFRESHABLE_SOURCE = {
  id: "source-alpha",
  kind: "longbridge",
  lifecycle: "connected" as const,
  credentialReference: "alpha-reference",
};
const REFRESHABLE_SOURCE_BETA = {
  id: "source-beta",
  kind: "binance",
  lifecycle: "connected" as const,
  credentialReference: "beta-reference",
};

test("页面重载恢复服务端在途全量状态并阻止重复手动请求", async () => {
  const calls: AssetRefreshIntent[] = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: async (intent) => {
      calls.push(intent);
      return { successCount: 1, failureCount: 0 };
    },
    schedule: () => null,
    cancel: () => undefined,
  });
  await coordinator.register({
    attemptedAt: INITIAL_AT,
    inProgressAt: INITIAL_AT,
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: true,
  });
  assert.equal(coordinator.globalStatus().state, "refreshing");
  await coordinator.request({ reason: "manual-global" });
  await coordinator.request({ reason: "manual-source", sourceId: REFRESHABLE_SOURCE.id });
  assert.deepEqual(calls, []);
});

test("恢复状态查询失败继续禁用，锁定后丢弃旧查询和页面重读", async () => {
  const timers = new Set<() => void>();
  let queries = 0;
  let pageReads = 0;
  let resolve!: (state: { attemptedAt: string | null; inProgressAt: string | null }) => void;
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: async () => { throw new Error("不应发起刷新"); },
    readState: async () => {
      queries += 1;
      if (queries === 1) throw new Error("network");
      return new Promise((done) => { resolve = done; });
    },
    schedule: (callback, delay) => {
      if (delay === 1_000) timers.add(callback);
      return callback;
    },
    cancel: (handle) => { timers.delete(handle as () => void); },
    onRecovered: () => { pageReads += 1; },
  });
  await coordinator.register({
    attemptedAt: INITIAL_AT,
    inProgressAt: INITIAL_AT,
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: true,
  });
  const first = [...timers][0]!;
  timers.delete(first);
  first();
  await setImmediate();
  assert.equal(coordinator.globalStatus().state, "refreshing");
  assert.equal(timers.size, 1);
  const retry = [...timers][0]!;
  timers.delete(retry);
  retry();
  coordinator.clear();
  resolve({ attemptedAt: INITIAL_AT, inProgressAt: null });
  await setImmediate();
  assert.equal(coordinator.canRefresh, false);
  assert.equal(coordinator.globalStatus().state, "idle");
  assert.equal(timers.size, 0);
  assert.equal(pageReads, 0);
});

test("首次页面注册使用当下可见性与焦点判断到期刷新", async () => {
  const calls: AssetRefreshIntent[] = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: async (intent) => {
      calls.push(intent);
      return {
        attemptedAt: INITIAL_AT,
        successCount: 1,
        failureCount: 0,
      };
    },
    schedule: () => null,
    cancel: () => undefined,
  });

  await coordinator.register({
    attemptedAt: null,
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: true,
  });

  assert.deepEqual(calls, [{ reason: "page-entry" }]);
});

test("自动计划只在可见、有焦点且统一周期到期时申请一次全量", async () => {
  const calls: AssetRefreshIntent[] = [];
  let now = new Date(INITIAL_AT);
  const coordinator = new AssetRefreshCoordinator({
    now: () => now,
    request: async (intent) => {
      calls.push(intent);
      return { successCount: 2, failureCount: 0 };
    },
    schedule: () => null,
    cancel: () => undefined,
  });
  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  coordinator.hydrate({ attemptedAt: INITIAL_AT });
  coordinator.setBrowserState({ visible: true, focused: true });

  assert.deepEqual(
    planAssetRefresh({
      now,
      attemptedAt: INITIAL_AT,
      canRefresh: coordinator.canRefresh,
      visible: true,
      focused: true,
      intent: { reason: "page-entry" },
    }),
    { shouldRequest: false, nextAt: "2026-08-20T05:00:00.000Z" },
  );
  await coordinator.request({ reason: "page-entry" });
  assert.deepEqual(calls, []);

  now = new Date("2026-08-20T05:00:00.000Z");
  const first = coordinator.request({ reason: "foreground" });
  const duplicate = coordinator.request({ reason: "interval" });
  assert.equal(first, duplicate);
  await first;
  assert.deepEqual(calls, [{ reason: "foreground" }]);
});

test("新标签吸收服务端 skipped 锚点并恢复在途状态或安排下一周期", async () => {
  for (const scenario of [{
    skipped: "not-due" as const,
    now: "2026-08-20T04:30:00.000Z",
    attemptedAt: "2026-08-20T04:00:00.000Z",
    expectedDelayMs: 30 * 60 * 1_000,
  }, {
    skipped: "in-progress" as const,
    now: "2026-08-20T04:30:00.000Z",
    attemptedAt: "2026-08-20T04:20:00.000Z",
    expectedDelayMs: 50 * 60 * 1_000,
  }]) {
    const scheduled: Array<{ delayMs: number }> = [];
    const coordinator = new AssetRefreshCoordinator({
      now: () => new Date(scenario.now),
      request: async () => ({
        successCount: 0,
        failureCount: 0,
        skipped: scenario.skipped,
        attemptedAt: scenario.attemptedAt,
      }),
      schedule: (_callback, delayMs) => {
        const handle = { delayMs };
        scheduled.push(handle);
        return handle;
      },
      cancel: () => undefined,
    });
    coordinator.setSources([{
      id: "source-alpha",
      kind: "longbridge",
      lifecycle: "connected",
      credentialReference: "alpha-reference",
    }]);
    coordinator.hydrate({ attemptedAt: null });
    coordinator.setBrowserState({ visible: true, focused: true });

    await coordinator.request({ reason: "page-entry" });

    assert.equal(coordinator.state, scenario.skipped === "in-progress" ? "refreshing" : "idle");
    assert.equal(coordinator.message, "");
    assert.equal(scheduled.at(-1)?.delayMs, scenario.expectedDelayMs);
  }
});

test("自动或手动全量请求异常后从本次尝试开始等待下一统一周期", async () => {
  for (const scenario of [{
    intent: { reason: "page-entry" } as const,
    attemptedAt: null,
  }, {
    intent: { reason: "manual-global" } as const,
    attemptedAt: INITIAL_AT,
  }]) {
    const scheduled: Array<{ delayMs: number }> = [];
    const now = new Date("2026-08-20T05:30:00.000Z");
    const coordinator = new AssetRefreshCoordinator({
      now: () => now,
      request: async () => { throw new Error("network"); },
      schedule: (_callback, delayMs) => {
        const handle = { delayMs };
        scheduled.push(handle);
        return handle;
      },
      cancel: () => undefined,
    });
    coordinator.setSources([{
      id: "source-alpha",
      kind: "longbridge",
      lifecycle: "connected",
      credentialReference: "alpha-reference",
    }]);
    coordinator.hydrate({ attemptedAt: scenario.attemptedAt });
    coordinator.setBrowserState({ visible: true, focused: true });

    await coordinator.request(scenario.intent);

    assert.equal(coordinator.state, "error");
    assert.equal(coordinator.message, "network");
    assert.equal(scheduled.at(-1)?.delayMs, 60 * 60 * 1_000);
  }
});

test("全量网络失败的客户端锚点不会被页面重新注册的旧状态覆盖", async () => {
  const calls: AssetRefreshIntent[] = [];
  let now = new Date("2026-08-20T00:00:00.000Z");
  const coordinator = new AssetRefreshCoordinator({
    now: () => now,
    request: async (intent) => {
      calls.push(intent);
      if (calls.length === 1) throw new Error("network");
      return {
        attemptedAt: now.toISOString(),
        successCount: 1,
        failureCount: 0,
      };
    },
    schedule: () => null,
    cancel: () => undefined,
  });

  await coordinator.register({
    attemptedAt: null,
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: true,
  });
  assert.equal(calls.length, 1);

  now = new Date("2026-08-20T00:01:00.000Z");
  await coordinator.register({
    attemptedAt: null,
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: false,
  });
  await coordinator.reconsiderForeground({ visible: true, focused: true });
  assert.equal(calls.length, 1);

  now = new Date("2026-08-20T00:59:00.000Z");
  await coordinator.register({
    attemptedAt: "2026-08-19T23:00:00.000Z",
    sources: [REFRESHABLE_SOURCE],
    visible: true,
    focused: true,
    pageEntry: false,
  });
  await coordinator.reconsiderForeground({ visible: true, focused: true });
  assert.equal(calls.length, 1);

  now = new Date("2026-08-20T01:00:00.000Z");
  const due = coordinator.reconsiderForeground({ visible: true, focused: true });
  const duplicate = coordinator.reconsiderForeground({
    visible: true,
    focused: true,
  });
  assert.equal(due, duplicate);
  assert.equal(calls.length, 2);
  await due;
});

test("更新锚点可前进且 clear 后新会话重新规划，手动全量仍可绕过周期", async () => {
  const calls: AssetRefreshIntent[] = [];
  let now = new Date("2026-08-20T01:00:00.000Z");
  const coordinator = new AssetRefreshCoordinator({
    now: () => now,
    request: async (intent) => {
      calls.push(intent);
      return {
        attemptedAt: now.toISOString(),
        successCount: 1,
        failureCount: 0,
      };
    },
    schedule: () => null,
    cancel: () => undefined,
  });
  coordinator.setSources([REFRESHABLE_SOURCE]);
  coordinator.setBrowserState({ visible: true, focused: true });
  coordinator.hydrate({ attemptedAt: "2026-08-20T00:00:00.000Z" });
  coordinator.hydrate({ attemptedAt: null });
  coordinator.hydrate({ attemptedAt: "2026-08-19T23:00:00.000Z" });
  coordinator.hydrate({ attemptedAt: "2026-08-20T00:30:00.000Z" });

  await coordinator.reconsiderForeground({ visible: true, focused: true });
  assert.deepEqual(calls, []);

  coordinator.clear();
  now = new Date("2026-08-20T01:01:00.000Z");
  coordinator.setSources([REFRESHABLE_SOURCE]);
  coordinator.setBrowserState({ visible: true, focused: true });
  await coordinator.reconsiderForeground({ visible: true, focused: true });
  assert.deepEqual(calls, [{ reason: "foreground" }]);

  now = new Date("2026-08-20T01:02:00.000Z");
  await coordinator.request({ reason: "manual-global" });
  assert.deepEqual(calls, [
    { reason: "foreground" },
    { reason: "manual-global" },
  ]);
});

test("正常失败报告仍以服务端周期锚点安排下一次尝试", async () => {
  const scheduled: Array<{ delayMs: number }> = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date("2026-08-20T05:30:00.000Z"),
    request: async () => ({
      successCount: 0,
      failureCount: 1,
      attemptedAt: "2026-08-20T05:20:00.000Z",
    }),
    schedule: (_callback, delayMs) => {
      const handle = { delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => undefined,
  });
  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  coordinator.hydrate({ attemptedAt: null });
  coordinator.setBrowserState({ visible: true, focused: true });

  await coordinator.request({ reason: "manual-global" });

  assert.equal(coordinator.state, "error");
  assert.equal(scheduled.at(-1)?.delayMs, 50 * 60 * 1_000);
});

test("手动单来源请求异常不改变统一周期", async () => {
  const scheduled: Array<{ delayMs: number }> = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date("2026-08-20T04:10:00.000Z"),
    request: async () => { throw new Error("network"); },
    schedule: (_callback, delayMs) => {
      const handle = { delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => undefined,
  });
  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  coordinator.hydrate({ attemptedAt: INITIAL_AT });
  coordinator.setBrowserState({ visible: true, focused: true });
  scheduled.length = 0;

  await coordinator.request({ reason: "manual-source", sourceId: "source-alpha" });

  assert.equal(coordinator.state, "error");
  assert.equal(coordinator.message, "network");
  assert.equal(scheduled.at(-1)?.delayMs, 50 * 60 * 1_000);
});

test("恢复可见或重新聚焦都会重新判断且重复事件只合并一份请求", async () => {
  for (const initial of [
    { visible: false, focused: true },
    { visible: true, focused: false },
  ]) {
    const calls: AssetRefreshIntent[] = [];
    let release!: () => void;
    const coordinator = new AssetRefreshCoordinator({
      now: () => new Date("2026-08-20T05:00:00.000Z"),
      request: async (intent) => {
        calls.push(intent);
        await new Promise<void>((resolve) => { release = resolve; });
        return { successCount: 1, failureCount: 0 };
      },
      schedule: () => null,
      cancel: () => undefined,
    });
    await coordinator.register({
      attemptedAt: INITIAL_AT,
      sources: [REFRESHABLE_SOURCE],
      ...initial,
      pageEntry: true,
    });
    assert.deepEqual(calls, []);

    const first = coordinator.reconsiderForeground({
      visible: true,
      focused: true,
    });
    const duplicate = coordinator.reconsiderForeground({
      visible: true,
      focused: true,
    });

    assert.equal(first, duplicate);
    assert.deepEqual(calls, [{ reason: "foreground" }]);
    release();
    await first;
  }
});

test("失焦期间不请求或保留定时器，恢复前台只重新判断一次", async () => {
  const calls: AssetRefreshIntent[] = [];
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const cancelled: unknown[] = [];
  let now = new Date(INITIAL_AT);
  const coordinator = new AssetRefreshCoordinator({
    now: () => now,
    request: async (intent) => {
      calls.push(intent);
      return { successCount: 1, failureCount: 0 };
    },
    schedule: (callback, delayMs) => {
      const handle = { callback, delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: (handle) => { cancelled.push(handle); },
  });
  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  coordinator.hydrate({ attemptedAt: INITIAL_AT });
  coordinator.setBrowserState({ visible: true, focused: true });
  assert.equal(scheduled.at(-1)?.delayMs, 60 * 60 * 1_000);

  coordinator.setBrowserState({ visible: true, focused: false });
  assert.equal(cancelled.length, 1);
  now = new Date("2026-08-20T05:30:00.000Z");
  await coordinator.request({ reason: "interval" });
  assert.deepEqual(calls, []);

  coordinator.setBrowserState({ visible: true, focused: true });
  await coordinator.request({ reason: "foreground" });
  await coordinator.request({ reason: "foreground" });
  assert.deepEqual(calls, [{ reason: "foreground" }]);
});

test("没有可刷新来源时不创建计划或请求，连接后恢复计划", async () => {
  const calls: AssetRefreshIntent[] = [];
  const scheduled: Array<{ delayMs: number }> = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: async (intent) => {
      calls.push(intent);
      return { successCount: 1, failureCount: 0 };
    },
    schedule: (_callback, delayMs) => {
      const handle = { delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => undefined,
  });

  coordinator.hydrate({ attemptedAt: INITIAL_AT });
  coordinator.setBrowserState({ visible: true, focused: true });
  await coordinator.request({ reason: "page-entry" });
  assert.equal(coordinator.canRefresh, false);
  assert.deepEqual(calls, []);
  assert.equal(scheduled.length, 0);

  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  assert.equal(coordinator.canRefresh, true);
  assert.equal(scheduled.at(-1)?.delayMs, 60 * 60 * 1_000);
});

test("手动全量重置周期，手动单来源不改变下一次自动到期", async () => {
  const calls: AssetRefreshIntent[] = [];
  const scheduled: Array<{ delayMs: number }> = [];
  let now = new Date("2026-08-20T04:10:00.000Z");
  const coordinator = new AssetRefreshCoordinator({
    now: () => now,
    request: async (intent) => {
      calls.push(intent);
      return { successCount: 1, failureCount: 0 };
    },
    schedule: (_callback, delayMs) => {
      const handle = { delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => undefined,
  });
  coordinator.setSources([{
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected",
    credentialReference: "alpha-reference",
  }]);
  coordinator.hydrate({ attemptedAt: INITIAL_AT });
  coordinator.setBrowserState({ visible: true, focused: true });

  await coordinator.request({ reason: "manual-source", sourceId: "source-alpha" });
  assert.equal(scheduled.at(-1)?.delayMs, 50 * 60 * 1_000);

  await coordinator.request({ reason: "manual-global" });
  assert.equal(scheduled.at(-1)?.delayMs, 60 * 60 * 1_000);
  assert.deepEqual(calls, [
    { reason: "manual-source", sourceId: "source-alpha" },
    { reason: "manual-global" },
  ]);
});

test("清除计划后脱离在途请求，旧完成不会阻塞新的页面生命周期", async () => {
  const resolvers: Array<() => void> = [];
  const calls: AssetRefreshIntent[] = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: async (intent) => {
      calls.push(intent);
      await new Promise<void>((resolve) => { resolvers.push(resolve); });
      return { successCount: 1, failureCount: 0 };
    },
    schedule: () => null,
    cancel: () => undefined,
  });
  const source = {
    id: "source-alpha",
    kind: "longbridge",
    lifecycle: "connected" as const,
    credentialReference: "alpha-reference",
  };
  coordinator.setSources([source]);
  const first = coordinator.request({ reason: "manual-global" });
  coordinator.clear();
  coordinator.setSources([source]);
  const second = coordinator.request({ reason: "manual-global" });
  assert.equal(calls.length, 2);

  resolvers[0]!();
  await first;
  assert.equal(
    coordinator.request({ reason: "manual-global" }),
    second,
  );
  assert.equal(calls.length, 2);

  resolvers[1]!();
  await second;
  assert.equal(coordinator.state, "success");
});

test("单来源 A 完成不会提前结束排队中的 B，B 失败固定显示刷新失败", async () => {
  const resolvers = new Map<
    string,
    (report: { successCount: number; failureCount: number }) => void
  >();
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: (intent) => new Promise((resolve) => {
      assert.equal(intent.reason, "manual-source");
      resolvers.set(intent.sourceId, resolve);
    }),
    schedule: () => null,
    cancel: () => undefined,
  });
  coordinator.setSources([REFRESHABLE_SOURCE, REFRESHABLE_SOURCE_BETA]);

  const alpha = coordinator.request({
    reason: "manual-source",
    sourceId: "source-alpha",
  });
  const beta = coordinator.request({
    reason: "manual-source",
    sourceId: "source-beta",
  });
  assert.equal(coordinator.sourceStatus("source-alpha").state, "refreshing");
  assert.equal(coordinator.sourceStatus("source-beta").state, "refreshing");

  resolvers.get("source-alpha")!({ successCount: 1, failureCount: 0 });
  await alpha;
  assert.equal(coordinator.sourceStatus("source-alpha").state, "success");
  assert.equal(coordinator.sourceStatus("source-beta").state, "refreshing");
  assert.equal(coordinator.state, "refreshing");

  resolvers.get("source-beta")!({ successCount: 0, failureCount: 1 });
  await beta;
  assert.equal(coordinator.sourceStatus("source-beta").state, "error");
  assert.equal(coordinator.sourceStatus("source-beta").message, "刷新失败");
});

test("单来源 A 完成不会提前结束其后排队的全量刷新", async () => {
  const resolvers: Array<
    (report: { successCount: number; failureCount: number }) => void
  > = [];
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: () => new Promise((resolve) => { resolvers.push(resolve); }),
    schedule: () => null,
    cancel: () => undefined,
  });
  coordinator.setSources([REFRESHABLE_SOURCE, REFRESHABLE_SOURCE_BETA]);

  const alpha = coordinator.request({
    reason: "manual-source",
    sourceId: "source-alpha",
  });
  const full = coordinator.request({ reason: "manual-global" });
  assert.equal(coordinator.sourceStatus("source-alpha").state, "refreshing");
  assert.equal(coordinator.globalStatus().state, "refreshing");

  resolvers[0]!({ successCount: 1, failureCount: 0 });
  await alpha;
  assert.equal(coordinator.sourceStatus("source-alpha").state, "success");
  assert.equal(coordinator.globalStatus().state, "refreshing");
  assert.equal(coordinator.state, "refreshing");

  resolvers[1]!({ successCount: 2, failureCount: 0 });
  await full;
  assert.equal(coordinator.globalStatus().state, "success");
  assert.equal(coordinator.state, "success");
});

test("在途全量覆盖当前来源并复用同一请求", async () => {
  const calls: AssetRefreshIntent[] = [];
  let resolveFull!: (report: {
    successCount: number;
    failureCount: number;
  }) => void;
  const coordinator = new AssetRefreshCoordinator({
    now: () => new Date(INITIAL_AT),
    request: (intent) => {
      calls.push(intent);
      return new Promise((resolve) => { resolveFull = resolve; });
    },
    schedule: () => null,
    cancel: () => undefined,
  });
  coordinator.setSources([REFRESHABLE_SOURCE]);

  const full = coordinator.request({ reason: "manual-global" });
  const coveredSource = coordinator.request({
    reason: "manual-source",
    sourceId: "source-alpha",
  });

  assert.equal(coveredSource, full);
  assert.deepEqual(calls, [{ reason: "manual-global" }]);
  assert.equal(coordinator.globalStatus().state, "refreshing");

  resolveFull({ successCount: 1, failureCount: 0 });
  await full;
  assert.equal(coordinator.globalStatus().state, "success");
});

test("自动刷新成功、部分失败与全部失败均保持静默反馈", async () => {
  for (const report of [
    { successCount: 2, failureCount: 0 },
    { successCount: 1, failureCount: 1 },
    { successCount: 0, failureCount: 2 },
  ]) {
    const coordinator = new AssetRefreshCoordinator({
      now: () => new Date("2026-08-20T05:00:00.000Z"),
      request: async () => report,
      schedule: () => null,
      cancel: () => undefined,
    });
    coordinator.setSources([{
      id: "source-alpha",
      kind: "longbridge",
      lifecycle: "connected",
      credentialReference: "alpha-reference",
    }]);
    coordinator.hydrate({ attemptedAt: INITIAL_AT });
    coordinator.setBrowserState({ visible: true, focused: true });

    await coordinator.request({ reason: "interval" });

    assert.equal(coordinator.feedback, "silent");
    assert.equal(
      coordinator.state,
      report.failureCount === 0
        ? "success"
        : report.successCount === 0
          ? "error"
          : "partial",
    );
  }
});
