import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  AppServices,
  AssetServices,
  AssetObservationServices,
  MarketServices,
  OwnerServices,
  ProductionAppServices,
} from "./app-services";
import type { AppServices as LegacyAppServices } from "./composition";
import { executeAssetSourceDelete, executeAssetSourcePatch } from "./asset-source-commands";
import type { AssetSourceDetails } from "./ports";
import { createProductionServices } from "./production";

function checkRequiredDetails(services: AppServices): void {
  // @ts-expect-error Production services cannot omit the detail capability.
  const production: ProductionAppServices = services;
  // @ts-expect-error A present detail capability cannot omit investment history queries.
  const partial: AssetSourceDetails = { ...production.assetSourceDetails, listSourceInvestmentHistories: undefined };
  void partial;
}
void checkRequiredDetails;

test("正式组合保留平面服务及旧类型入口，完整详情能力使用临时 SQLite", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-service-contract-"));
  const previousClientId = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  process.env.LONGBRIDGE_OAUTH_CLIENT_ID = "test-only-service-contract-client";
  t.after(async () => {
    if (previousClientId === undefined) delete process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
    else process.env.LONGBRIDGE_OAUTH_CLIENT_ID = previousClientId;
    await rm(root, { recursive: true, force: true });
  });
  const services = createProductionServices(root);
  try {
    await services.secrets.get("missing-test-reference");
    const legacy: LegacyAppServices = services;
    const assets: AssetServices = services;
    const observations: AssetObservationServices = services;
    const market: MarketServices = services;
    const owner: OwnerServices = services;
    assert.equal(legacy, services);
    assert.equal(assets.assetSources, services.assetSources);
    assert.equal(observations.assetSynchronization, services.assetSynchronization);
    assert.equal(market.longbridge, services.longbridge);
    assert.equal(owner.auth, services.auth);
    assert.deepEqual(await services.assetSourceDetails.listSourceInvestmentHistories(), []);

    const now = "2026-01-02T12:00:00.000Z";
    await assets.manualAssetRecords.create({ label: "Test source" });
    const [source] = await assets.assetSources.list();
    assert.ok(source);
    const context = {
      id: source.id,
      source,
      services: {
        clock: { now: () => new Date(now) },
        assetSourceDetails: services.assetSourceDetails,
        assetSourceLifecycle: assets.assetSourceLifecycle,
        manualAssetRecords: assets.manualAssetRecords,
        assetSourceOnboarding: assets.assetSourceOnboarding,
      },
    };
    const input = {
      action: "investment-record", id: "flow", day: "2026-01-01",
      kind: "deposit", amount: "100", currency: "USD",
    };
    assert.equal(await executeAssetSourcePatch(context, input), true);
    const records = await services.assetSourceDetails.listSourceInvestmentRecords(source.id);
    assert.equal(records.length, 1);
    assert.equal(records[0].recordedAt, now);
    const detail = await services.assetSourceDetails.readSourceDetail({ sourceId: source.id });
    assert.equal(detail.sources[0].id, source.id);
    assert.deepEqual(detail.investmentRecords, records);
    assert.equal(detail.firstDay, "2026-01-01");
    assert.equal(await executeAssetSourceDelete(context, {
      action: "investment-record", recordId: "flow",
    }), "handled");
    assert.deepEqual(await services.assetSourceDetails.listSourceInvestmentRecords(source.id), []);
  } finally {
    (services.assetSourceDetails as unknown as { database: DatabaseSync }).database.close();
  }
});
