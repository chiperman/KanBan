import assert from "node:assert/strict";
import test from "node:test";

import {
  AssetSourceOnboarding,
  AssetSourceOnboardingError,
  type AssetSourceAuthorization,
  type AssetSourceProviderAdapter,
} from "@/server/asset-source-onboarding";

const PREVIEW_AT = "2026-10-13T00:00:00.000Z";
const CONFIRM_AT = "2026-10-13T00:01:00.000Z";

function authorization(): AssetSourceAuthorization {
  return {
    provider: "binance",
    credentials: "test-only-read-credentials",
    permissions: ["account", "positions"],
    account: { id: "account-one", label: "测试账户" },
    snapshot: {
      total: { amount: "10", currency: "USD" },
      holdings: [],
      exchangeRates: [],
      syncedAt: PREVIEW_AT,
    },
  };
}

function harness(overrides: Partial<AssetSourceProviderAdapter> = {}) {
  const original = authorization();
  const connections: [AssetSourceAuthorization, string | undefined][] = [];
  const revalidations: [AssetSourceAuthorization, string][] = [];
  let now = 0;
  const adapter: AssetSourceProviderAdapter = {
    provider: "binance",
    async authorize() { return original; },
    async revalidate(value, observedAt) {
      revalidations.push([value, observedAt]);
      return { ...value, snapshot: { ...value.snapshot, syncedAt: observedAt } };
    },
    async connect(value, sourceId) { connections.push([value, sourceId]); },
    ...overrides,
  };
  const onboarding = new AssetSourceOnboarding([adapter], () => now, 1_000);
  return { original, connections, revalidations, onboarding, setNow(value: number) { now = value; } };
}

function unavailable(error: unknown): boolean {
  return error instanceof AssetSourceOnboardingError && error.code === "preview-unavailable";
}

test("公共预览不含凭证或持仓，确认重验后仅保存一次并移除预览", async () => {
  const { original, onboarding, connections, revalidations } = harness();
  const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
  assert.deepEqual(preview, {
    id: preview.id, provider: "binance", account: original.account,
    permissions: original.permissions, total: original.snapshot.total,
  });
  assert.ok(!JSON.stringify(preview).includes(original.credentials));
  assert.equal(onboarding.publicPreview("okx", preview.id), null);
  await assert.rejects(onboarding.confirm("okx", preview.id, CONFIRM_AT), unavailable);
  assert.deepEqual(onboarding.publicPreview("binance", preview.id), preview);

  await onboarding.confirm("binance", preview.id, CONFIRM_AT);
  assert.equal(revalidations.length, 1);
  assert.equal(revalidations[0][0].credentials, original.credentials);
  assert.equal(revalidations[0][1], CONFIRM_AT);
  assert.equal(connections.length, 1);
  assert.equal(connections[0][0].snapshot.syncedAt, CONFIRM_AT);
  assert.equal(connections[0][1], undefined);
  assert.equal(onboarding.publicPreview("binance", preview.id), null);
  await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT), unavailable);
});

test("预览失败、平台返回错误或重新授权账户不匹配时不保存", async () => {
  const rejected = harness({ async authorize() { throw new Error("检测到写权限"); } });
  await assert.rejects(rejected.onboarding.preview("binance", {}, PREVIEW_AT), /检测到写权限/);
  assert.equal(rejected.connections.length, 0);
  const wrongProvider = harness({ async authorize() { return { ...authorization(), provider: "okx" }; } });
  await assert.rejects(wrongProvider.onboarding.preview("binance", {}, PREVIEW_AT), /错误的平台/);
  assert.equal(wrongProvider.connections.length, 0);
  const mismatch = harness();
  await assert.rejects(mismatch.onboarding.preview("binance", {}, PREVIEW_AT, {
    sourceId: "source-one", expectedAccountId: "another-account",
  }), /与此来源不一致/);
  assert.equal(mismatch.connections.length, 0);
  await assert.rejects(mismatch.onboarding.preview("okx", {}, PREVIEW_AT),
    (error: unknown) => error instanceof AssetSourceOnboardingError && error.code === "unsupported-provider");
});

test("取消仅作用于对应平台的预览，失效预览不能重验或写入", async () => {
  const { onboarding, connections, revalidations, setNow } = harness();
  const cancelled = await onboarding.preview("binance", {}, PREVIEW_AT);
  onboarding.cancel("okx", cancelled.id);
  assert.ok(onboarding.publicPreview("binance", cancelled.id));
  onboarding.cancel("binance", cancelled.id);
  onboarding.cancel("binance", cancelled.id);
  await assert.rejects(onboarding.confirm("binance", cancelled.id, CONFIRM_AT), unavailable);
  const expired = await onboarding.preview("binance", {}, PREVIEW_AT);
  setNow(1_001);
  assert.equal(onboarding.publicPreview("binance", expired.id), null);
  await assert.rejects(onboarding.confirm("binance", expired.id, CONFIRM_AT), unavailable);
  assert.equal(revalidations.length, 0);
  assert.equal(connections.length, 0);
});

test("TTL 定时清理无需读取，时钟检查保留现有严格过期边界", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { onboarding, setNow } = harness();
  const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
  setNow(1_000);
  assert.ok(onboarding.publicPreview("binance", preview.id));
  context.mock.timers.tick(1_000);
  assert.equal(onboarding.publicPreview("binance", preview.id), null);
});

