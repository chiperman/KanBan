import { createHmac } from "node:crypto";

import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";

import { TEST_BASE_URL } from "../playwright.config";

const FIXED_NOW = "2026-01-01T00:00:00.000Z";
const SENSITIVE_TITLE = "SENSITIVE-TITLE-总资产";
const SENSITIVE_BODY = "SENSITIVE-BODY-1234567.89";

const CARDS = [
  {
    id: "assets",
    kind: "asset",
    title: SENSITIVE_TITLE,
    body: SENSITIVE_BODY,
    span: 2,
  },
] as const;

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

async function attachPasskey(page: Page): Promise<VirtualPasskey> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = (await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    },
  )) as { authenticatorId: string };
  return { client, authenticatorId };
}

async function provisionAndLogin(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  await unlockWithPasskey(page);
}

async function unlockWithPasskey(page: Page): Promise<void> {
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer {
  let bits = "";
  for (const character of value.replace(/=+$/u, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, now: Date): string {
  const counter = BigInt(Math.floor(now.getTime() / 30_000));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000;
  return value.toString().padStart(6, "0");
}

async function openRecoverySettings(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== "/settings") {
    await page.getByRole("link", { name: "设置与安全" }).click();
  }
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
}

async function expectAuthenticatedWorkbench(page: Page): Promise<void> {
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.getByTestId("login-gate")).toHaveCount(0);
}

async function configureRecovery(page: Page): Promise<string> {
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  const code = totpCode(secret, new Date(FIXED_NOW));

  await page.getByLabel("当前 TOTP 验证码").fill(code);
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();
  await expect(page.locator(".recovery-status")).toHaveText(
    "TOTP 已配置，请使用下一组验证码登录。",
  );
  return secret;
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/clock", { data: { now: FIXED_NOW } });
  const response = await request.post("/test-doubles/asset-cards", {
    data: { assetCards: CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("打开 TOTP 登录说明时不会立即生成或展示 TOTP 密钥", async ({ page }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);

  let setupRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().endsWith("/api/auth/recovery/setup")) {
      setupRequests += 1;
    }
  });

  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();

  const recoveryDialog = page.getByRole("dialog", { name: "配置 TOTP 登录" });
  await expect(recoveryDialog).toBeVisible();
  await expect(recoveryDialog).toHaveAttribute("data-vibe-component", "modal");
  await expect(page.getByLabel("TOTP 密钥")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始配置" })).toBeVisible();
  expect(setupRequests).toBe(0);

  await page.getByRole("button", { name: "开始配置" }).click();
  await expect(page.getByLabel("TOTP 密钥")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("TOTP 密钥")).toHaveCSS("border-radius", "6px");
  await expect(page.getByRole("button", { name: "显示密钥" })).toBeVisible();
  expect(setupRequests).toBe(1);
});

test("所有者配置 TOTP 登录时只需要 TOTP", async ({ page }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();

  await expect(page.getByLabel("备用登录邮箱")).toHaveCount(0);
  await expect(page.getByLabel("备用登录密码")).toHaveCount(0);

  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  await page
    .getByLabel("当前 TOTP 验证码")
    .fill(totpCode(secret, new Date(FIXED_NOW)));
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();

  await expect(page.locator(".recovery-status")).toHaveText(
    "TOTP 已配置，请使用下一组验证码登录。",
  );
});

test("TOTP 登录配置错误与验证码字段关联并返回输入焦点", async ({ page }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  const correctCode = totpCode(secret, new Date(FIXED_NOW));
  const wrongCode = correctCode === "000000" ? "000001" : "000000";
  const codeField = page.getByLabel("当前 TOTP 验证码");

  await codeField.fill(wrongCode);
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();

  await expect(codeField).toHaveAttribute("aria-invalid", "true");
  await expect(codeField).toHaveAttribute(
    "aria-describedby",
    "recovery-setup-code-error",
  );
  await expect(page.locator("#recovery-setup-code-error")).toContainText(
    "当前 TOTP 验证码无效",
  );
  await expect(codeField).toBeFocused();
});

test("配置时使用的 TOTP 验证码不能再次 TOTP 登录", async ({ page }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  const setupCode = totpCode(secret, new Date(FIXED_NOW));
  await page.getByLabel("当前 TOTP 验证码").fill(setupCode);
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();

  await page.getByRole("button", { name: "立即锁定" }).click();
  await page.getByRole("button", { name: "使用 TOTP 登录" }).click();
  await page.getByLabel("TOTP 验证码").fill(setupCode);
  await page.getByRole("button", { name: "完成 TOTP 登录" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "该验证码已用于配置或登录，请等待下一组验证码",
    }),
  ).toBeVisible();
  const [totpFieldBounds, totpErrorBounds] = await Promise.all([
    page.getByTestId("vibe-field-recovery-totp-code").boundingBox(),
    page.locator("#recovery-totp-error").boundingBox(),
  ]);
  expect(totpFieldBounds).not.toBeNull();
  expect(totpErrorBounds).not.toBeNull();
  expect(totpErrorBounds!.y - (totpFieldBounds!.y + totpFieldBounds!.height))
    .toBeGreaterThanOrEqual(16);
  expect(totpErrorBounds!.y - (totpFieldBounds!.y + totpFieldBounds!.height))
    .toBeLessThanOrEqual(32);
  const failedTotp = page.getByLabel("TOTP 验证码");
  await expect(failedTotp).toHaveAttribute("aria-invalid", "true");
  await expect(failedTotp).toHaveAttribute(
    "aria-describedby",
    "recovery-totp-error",
  );
  await expect(page.locator("#recovery-totp-error")).toContainText(
    "该验证码已用于配置或登录",
  );
  await expect(failedTotp).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
});

test("所有者可仅凭 TOTP 登录", async ({ page, request }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  const code = totpCode(secret, new Date(FIXED_NOW));
  await page.getByLabel("当前 TOTP 验证码").fill(code);
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();

  const loginNow = "2026-01-01T00:00:30.000Z";
  await request.post("/test-doubles/clock", { data: { now: loginNow } });

  await page.getByRole("button", { name: "立即锁定" }).click();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  const totpEntry = page.getByRole("button", { name: "使用 TOTP 登录" });
  await expect(totpEntry).toBeVisible();
  const [pixelBounds, choiceActionBounds] = await Promise.all([
    page.getByTestId("locked-pixel-display").boundingBox(),
    page.locator(".login-actions--choice").boundingBox(),
  ]);
  expect(pixelBounds).not.toBeNull();
  expect(choiceActionBounds).not.toBeNull();
  const choiceOffset =
    choiceActionBounds!.y - (pixelBounds!.y + pixelBounds!.height);
  expect(choiceOffset).toBeGreaterThanOrEqual(20);
  expect(choiceOffset).toBeLessThanOrEqual(32);
  expect(
    await totpEntry.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await totpEntry.click();

  await expect(page.getByLabel("备用登录邮箱")).toHaveCount(0);
  await expect(page.getByLabel("备用登录密码")).toHaveCount(0);
  const totpField = page.getByTestId("vibe-field-recovery-totp-code");
  const totpInput = page.getByLabel("TOTP 验证码");
  const totpSlots = totpField.locator(".vibe-verification-code__slot");
  const submitButton = page.getByRole("button", { name: "完成 TOTP 登录" });
  await expect(totpField).toHaveAttribute(
    "data-vibe-component",
    "verification-code",
  );
  await expect(totpSlots).toHaveCount(6);
  await expect(totpSlots.first()).toHaveCSS("width", "40px");
  await expect(totpSlots.first()).toHaveCSS("height", "50px");
  await expect(totpSlots.first()).toHaveCSS("border-radius", "6px");
  expect(
    await totpSlots
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Doto");
  await expect(totpInput).toHaveAttribute("autocomplete", "one-time-code");
  await expect(totpInput).toHaveCSS("opacity", "0");
  await expect(submitButton).toHaveAttribute("data-vibe-variant", "primary");
  await expect(submitButton).toHaveCSS("border-radius", "6px");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(totpSlots.first()).toHaveCSS("width", "36px");
  const mobileViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileViewport.scrollWidth).toBe(mobileViewport.clientWidth);

  const loginCode = totpCode(secret, new Date(loginNow));
  await totpInput.fill(loginCode);
  await expect(totpInput).toHaveValue(loginCode);
  await expect(totpSlots).toHaveText([...loginCode]);
  await submitButton.click();

  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await expectAuthenticatedWorkbench(page);
});

test("Passkey 失败后切换 TOTP 登录会清除旧提示且不与锁定字重叠", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await provisionAndLogin(page);
  await configureRecovery(page);
  await page.getByRole("button", { name: "立即锁定" }).click();

  await page.route("**/api/auth/login/verify", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "认证失败" }),
    }),
  );
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();

  const passkeyError = page.getByRole("alert").filter({
    hasText: "验证失败或已取消。",
  });
  await expect(passkeyError).toBeVisible();
  const [pixelBounds, errorBounds, actionBounds] = await Promise.all([
    page.getByTestId("locked-pixel-display").boundingBox(),
    passkeyError.boundingBox(),
    page.locator(".login-actions--choice").boundingBox(),
  ]);
  expect(pixelBounds).not.toBeNull();
  expect(errorBounds).not.toBeNull();
  expect(actionBounds).not.toBeNull();
  const errorOffset = errorBounds!.y - (pixelBounds!.y + pixelBounds!.height);
  expect(errorOffset).toBeGreaterThanOrEqual(20);
  expect(errorOffset).toBeLessThanOrEqual(32);
  const actionOffset = actionBounds!.y - (errorBounds!.y + errorBounds!.height);
  expect(actionOffset).toBeGreaterThanOrEqual(20);
  expect(actionOffset).toBeLessThanOrEqual(32);

  await page.getByRole("button", { name: "使用 TOTP 登录" }).click();
  await expect(passkeyError).toHaveCount(0);
  await expect(page.getByLabel("TOTP 验证码")).toBeVisible();
});

