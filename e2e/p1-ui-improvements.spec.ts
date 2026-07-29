import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
});

test("看板时间、来源状态和普通卡片遵守 Vibe 视觉层级", async ({ page }) => {
  await loginAsOwner(page);

  await expect(page.getByTestId("server-time")).toContainText("SHANGHAI");
  await expect(page.getByTestId("server-time")).toHaveCSS("font-size", "12px");

  const sourceCard = page.getByTestId("longbridge-card");
  await expect(sourceCard.locator(".source-live-state")).toHaveCSS(
    "font-size",
    "10px",
  );
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-component",
    "status-tag",
  );
  await expect(sourceCard.locator(".source-meter-caption")).toHaveCSS(
    "font-size",
    "12px",
  );

  const cardBorders = await sourceCard.locator("..").evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      top: computed.borderTopWidth,
      right: computed.borderRightWidth,
    };
  });
  expect(cardBorders).toEqual({ top: "0px", right: "0px" });
  await expect(sourceCard.locator("..")).toHaveAttribute(
    "data-vibe-surface",
    "data-card",
  );
});
