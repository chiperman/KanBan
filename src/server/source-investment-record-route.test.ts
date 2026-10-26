import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AppServices } from "./composition";

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
const { SqliteDashboardDatabase } = await import("./persistence/sqlite-database");
const { getTestServices, resetTestServices } = await import("./testing/composition");
const { PATCH, DELETE } = await import("../app/api/asset-sources/[id]/route");
hook.deregister();

test("旧投资记录 API 身份与来源隔离、跨站拒绝、原件只读", async () => {
  const oldEnv = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  const root = await mkdtemp(path.join(tmpdir(), "kanban-record-route-"));
  const db = new SqliteDashboardDatabase(path.join(root, "route.sqlite"));
  try {
    const now = "2026-09-29T12:00:00Z";
    await db.createManualAssetSource({ label: "一" }, now);
    await db.createManualAssetSource({ label: "二" }, now);
    const [a, b] = await db.listSources();
    assert.ok(a && b);
    resetTestServices();
    const services: AppServices = getTestServices();
    services.clock = { now: () => new Date(now) };
    services.assetSources.list = () => db.listSources();
    services.assetSourceDetails = db;
    services.investmentBooks = db;
    let signedIn = false;
    services.auth = { currentSession: async () => signedIn ? { ownerId: "owner", authenticatedAt: new Date(now), lastActivityAt: new Date(now) } : null };
    const payload = { action: "investment-record", id: "flow", day: "2026-09-01", kind: "deposit", amount: "100", currency: "CNY" };
    const call = async (method: "PATCH" | "DELETE", sourceId: string, body: object, headers: Record<string, string> = {}): Promise<Response> => {
      const request = new Request("http://localhost:3101/api/asset-sources/" + sourceId, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      const context = { params: Promise.resolve({ id: sourceId }) };
      const response = await (method === "PATCH" ? PATCH(request, context) : DELETE(request, context));
      assert.ok(response);
      return response;
    };
    assert.equal((await call("PATCH", a.id, payload)).status, 401);
    assert.equal((await call("DELETE", a.id, { action: "investment-record", recordId: "flow" })).status, 401);
    signedIn = true;
    assert.equal((await call("PATCH", a.id, payload, { origin: "https://attacker.example" })).status, 403);
    assert.equal((await call("PATCH", a.id, payload, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await call("DELETE", a.id, { action: "investment-record", recordId: "flow" }, { origin: "https://attacker.example" })).status, 403);
    assert.deepEqual(await db.listSourceInvestmentRecords(), []);
    assert.equal((await call("PATCH", "missing", payload)).status, 404);
    for (const kind of ["binance", "longbridge"] as const) {
      const source = { ...a, id: kind, kind, accountId: kind + "-account" };
      await db.replaceSources([...(await db.listSources()), source]);
      for (const action of ["manual-record", "investment-record"]) {
        const save = await call("PATCH", source.id, { ...payload, action });
        assert.equal(save.status, 400);
        assert.match((await save.json()).error, action === "manual-record" ? /只有手工资产/ : /资金记账已统一到三本账/);
        assert.equal((await call("DELETE", source.id, {
          action, recordId: "flow", day: payload.day,
        })).status, 400);
      }
    }
    assert.deepEqual(await db.listSourceInvestmentRecords(), []);
    await db.saveSourceInvestmentRecord(a.id, {
      id: "flow", day: payload.day, kind: "deposit", amount: "100", currency: "CNY",
    }, now);
    const originals = await db.listSourceInvestmentRecords();
    const sameSiteHeaders: Record<string, string>[] = [{}, { origin: "http://localhost:3101" }];
    for (const source of [a, b]) {
      for (const headers of sameSiteHeaders) {
        const save = await call("PATCH", source.id, { ...payload, kind: "withdrawal", amount: "20" }, headers);
        assert.equal(save.status, 400);
        assert.match((await save.json()).error, /资金记账已统一到三本账/);
        const remove = await call("DELETE", source.id, { action: "investment-record", recordId: "flow" }, headers);
        assert.equal(remove.status, 400);
        assert.match((await remove.json()).error, /旧原件保留只读/);
      }
    }
    assert.deepEqual(await db.listSourceInvestmentRecords(), originals);
    assert.deepEqual(await db.listSourceInvestmentRecords(b.id), []);
  } finally {
    (db as unknown as { database: DatabaseSync }).database.close();
    resetTestServices();
    if (oldEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldEnv;
    await rm(root, { recursive: true, force: true });
  }
});
