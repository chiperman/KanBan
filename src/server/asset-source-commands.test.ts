import assert from "node:assert/strict";
import test from "node:test";
import { executeAssetSourceDelete, executeAssetSourcePatch } from "./asset-source-commands";
import { createTestServices } from "./testing/fakes";

async function sourceContext() {
  const all = createTestServices();
  await all.manualAssetRecords.create({ label: "Test source" });
  const [source] = await all.assetSources.list();
  assert.ok(source);
  return {
    all,
    context: {
      id: source.id,
      source,
      services: {
        clock: all.clock,
        assetSourceLifecycle: all.assetSourceLifecycle,
        manualAssetRecords: all.manualAssetRecords,
        assetSourceOnboarding: all.assetSourceOnboarding,
      },
    },
  };
}

test("来源命令只依赖局部服务，省略详情能力仍可管理手工来源", async () => {
  const { all, context } = await sourceContext();
  assert.equal(await executeAssetSourcePatch(context, {
    action: "rename", displayName: "Renamed source",
  }), true);
  assert.equal(await executeAssetSourcePatch(context, {
    action: "visibility", hidden: true,
  }), true);
  assert.equal(await executeAssetSourcePatch(context, {
    action: "manual-record", amount: "100", currency: "USD", day: "2026-01-01",
  }), true);
  assert.equal((await all.assetSources.list())[0].displayName, "Renamed source");
  assert.equal((await all.assetCards.list())[0].hidden, true);
  assert.equal((await all.manualAssetRecords.list())[0].amount, "100");
  assert.equal(await executeAssetSourceDelete(context, {
    action: "manual-record", day: "2026-01-01",
  }), "handled");
  assert.deepEqual(await all.manualAssetRecords.list(), []);
});

test("缺少可选详情能力时拒绝来源记账，其他来源状态不变", async () => {
  const { all, context } = await sourceContext();
  const before = await all.assetSources.list();
  const input = {
    action: "investment-record", id: "flow", day: "2026-01-01",
    kind: "deposit", amount: "100", currency: "USD",
  };
  await assert.rejects(executeAssetSourcePatch(context, input), /来源详情服务不可用/);
  await assert.rejects(executeAssetSourceDelete(context, {
    action: "investment-record", recordId: "flow",
  }), /来源详情服务不可用/);
  assert.deepEqual(await all.assetSources.list(), before);
  assert.deepEqual(await all.manualAssetRecords.list(), []);
});
