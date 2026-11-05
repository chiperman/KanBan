import assert from "node:assert/strict";
import test from "node:test";

import { AssetSourcePreviewStore } from "@/server/asset-source-onboarding/preview-store";
import {
  AssetSourceOnboardingError,
  type AssetSourceAuthorization,
} from "@/server/asset-source-onboarding/types";

function authorization(): AssetSourceAuthorization {
  return {
    provider: "binance",
    credentials: "test-only-sealed-credentials",
    permissions: ["account", "positions"],
    account: { id: "account-one", label: "测试账户" },
    snapshot: {
      total: { amount: "10", currency: "USD" },
      holdings: [],
      exchangeRates: [],
      syncedAt: "2026-10-13T00:00:00.000Z",
    },
  };
}

test("预览只存凭证密文，独立随机 nonce 且消费时还原原始材料", async () => {
  const store = new AssetSourcePreviewStore();
  const original = authorization();
  const credentials = original.credentials;
  const first = store.remember(original);
  const second = store.remember(original);

  // 安全回归直接检查内部存储，防止公共投影安全但内存仍保留凭证明文。
  const entries = Reflect.get(store, "previews") as Map<string, {
    authorization: Omit<AssetSourceAuthorization, "credentials">;
    credentials: { iv: string; tag: string; value: string };
  }>;
  const stored = entries.get(first)!;
  assert.equal(Object.hasOwn(stored.authorization, "credentials"), false);
  assert.ok(!JSON.stringify([...entries.values()]).includes(credentials));
  assert.equal(Buffer.from(stored.credentials.iv, "base64").length, 12);
  assert.equal(Buffer.from(stored.credentials.tag, "base64").length, 16);
  assert.notEqual(stored.credentials.iv, entries.get(second)!.credentials.iv);
  assert.notEqual(stored.credentials.value, entries.get(second)!.credentials.value);

  original.credentials = "changed-after-preview";
  await store.consume("binance", first, async (opened) => {
    assert.equal(opened.credentials, credentials);
  });
  assert.equal(entries.has(first), false);
  assert.ok(store.publicPreview("binance", second));
  store.cancel("binance", second);
});

test("消费全程保持独占，失败释放占用但不延长 TTL", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new AssetSourcePreviewStore(() => 0, 1_000);
  const id = store.remember(authorization(), {
    sourceId: "source-one", expectedAccountId: "account-one",
  });
  let reject!: (error: Error) => void;
  const pendingWrite = new Promise<void>((_resolve, fail) => { reject = fail; });
  const pending = store.consume("binance", id, async (_opened, reauthorization) => {
    assert.deepEqual(reauthorization, {
      sourceId: "source-one", expectedAccountId: "account-one",
    });
    await pendingWrite;
  });
  assert.equal(store.publicPreview("binance", id), null);
  await assert.rejects(store.consume("binance", id, async () => {
    assert.fail("不应重复调用写入");
  }), (error: unknown) =>
    error instanceof AssetSourceOnboardingError && error.code === "preview-busy");
  context.mock.timers.tick(900);
  const failure = new Error("写入失败");
  reject(failure);
  await assert.rejects(pending, (error: unknown) => error === failure);
  assert.ok(store.publicPreview("binance", id));
  context.mock.timers.tick(100);
  assert.equal(store.publicPreview("binance", id), null);
});

test("定时器在消费中清理到期预览，后续失败不会恢复记录", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new AssetSourcePreviewStore(() => 0, 1_000);
  const id = store.remember(authorization());
  let reject!: (error: Error) => void;
  const paused = new Promise<void>((_resolve, fail) => { reject = fail; });
  const pending = store.consume("binance", id, async () => paused);
  context.mock.timers.tick(1_000);
  reject(new Error("重验失败"));
  await assert.rejects(pending, /重验失败/);
  assert.equal(store.publicPreview("binance", id), null);
  await assert.rejects(store.consume("binance", id, async () => {
    assert.fail("到期后不应调用写入");
  }), (error: unknown) =>
    error instanceof AssetSourceOnboardingError && error.code === "preview-unavailable");
});
