import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 800 },
  { name: "中等", width: 834, height: 1112 },
  { name: "手机", width: 390, height: 844 },
];

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        {
          id: "wide",
          kind: "asset",
          title: "宽卡片",
          body: "占据三列的内容卡片",
          span: 3,
        },
        {
          id: "mid",
          kind: "asset",
          title: "中卡片",
          body: "占据两列的内容卡片",
          span: 2,
        },
        {
          id: "narrow",
          kind: "asset",
          title: "窄卡片",
          body: "占据一列的内容卡片",
          span: 1,
        },
      ],
    },
  });
});

async function loginAsOwner(page: Page): Promise<void> {
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
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}宽度下无横向溢出且内容可访问`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await loginAsOwner(page);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("card-grid")).toBeVisible();
    await expect(page.getByTestId("card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^当前主题：/ })).toBeVisible();
  });
}
