import assert from "node:assert/strict";
import test from "node:test";
import type { AppServices } from "./composition";
import { getTestServices, resetTestServices } from "./testing/composition";
import { clearAllSessions, createSession, destroySession, lookupSession, SESSION_COOKIE } from "./auth/session";
import { SESSION_IDLE_TIMEOUT_MS } from "@/shared/session-policy";
import { GET } from "@/app/api/asset-sources/stream/route";
import type { LongbridgeServeQuote } from "./asset-sources/longbridge-serve-client";
import type { AssetSourceSummary } from "./ports";

for (const cause of ["logout", "timeout-push", "timeout-heartbeat", "abort", "cancel", "reset"] as const) {
  test(`行情流在 ${cause} 后释放订阅并停止发送`, async (t) => {
    const previousEnv = process.env.APP_ENV;
    process.env.APP_ENV = "test";
    resetTestServices();
    let now = new Date("2026-10-02T00:00:00Z");
    const token = createSession("owner", now);
    const services: AppServices = getTestServices();
    services.clock = { now: () => now };
    services.auth = { currentSession: async () => lookupSession(token, now) };
    services.assetSources.list = async () => [{
      kind: "longbridge", lifecycle: "connected", credentialReference: "synthetic-reference",
      snapshot: { holdings: [{ symbol: "AUDIT.US" }] },
    } as AssetSourceSummary];
    let send!: (quote: LongbridgeServeQuote) => void;
    let closed = 0;
    services.longbridgeConnections = { subscribeQuotes(_source: AssetSourceSummary, _symbols: string[], callback: typeof send) {
      send = callback;
      return { close() { closed++; } };
    } } as unknown as NonNullable<AppServices["longbridgeConnections"]>;
    const abort = new AbortController();
    if (cause === "timeout-heartbeat") t.mock.timers.enable({ apis: ["setInterval"] });
    const response = await GET(new Request("http://localhost/api/asset-sources/stream", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    try {
      assert.equal(response.status, 200);
      assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
      if (cause === "logout") destroySession(token);
      if (cause === "reset") clearAllSessions();
      if (cause.startsWith("timeout")) now = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
      if (cause === "abort") abort.abort();
      if (cause === "cancel") await reader.cancel();
      if (cause === "timeout-heartbeat") {
        t.mock.timers.tick(20_000);
      } else {
        send({ symbol: "AUDIT.US", last_done: "123", timestamp: now.toISOString() });
      }
      assert.equal(closed, 1);
      assert.equal((await reader.read()).done, true);
    } finally {
      await reader.cancel();
      clearAllSessions();
      if (previousEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previousEnv;
    }
  });
}
