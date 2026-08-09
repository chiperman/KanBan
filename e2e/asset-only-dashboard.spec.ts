import { expect, test, type CDPSession, type Page } from "@playwright/test";

const SENSITIVE_TITLE = "SENSITIVE-ASSET-TITLE";
const SENSITIVE_BODY = "SENSITIVE-ASSET-BODY-9988";

async function attachPasskey(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return client;
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("资产看板");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const response = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        {
          id: "assets",
          kind: "asset",
          title: SENSITIVE_TITLE,
          body: SENSITIVE_BODY,
          span: 2,
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
});

test("未认证首页只是所有者访问入口，不再提供公开主页或资产占位", async ({
  page,
}) => {
  const bodies: string[] = [];
  page.on("response", (response) => {
    void response
      .text()
      .then((body) => bodies.push(body))
      .catch(() => undefined);
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/个人资产看板/);
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "开始首次预置" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 Passkey 登录" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("card-grid")).toHaveCount(0);
  await expect(page.getByTestId("restricted-card")).toHaveCount(0);
  await expect(page.getByText(/公开主页|访客视图|Now|链接卡片/)).toHaveCount(0);

  expect(await page.content()).not.toContain(SENSITIVE_TITLE);
  expect(await page.content()).not.toContain(SENSITIVE_BODY);
  await page.waitForTimeout(100);
  expect(bodies.join("\n")).not.toContain("SENSITIVE-ASSET");
});

test("旧演示查询参数不会绕过锁定面或泄露虚构资产形状", async ({
  page,
}) => {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");

  await page.goto("/?mode=demo");

  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 Passkey 登录" }),
  ).toBeVisible();
  await expect(page.getByTestId("demo-mode-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("locked-product-flow")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "进入演示模式" })).toHaveCount(0);
  expect(await page.content()).not.toMatch(
    /Longbridge|Binance|OKX|Bitget|Web3|DEMO DATA|NET ASSET|CONSOLIDATED VIEW/,
  );
});

test("登录后只展示资产能力，普通内容卡片接口与编辑入口均不存在", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);

  await expect(page.getByText(SENSITIVE_TITLE)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /新建身份卡片|新建 Now 卡片|新建链接卡片|新建 Markdown 卡片/,
    }),
  ).toHaveCount(0);

  expect(
    (
      await request.post("/api/cards", {
        data: { kind: "now", content: "不应再支持" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.patch("/api/cards/assets", {
        data: { access: "public" },
      })
    ).status(),
  ).toBe(404);
});