test("同一个 TOTP 验证码不能重复登录", async ({ page, request }) => {
  await provisionAndLogin(page);
  await openRecoverySettings(page);
  await page.getByRole("button", { name: "配置 TOTP 登录" }).click();
  await page.getByRole("button", { name: "开始配置" }).click();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  await page
    .getByLabel("当前 TOTP 验证码")
    .fill(totpCode(secret, new Date(FIXED_NOW)));
  await page.getByRole("button", { name: "保存 TOTP 登录" }).click();

  const loginNow = "2026-01-01T00:00:30.000Z";
  await request.post("/test-doubles/clock", { data: { now: loginNow } });
  const code = totpCode(secret, new Date(loginNow));

  for (let login = 0; login < 2; login += 1) {
    await page.getByRole("button", { name: "立即锁定" }).click();
    await expect(
      page.getByRole("heading", { name: "看板已锁定" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "使用 TOTP 登录" }).click();
    await page.getByLabel("TOTP 验证码").fill(code);
    await page.getByRole("button", { name: "完成 TOTP 登录" }).click();
    if (login === 0) {
      await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
    }
  }

  await expect(
    page.getByRole("alert").filter({
      hasText: "该验证码已用于配置或登录，请等待下一组验证码",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
});

test("未配置 TOTP 登录时锁定页只提供 Passkey 登录", async ({ page }) => {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");

  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "使用 Passkey 登录" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 TOTP 登录" }),
  ).toHaveCount(0);
});

test("TOTP 连续五次失败后限流五分钟", async ({
  page,
  request,
}) => {
  await provisionAndLogin(page);
  const recoverySecret = await configureRecovery(page);

  await page.route("**/api/auth/logout", (route) => route.abort());
  await page.getByRole("button", { name: "立即锁定" }).click();
  await expect(page.getByText(SENSITIVE_BODY)).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "敏感内容已锁定" }),
  ).toContainText("敏感内容已锁定");
  await page.unroute("**/api/auth/logout");
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(SENSITIVE_BODY);

  await page.getByRole("button", { name: "使用 TOTP 登录" }).click();
  await expect(
    page.getByRole("button", { name: /社交|短信|注册/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("TOTP 验证码")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();

  const incompleteAttempt = await page.evaluate(async () =>
    fetch("/api/asset-cards/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: [] }),
    }).then((response) => response.status),
  );
  expect(incompleteAttempt).toBe(401);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "pad_session" && cookie.value !== "",
    ),
  ).toBeFalsy();

  const correctCode = totpCode(recoverySecret, new Date(FIXED_NOW));
  const wrongCode = correctCode === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByLabel("TOTP 验证码").fill(wrongCode);
    await page.getByRole("button", { name: "完成 TOTP 登录" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: attempt < 4 ? "TOTP 验证失败" : "TOTP 尝试过多",
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  const rateLimitedInput = page.getByLabel("TOTP 验证码");
  const rateLimitedSubmit = page.getByRole("button", { name: "完成 TOTP 登录" });
  await expect(rateLimitedInput).toBeDisabled();
  await expect(rateLimitedSubmit).toBeDisabled();
  await expect(rateLimitedInput).toHaveAttribute("aria-invalid", "true");
  await expect(rateLimitedInput).toHaveAttribute(
    "aria-describedby",
    "recovery-totp-error",
  );

  await page.getByRole("button", { name: "返回" }).click();

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:05:00.000Z" },
  });
  await page.getByRole("button", { name: "使用 TOTP 登录" }).click();
  await page
    .getByLabel("TOTP 验证码")
    .fill(totpCode(recoverySecret, new Date("2026-01-01T00:05:00.000Z")));
  await page.getByRole("button", { name: "完成 TOTP 登录" }).click();

  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await expectAuthenticatedWorkbench(page);
});