test("并发确认期间预览不可读，第二次确认拒绝且只重验和保存一次", async () => {
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  const { onboarding, connections } = harness({
    async revalidate(value) { await paused; return value; },
  });
  const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
  const first = onboarding.confirm("binance", preview.id, CONFIRM_AT);
  assert.equal(onboarding.publicPreview("binance", preview.id), null);
  await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT), unavailable);
  resume();
  await first;
  assert.equal(connections.length, 1);
});

for (const failure of ["revalidate", "connect"] as const) {
  test(`${failure} 失败释放确认占用，保留预览供重试`, async () => {
    let attempts = 0;
    const committed: AssetSourceAuthorization[] = [];
    const { onboarding } = harness({
      async revalidate(value) {
        if (failure === "revalidate" && attempts++ === 0) throw new Error("暂时重验失败");
        return value;
      },
      async connect(value) {
        if (failure === "connect" && attempts++ === 0) throw new Error("原子写入失败");
        committed.push(value);
      },
    });
    const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
    await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT), /失败/);
    assert.deepEqual(onboarding.publicPreview("binance", preview.id), preview);
    await onboarding.confirm("binance", preview.id, CONFIRM_AT);
    assert.equal(committed.length, 1);
    assert.equal(onboarding.publicPreview("binance", preview.id), null);
  });
}

test("确认中到期或取消后失败，不复活预览或允许重试", async () => {
  for (const action of ["expire", "cancel"]) {
    let reject!: (error: Error) => void;
    const paused = new Promise<AssetSourceAuthorization>((_resolve, fail) => { reject = fail; });
    const { onboarding, setNow, connections } = harness({ async revalidate() { return paused; } });
    const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
    const pending = onboarding.confirm("binance", preview.id, CONFIRM_AT);
    if (action === "expire") setNow(1_001);
    else onboarding.cancel("binance", preview.id);
    reject(new Error("重验失败"));
    await assert.rejects(pending, /重验失败/);
    assert.equal(onboarding.publicPreview("binance", preview.id), null);
    await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT), unavailable);
    assert.equal(connections.length, 0);
  }
});

test("确认拒绝平台、账户、模式或范围变化，保持平台专用错误和可重试预览", async () => {
  const variants: Partial<AssetSourceAuthorization>[] = [
    { provider: "okx" }, { account: { id: "other", label: "其他账户" } },
    { accountMode: "classic" }, { permissions: ["account"] }, { scopeFingerprint: "changed" },
  ];
  for (const change of variants) {
    const { onboarding, connections } = harness({
      scopeChangedMessage: "测试账户范围已变化",
      async revalidate(value) { return { ...value, ...change }; },
    });
    const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
    await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT), (error: unknown) =>
      error instanceof AssetSourceOnboardingError && error.code === "scope-changed" && error.message === "测试账户范围已变化");
    assert.equal(connections.length, 0);
    assert.ok(onboarding.publicPreview("binance", preview.id));
    onboarding.cancel("binance", preview.id);
  }
});

test("权限顺序不改变范围，显式范围指纹保持权威且预览保留账户模式", async () => {
  for (const scopeFingerprint of [undefined, "stable-scope"]) {
    const { original, onboarding, connections } = harness({
      async revalidate(value) {
        return {
          ...value,
          permissions: scopeFingerprint === undefined
            ? [...value.permissions].reverse()
            : ["account"],
        };
      },
    });
    original.accountMode = "classic";
    original.scopeFingerprint = scopeFingerprint;
    const preview = await onboarding.preview("binance", {}, PREVIEW_AT);
    assert.equal(preview.accountMode, "classic");
    await onboarding.confirm("binance", preview.id, CONFIRM_AT);
    assert.equal(connections.length, 1);
  }
});

test("重新授权预览只能确认到指定来源，失败后仍可正确确认", async () => {
  const { onboarding, connections } = harness();
  const preview = await onboarding.preview("binance", {}, PREVIEW_AT, {
    sourceId: "source-one", expectedAccountId: "account-one",
  });
  await assert.rejects(onboarding.confirm("binance", preview.id, CONFIRM_AT, "source-two"), unavailable);
  assert.ok(onboarding.publicPreview("binance", preview.id));
  assert.equal(connections.length, 0);
  await onboarding.confirm("binance", preview.id, CONFIRM_AT, "source-one");
  assert.equal(connections[0][1], "source-one");
});

test("直接重新授权复用稳定范围校验，不创建公开预览", async () => {
  const { onboarding, connections, revalidations } = harness();
  await assert.rejects(onboarding.reauthorize("binance", {}, "source-one", CONFIRM_AT, "other-account"), /与此来源不一致/);
  assert.equal(revalidations.length, 0);
  await onboarding.reauthorize("binance", {}, "source-one", CONFIRM_AT, "account-one");
  assert.equal(connections[0][1], "source-one");
  const unstable = harness({ async revalidate(value) { return { ...value, permissions: ["account"] }; } });
  await assert.rejects(unstable.onboarding.reauthorize("binance", {}, "source-one", CONFIRM_AT),
    (error: unknown) => error instanceof AssetSourceOnboardingError && error.code === "scope-changed");
  assert.equal(unstable.connections.length, 0);
});
