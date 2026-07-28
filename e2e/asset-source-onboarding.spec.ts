import { expect, test } from "@playwright/test";

test("统一接入服务完成验证、预览和原子保存", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/asset-source-onboarding?action=success",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    preview: {
      provider: "binance",
      account: { id: "account-one", label: "测试账户" },
      permissions: ["account", "positions"],
      total: { amount: "10", currency: "USD" },
    },
    connected: ["account-one"],
    credentialLeaked: false,
    previewRemoved: true,
  });
});

for (const [action, expected] of [
  [
    "permission-denied",
    { rejected: true, error: "检测到写权限", connected: 0 },
  ],
  [
    "expired",
    { rejected: true, error: "资产来源预览已失效或正在确认", connected: 0 },
  ],
  [
    "duplicate",
    { firstConfirmed: true, secondRejected: true, connected: 1 },
  ],
  [
    "identity-changed",
    { rejected: true, error: "资产来源账户范围已变化，请重新预览", connected: 0 },
  ],
  [
    "commit-failed",
    { firstRejected: true, retryConfirmed: true, connected: 1 },
  ],
  [
    "concurrent",
    { confirmed: 1, rejected: 1, connected: 1 },
  ],
] as const) {
  test(`统一接入服务覆盖 ${action} 生命周期`, async ({ request }) => {
    const response = await request.post(
      `/test-doubles/asset-source-onboarding?action=${action}`,
    );

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toEqual(expected);
  });
}