test("TOTP 从第五次失败起锁定五分钟", async ({ page, request }) => {
  await provisionAndLogin(page);
  const recoverySecret = await configureRecovery(page);
  await page.getByRole("button", { name: "立即锁定" }).click();
  await page.getByRole("button", { name: "使用 TOTP 登录" }).click();

  const firstCorrect = totpCode(recoverySecret, new Date(FIXED_NOW));
  const firstWrong = firstCorrect === "000000" ? "000001" : "000000";
  await page.getByLabel("TOTP 验证码").fill(firstWrong);
  await page.getByRole("button", { name: "完成 TOTP 登录" }).click();

  const fifthFailureAt = "2026-01-01T00:04:59.000Z";
  await request.post("/test-doubles/clock", { data: { now: fifthFailureAt } });
  const lateCorrect = totpCode(recoverySecret, new Date(fifthFailureAt));
  const lateWrong = lateCorrect === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel("TOTP 验证码").fill(lateWrong);
    await page.getByRole("button", { name: "完成 TOTP 登录" }).click();
  }

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:05:00.000Z" },
  });
  const stillLocked = await page.evaluate(
    async ({ code }) => fetch("/api/auth/recovery/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then((response) => response.status),
    { code: totpCode(recoverySecret, new Date("2026-01-01T00:05:00.000Z")) },
  );
  expect(stillLocked).toBe(429);

  const unlockedAt = "2026-01-01T00:09:59.000Z";
  await request.post("/test-doubles/clock", { data: { now: unlockedAt } });
  const recovered = await page.evaluate(
    async ({ code }) => fetch("/api/auth/recovery/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then((response) => response.status),
    { code: totpCode(recoverySecret, new Date(unlockedAt)) },
  );
  expect(recovered).toBe(200);
  await page.reload();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
});

