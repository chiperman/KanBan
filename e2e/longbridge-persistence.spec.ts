import { expect, test } from "@playwright/test";

test("SQLite 首次连接长桥来源保持持久化接口结果", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/longbridge/persistence",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    rotatedSecretReadableAndEncrypted: true,
    failedWriteRolledBack: true,
    orphanRecovered: true,
    referencedPendingRecovered: true,
    rotatedBeforeDownstreamFailure: true,
    keychainReferencePersistsDirectly: true,
    keychainReferenceRefreshesAndReadsCandles: true,
    reauthorizationReplacesLegacySecretReference: true,
  });
});
