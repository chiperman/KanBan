import assert from "node:assert/strict";
import test from "node:test";
import { createSession, lookupSession } from "./auth/session";
import { getServices, getTestServices, resetTestServices } from "./composition";

test("组合根复用完整服务，测试重置清空状态和会话", async (t) => {
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  t.after(() => {
    resetTestServices();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  });

  resetTestServices();
  const services = getTestServices();
  assert.equal(services.assetSourceDetails, undefined);
  assert.equal(getServices(), services);
  assert.equal(getTestServices(), services);
  await services.manualAssetRecords.create({ label: "Test source" });
  const now = services.clock.now();
  const session = createSession("owner", now);
  assert.ok(lookupSession(session, now));

  resetTestServices();
  const reset = getTestServices();
  assert.notEqual(reset, services);
  assert.equal(getServices(), reset);
  assert.deepEqual(await reset.assetSources.list(), []);
  assert.equal(lookupSession(session, now), null);
});

test("非测试环境拒绝访问和重置测试服务", () => {
  const previousEnv = process.env.APP_ENV;
  delete process.env.APP_ENV;
  try {
    assert.throws(getTestServices, /测试替身仅在 APP_ENV=test 时可用/);
    assert.throws(resetTestServices, /测试替身仅在 APP_ENV=test 时可用/);
  } finally {
    if (previousEnv !== undefined) process.env.APP_ENV = previousEnv;
  }
});

test("可选来源详情必须是完整能力，旧缓存缺方法时重建服务", async (t) => {
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  t.after(() => {
    resetTestServices();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  });

  const details = {
    async readSourceDetail() {
      return { sources: [], manualRecords: [], history: [], investmentRecords: [] };
    },
    async listSourceInvestmentHistories() { return []; },
    async listSourceInvestmentRecords() { return []; },
    async saveSourceInvestmentRecord() {},
    async deleteSourceInvestmentRecord() {},
  };
  resetTestServices();
  const complete = getTestServices();
  complete.assetSourceDetails = details;
  assert.equal(getServices(), complete);

  for (const method of Object.keys(details)) {
    await t.test(method, () => {
      resetTestServices();
      const stale = getTestServices();
      const partial: Record<string, unknown> = { ...details };
      delete partial[method];
      Object.assign(stale, { assetSourceDetails: partial });
      assert.notEqual(getServices(), stale);
    });
  }
});
