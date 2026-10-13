import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import { consumeChallenge, issueChallenge } from "@/server/auth/challenges";
import {
  canAttemptRecoveryTotp,
  completeRecoveryTotpAttempt,
  lookupSession,
  onSessionInvalidated,
  SESSION_COOKIE,
} from "@/server/auth/session";
import type { TestServices } from "@/server/testing/fakes";
import { refreshSourceFixture } from "@/server/testing/asset-source-fixtures";

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
const { getTestServices, resetTestServices } = await import("@/server/composition");
const { testGuard, createTestOwnerSessionResponse, resetTestStateResponse } =
  await import("@/server/testing/route-support");
const root = new URL("../../app/test-doubles/", import.meta.url);
const routes = await Promise.all((await readdir(root, { recursive: true }))
  .filter((file) => file.endsWith("route.ts")).sort()
  .map(async (file) => ({ file, handlers: await import(new URL(file, root).href) })));
hook.deregister();

async function withTestServices(run: (services: TestServices) => Promise<void>) {
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  resetTestServices();
  try {
    await run(getTestServices());
  } finally {
    process.env.APP_ENV = "test";
    resetTestServices();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  }
}

function sessionToken(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  const match = cookie.match(new RegExp(`^${SESSION_COOKIE}=([^;]+); Path=/; HttpOnly; SameSite=Strict$`));
  assert.ok(match, cookie);
  return match[1];
}

test("所有测试替身入口仅允许精确的 test 环境且在读取请求前拒绝访问", async () => {
  await withTestServices(async (services) => {
    const now = services.clock.now();
    const token = sessionToken(createTestOwnerSessionResponse());
    const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
    const request = new Proxy({} as Request, {
      get(_target, key) { throw new Error(`守卫前读取请求: ${String(key)}`); },
    });
    for (const env of [undefined, "production", "development", "TEST", "test "]) {
      if (env === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = env;
      const guard = testGuard();
      assert.equal(guard?.status, 404);
      for (const { file, handlers } of routes) {
        for (const method of ["GET", "POST"] as const) {
          if (typeof handlers[method] !== "function") continue;
          const response = await handlers[method](request);
          assert.equal(response.status, 404, `${env}: ${method} ${file}`);
          assert.deepEqual(await response.json(), { error: "not found" });
          assert.equal(response.headers.get("set-cookie"), null);
        }
      }
      for (const operation of [resetTestStateResponse, createTestOwnerSessionResponse]) {
        const response = operation();
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("set-cookie"), null);
      }
      assert.equal(process.env.PAD_SECRET_ENCRYPTION_KEY, previousKey);
      assert.ok(lookupSession(token, now));
      process.env.APP_ENV = "test";
      assert.equal(getTestServices(), services);
    }
    assert.equal(testGuard(), null);
  });
});

test("owner-session 使用替身时钟并保留独立会话和原 Cookie 约定", async () => {
  await withTestServices(async (services) => {
    services.clock.set("2030-01-02T03:04:00.000Z");
    const route = routes.find(({ file }) => file === "owner-session/route.ts")!;
    const response = await route.handlers.POST();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const token = sessionToken(response);
    const second = sessionToken(await route.handlers.POST());
    assert.notEqual(token, second);
    assert.deepEqual(lookupSession(token, services.clock.now()), {
      ownerId: "test-owner",
      authenticatedAt: services.clock.now(),
      lastActivityAt: services.clock.now(),
    });
    assert.ok(lookupSession(second, services.clock.now()));
  });
});

test("reset 重建替身、清空挑战及恢复限流并撤销全部旧会话", async () => {
  await withTestServices(async (services) => {
    services.clock.set("2030-01-02T03:04:00.000Z");
    const now = services.clock.now();
    const reference = await services.secrets.put("reset-secret");
    const initialSources = await services.assetSources.list();
    await services.assetSources.replaceAll([refreshSourceFixture({
      id: "source-reset", kind: "okx", label: "Reset source", amount: "100", credentialReference: reference,
    })]);
    await services.ownerCredentials.save({ id: "reset-owner", publicKey: "reset-key", counter: 1 });
    const tokens = [sessionToken(createTestOwnerSessionResponse()), sessionToken(createTestOwnerSessionResponse())];
    let invalidated = 0;
    for (const token of tokens) onSessionInvalidated(token, () => { invalidated += 1; });
    const context = { purpose: "login" as const, origin: "http://localhost", rpID: "localhost", credentialId: null };
    const challenge = issueChallenge(context, "reset-challenge", null, now);
    for (let attempt = 0; attempt < 5; attempt++) completeRecoveryTotpAttempt(false, now);
    assert.equal(canAttemptRecoveryTotp(now), false);

    const route = routes.find(({ file }) => file === "reset/route.ts")!;
    const response = await route.handlers.POST();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("set-cookie"), null);
    const clean = getTestServices();
    assert.notEqual(clean, services);
    assert.equal(clean.clock.now().toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(await clean.secrets.get(reference), null);
    assert.deepEqual(await clean.assetSources.list(), initialSources);
    assert.equal(await clean.ownerCredentials.get(), null);
    assert.equal(invalidated, tokens.length);
    for (const token of tokens) assert.equal(lookupSession(token, now), null);
    assert.equal(consumeChallenge(challenge, context, now), null);
    assert.equal(canAttemptRecoveryTotp(now), true);
    assert.ok(lookupSession(sessionToken(createTestOwnerSessionResponse()), clean.clock.now()));
    assert.equal(resetTestStateResponse().status, 200);
    assert.equal(invalidated, tokens.length);
  });
});
