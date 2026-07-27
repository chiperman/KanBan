import { expect, test } from "@playwright/test";

test("首次创建本地数据时使用私有目录和文件权限", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/local-data-file-permissions?action=first-create",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    directoryMode: "0700",
    dashboardMode: "0600",
    secretsMode: "0600",
    ownerCredentialMode: "0600",
    ownerRecoveryMode: "0600",
  });
});

test("启动时收紧已有数据文件且不改变内容", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/local-data-file-permissions?action=harden-existing",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    directoryMode: "0700",
    fileModes: ["0600", "0600", "0600", "0600"],
    contentsPreserved: true,
  });
});

test("原子替换不会放宽目录、临时文件或目标文件权限", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/local-data-file-permissions?action=atomic-write",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    directoryMode: "0700",
    temporaryMode: "0600",
    targetMode: "0600",
    contents: "replacement",
    temporaryFiles: [],
  });
});

test("启动无法修正权限时明确报错且保留原数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/local-data-file-permissions?action=harden-failure",
  );

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result).toEqual({
    startupRejected: true,
    failurePath: "existing-file-chmod",
    contentsPreserved: true,
    error: expect.stringContaining(
      "本地数据权限硬化失败，拒绝继续使用不安全路径",
    ),
  });
});
