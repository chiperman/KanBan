import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppServices } from "./app-services";

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
} });
const { SqliteDashboardDatabase } = await import("./persistence/sqlite-database");
const { getTestServices, resetTestServices } = await import("./composition");
const { GET, POST } = await import("../app/api/investment-books/route");
const { POST: legacyPost } = await import("../app/api/investment-cashflows/route");
const { PATCH: legacyPatch, DELETE: legacyDelete } = await import("../app/api/investment-cashflows/[id]/route");
hook.deregister();

test("三本账 API 拒绝未登录、跨站及错误资产入口，资金与资产独立保存，旧入口停止写入", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "test";
  const root = await mkdtemp(path.join(tmpdir(), "kanban-books-route-"));
  const db = new SqliteDashboardDatabase(path.join(root, "data.sqlite"));
  const at = "2026-10-18T08:00:00Z";
  try {
    await db.createManualAssetSource({ label: "A股" }, at);
    const [source] = await db.listSources();
    await db.setAssetSourceManualClass(source.id, "securities");
    resetTestServices();
    const services: AppServices = getTestServices();
    services.investmentBooks = db;
    services.clock = { now: () => new Date(at) };
    services.manualAssetRecords = {
      create: input => db.createManualAssetSource(input, at),
      list: () => db.listManualAssetRecords(),
      record: (id, input) => db.recordManualAssetSource(id, input, at),
      delete: (id, day) => db.deleteManualAssetSourceRecord(id, day, at),
    };
    let signedIn = false;
    services.auth = { currentSession: async () => signedIn ? {
      ownerId: "owner", authenticatedAt: new Date(at), lastActivityAt: new Date(at),
    } : null };
    const request = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3101/api/investment-books", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    const deposit = { action: "save", bookId: "crypto", record: {
      id: "deposit", day: "2026-10-18", kind: "deposit", amount: "10", currency: "USD",
    } };
    assert.equal((await GET()).status, 401);
    assert.equal((await POST(request(deposit))).status, 401);
    assert.equal(await db.readStoredInvestmentBooks(), undefined);
    signedIn = true;
    assert.equal((await POST(request(deposit, { origin: "https://other.example" }))).status, 403);
    assert.equal((await POST(request(deposit, { "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal(await db.readStoredInvestmentBooks(), undefined);
    assert.equal((await POST(request({ ...deposit, bookId: "missing" }))).status, 400);
    assert.equal((await POST(request(null))).status, 400);
    for (const bookId of ["us-stocks", "crypto"]) {
      assert.equal((await POST(request({ action: "asset", bookId, sourceId: source.id, day: "2026-10-18", amount: "120", currency: "CNY" }))).status, 400);
    }
    assert.equal((await POST(request(deposit, { origin: "http://localhost:3101" }))).status, 200);
    assert.equal((await POST(request(deposit))).status, 200);
    const read = await GET();
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.equal((await read.json()).state.records.length, 1);
    assert.equal((await POST(request({ action: "save", bookId: "crypto", record: { ...deposit.record, id: "value", kind: "valuation" } }))).status, 400);
    const asset = { action: "asset", bookId: "a-shares", sourceId: source.id, day: "2026-10-18", amount: "120", currency: "CNY" };
    assert.equal((await POST(request({ ...asset, currency: "USD" }))).status, 400);
    assert.equal((await POST(request(asset))).status, 200);
    assert.equal((await POST(request({ ...asset, amount: "125" }))).status, 200);
    assert.equal((await db.listManualAssetRecords()).length, 1);
    assert.equal((await db.listManualAssetRecords())[0].amount, "125");
    assert.equal((await db.readInvestmentBooks()).records.length, 1, "资产更新不会隐含新增本金");
    assert.equal((await POST(request({ action: "void", bookId: "crypto", id: "deposit" }))).status, 400);
    assert.equal((await POST(request({ action: "void", bookId: "us-stocks", id: "deposit", confirmation: "VOID_RECORD" }))).status, 400);
    assert.equal((await POST(request({ action: "void", bookId: "crypto", id: "deposit", confirmation: "VOID_RECORD" }))).status, 200);
    assert.ok((await db.readInvestmentBooks()).records[0].voidedAt);
    assert.equal((await legacyPost(request({}))).status, 409);
    const context = { params: Promise.resolve({ id: "old" }) };
    assert.equal((await legacyPatch(request({}), context)).status, 409);
    assert.equal((await legacyDelete(request({}), context)).status, 409);
    assert.deepEqual(await db.listInvestmentCashflows(), []);
  } finally {
    db.close(); resetTestServices();
    if (previous === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous;
    await rm(root, { recursive: true, force: true });
  }
});
