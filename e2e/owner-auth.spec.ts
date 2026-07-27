import { expect, test, type CDPSession, type Page } from "@playwright/test";

const SENSITIVE_TITLE = "SENSITIVE-TITLE-总资产";
const SENSITIVE_BODY = "SENSITIVE-BODY-1234567.89";

const ASSET_CARDS = [
  {
    id: "assets",
    kind: "asset",
    title: SENSITIVE_TITLE,
    body: SENSITIVE_BODY,
    span: 2,
  },
] as const;

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/asset-cards", {
    data: { assetCards: ASSET_CARDS },
  });
});

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

async function replaceWithCredentiallessPasskey(
  passkey: VirtualPasskey,
): Promise<void> {
  await passkey.client.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: passkey.authenticatorId,
  });
  await passkey.client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
}

async function provisionOwner(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
}

async function login(page: Page) {
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
}

test("未认证首页只显示所有者登录入口且不泄露资产数据", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", (response) => {
    void response
      .text()
      .then((body) => bodies.push(body))
      .catch(() => undefined);
  });

  await page.goto("/");

  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card-grid")).toHaveCount(0);
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);
  expect(await page.content()).not.toContain(SENSITIVE_BODY);
  await page.waitForTimeout(100);
  expect(bodies.join("\n")).not.toContain("SENSITIVE-");
});

test("伪造会话与直接请求登录校验都无法取得资产数据", async ({
  page,
  request,
}) => {
  await page.context().addCookies([
    {
      name: "pad_session",
      value: "forged-session-token",
      url: "http://localhost:3101",
    },
  ]);
  await page.goto("/?admin=1");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);

  const verifyResponse = await request.post("/api/auth/login/verify", {
    data: { id: "forged", response: {} },
  });
  expect(verifyResponse.status()).toBeGreaterThanOrEqual(400);
  expect((await request.post("/api/auth/logout")).ok()).toBeTruthy();
});

test("所有者完成预置后可登录资产看板且注册入口关闭", async ({
  page,
  request,
}) => {
  await attachPasskey(page);
  await provisionOwner(page);

  await page.goto("/setup");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("404");
  expect((await request.post("/api/auth/register/options")).status()).toBe(404);

  await page.goto("/");
  await login(page);

  await expect(page.getByTestId("view-mode")).toContainText("资产看板");
  const asset = page.getByTestId("card").filter({ hasText: SENSITIVE_TITLE });
  await expect(asset).toHaveCount(1);
  await expect(asset).toContainText(SENSITIVE_BODY);
  await expect(page.getByTestId("login-gate")).toHaveCount(0);
});

test("Passkey 登录失败后仍停留在锁定状态", async ({ page }) => {
  const passkey = await attachPasskey(page);
  await provisionOwner(page);
  await replaceWithCredentiallessPasskey(passkey);

  await page.goto("/");
  await login(page);

  await expect(
    page.getByText("验证失败或已取消，资产看板仍处于锁定状态"),
  ).toBeVisible();
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "pad_session")).toBeUndefined();
});

test("所有者退出后立即返回登录入口且旧会话失效", async ({ page }) => {
  await attachPasskey(page);
  await provisionOwner(page);

  await page.goto("/");
  await login(page);
  await expect(page.getByText(SENSITIVE_TITLE)).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);

  await page.goBack();
  expect(await page.content()).not.toContain(SENSITIVE_BODY);

  await page.goto("/");
  await expect(page.getByTestId("view-mode")).toContainText("已锁定");
});
