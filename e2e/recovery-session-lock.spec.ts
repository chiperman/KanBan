import { createHmac } from "node:crypto";

import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";

import { TEST_BASE_URL } from "../playwright.config";

const FIXED_NOW = "2026-01-01T00:00:00.000Z";
const RECOVERY_EMAIL = "owner@example.com";
const STRONG_PASSWORD = "Terminal!Owner2026";
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
  await expect(page.getByRole("status")).toContainText("已完成预置");
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

async function configureRecovery(page: Page): Promise<string> {
  await page.getByRole("button", { name: "配置备用登录" }).click();
  await expect(page.getByText("邮箱仅作为本机登录标识，不发送验证邮件。")).toBeVisible();
  const secret = await page.getByLabel("TOTP 密钥").inputValue();
  const code = totpCode(secret, new Date(FIXED_NOW));

  await page.getByLabel("备用登录邮箱").fill(RECOVERY_EMAIL);
  await page.getByLabel("备用登录密码").fill("weak-password");
  await page.getByLabel("当前 TOTP 验证码").fill(code);
  await page.getByRole("button", { name: "保存备用登录" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "强密码" }),
  ).toContainText("强密码");

  await page.getByLabel("备用登录密码").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "保存备用登录" }).click();
  await expect(page.locator(".recovery-status")).toContainText("备用登录已配置");
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

test("未配置备用登录时锁定页只提供 Passkey 登录", async ({ page }) => {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");

  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "使用 Passkey 登录" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用备用方式登录" }),
  ).toHaveCount(0);
});

test("所有者可配置邮箱、强密码和 TOTP，并以两阶段恢复认证解锁", async ({
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
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
  expect(await page.content()).not.toContain(SENSITIVE_BODY);

  await page.getByRole("button", { name: "使用备用方式登录" }).click();
  await expect(
    page.getByRole("button", { name: /社交|短信|注册/ }),
  ).toHaveCount(0);

  await page.getByLabel("备用登录邮箱").fill(RECOVERY_EMAIL);
  await page.getByLabel("备用登录密码").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "继续验证 TOTP" }).click();
  await expect(page.getByLabel("TOTP 验证码")).toBeVisible();
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");

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
    await page.getByRole("button", { name: "完成备用登录" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "TOTP 验证失败" }),
    ).toContainText("TOTP 验证失败");
  }
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");

  await page.getByLabel("TOTP 验证码").fill(correctCode);
  await page.getByRole("button", { name: "完成备用登录" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "TOTP 验证失败" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByLabel("备用登录邮箱").fill(RECOVERY_EMAIL);
  await page.getByLabel("备用登录密码").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "继续验证 TOTP" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "TOTP 尝试过多" }),
  ).toContainText("TOTP 尝试过多");

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:05:00.000Z" },
  });
  await page.getByRole("button", { name: "继续验证 TOTP" }).click();
  await page
    .getByLabel("TOTP 验证码")
    .fill(totpCode(recoverySecret, new Date("2026-01-01T00:05:00.000Z")));
  await page.getByRole("button", { name: "完成备用登录" }).click();

  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await expect(page.getByText(SENSITIVE_BODY)).toBeVisible();
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

  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
  expect(await page.content()).not.toContain(SENSITIVE_BODY);
  await unlockWithPasskey(page);
  await expect(page.getByText(SENSITIVE_BODY)).toBeVisible();
});

test("并发恢复密码请求共享五次尝试上限", async ({ page, request }) => {
  await provisionAndLogin(page);
  await configureRecovery(page);
  await page.getByRole("button", { name: "立即锁定" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");

  const statuses = await page.evaluate(
    async ({ email }) =>
      Promise.all(
        Array.from({ length: 6 }, () =>
          fetch("/api/auth/recovery/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "Wrong!Password2026" }),
          }).then((response) => response.status),
        ),
      ),
    { email: RECOVERY_EMAIL },
  );
  expect(statuses.filter((status) => status === 401)).toHaveLength(5);
  expect(statuses.filter((status) => status === 429)).toHaveLength(1);

  const limitedCorrectAttempt = await page.evaluate(
    async ({ email, password }) =>
      fetch("/api/auth/recovery/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }).then((response) => response.status),
    { email: RECOVERY_EMAIL, password: STRONG_PASSWORD },
  );
  expect(limitedCorrectAttempt).toBe(429);

  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:05:00.000Z" },
  });
  const recoveredAttempt = await page.evaluate(
    async ({ email, password }) =>
      fetch("/api/auth/recovery/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }).then((response) => response.status),
    { email: RECOVERY_EMAIL, password: STRONG_PASSWORD },
  );
  expect(recoveredAttempt).toBe(200);
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
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
  await expect(firstPage.getByText(SENSITIVE_BODY)).toBeVisible();
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
  await expect(reopenedPage.getByTestId("view-mode")).toContainText("已锁定");
  await expect(reopenedPage.getByTestId("login-gate")).toBeVisible();
  expect(await reopenedPage.content()).not.toContain(SENSITIVE_BODY);
  await reopenedContext.close();
});