test("连续三十分钟无操作后自动锁定，随后仍可使用 Passkey 快速解锁", async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await provisionAndLogin(page);

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:29:00.000Z" },
  });
  expect(
    await page.evaluate(() => fetch("/").then((response) => response.status)),
  ).toBe(200);
  await page.clock.fastForward(29 * 60 * 1000);
  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:30:00.000Z" },
  });
  await page.clock.fastForward(60 * 1000);

  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(SENSITIVE_BODY);
  await unlockWithPasskey(page);
  await expectAuthenticatedWorkbench(page);
});

test("并发 TOTP 请求共享五次尝试上限", async ({ page, request }) => {
  await provisionAndLogin(page);
  const recoverySecret = await configureRecovery(page);
  await page.getByRole("button", { name: "立即锁定" }).click();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();

  const correctCode = totpCode(recoverySecret, new Date(FIXED_NOW));
  const wrongCode = correctCode === "000000" ? "000001" : "000000";
  const statuses = await page.evaluate(
    async ({ code }) => Promise.all(
      Array.from({ length: 6 }, () =>
        fetch("/api/auth/recovery/totp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }).then((response) => response.status),
      ),
    ),
    { code: wrongCode },
  );
  expect(statuses.filter((status) => status === 401)).toHaveLength(4);
  expect(statuses.filter((status) => status === 429)).toHaveLength(2);

  const limitedCorrectAttempt = await page.evaluate(
    async ({ code }) =>
      fetch("/api/auth/recovery/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).then((response) => response.status),
    { code: correctCode },
  );
  expect(limitedCorrectAttempt).toBe(429);

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:05:00.000Z" },
  });
  const recoveredAttempt = await page.evaluate(
    async ({ code }) =>
      fetch("/api/auth/recovery/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).then((response) => response.status),
    { code: totpCode(recoverySecret, new Date("2026-01-01T00:05:00.000Z")) },
  );
  expect(recoveredAttempt).toBe(200);
  await page.reload();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
});

test("关闭浏览器上下文后敏感会话不会在新上下文恢复", async ({
  playwright,
}, testInfo) => {
  const userDataDir = testInfo.outputPath("browser-profile");
  const firstContext = await playwright.chromium.launchPersistentContext(
    userDataDir,
    { baseURL: TEST_BASE_URL, headless: true },
  );
  const firstPage = firstContext.pages()[0] ?? (await firstContext.newPage());
  await provisionAndLogin(firstPage);
  await expectAuthenticatedWorkbench(firstPage);
  const session = (await firstContext.cookies()).find(
    (cookie) => cookie.name === "pad_session",
  );
  expect(session).toBeDefined();
  expect(session!.expires).toBe(-1);
  await firstContext.close();

  const reopenedContext = await playwright.chromium.launchPersistentContext(
    userDataDir,
    { baseURL: TEST_BASE_URL, headless: true },
  );
  const reopenedPage =
    reopenedContext.pages()[0] ?? (await reopenedContext.newPage());
  await reopenedPage.goto("/");
  await expect(
    reopenedPage.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  await expect(reopenedPage.getByTestId("login-gate")).toBeVisible();
  expect(await reopenedPage.content()).not.toContain(SENSITIVE_BODY);
  await reopenedContext.close();
});
