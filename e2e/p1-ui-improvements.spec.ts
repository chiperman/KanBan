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
  await expect(page.getByTestId("asset-refresh-status")).toHaveAttribute(
    "data-vibe-tone",
    "muted",
  );

  for (const action of [
    page.getByRole("button", { name: "配置备用登录" }),
    page.getByRole("button", { name: "打开快捷命令" }),
    page.getByRole("button", { name: "立即锁定（退出登录）" }),
  ]) {
    await expect(action).toHaveAttribute("data-vibe-component", "button");
    await expect(action).toHaveAttribute("data-vibe-variant", "outline");
    await expect(action).toHaveCSS("height", "44px");
    await expect(action).toHaveCSS("border-radius", "6px");
    await expect(action).toHaveCSS("font-size", "11px");
  }

  const themeToggle = page.getByRole("button", { name: /^当前主题：/ });
  await expect(themeToggle).toHaveCSS("width", "44px");
  await expect(themeToggle).toHaveCSS("height", "44px");
  await expect(themeToggle).toHaveCSS("border-radius", "999px");

  const overviewCard = page.getByTestId("total-overview-card");
  const overviewSpacing = await overviewCard.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      padding: [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft,
      ],
      labelLeft: getComputedStyle(element, "::before").left,
      fieldRight: getComputedStyle(element, "::after").right,
    };
  });
  expect(overviewSpacing).toEqual({
    padding: ["48px", "24px", "32px", "24px"],
    labelLeft: "24px",
    fieldRight: "24px",
  });

  const sourceCard = page.getByTestId("longbridge-card");
  await expect(sourceCard.locator(".source-live-state")).toHaveCSS(
    "font-size",
    "10px",
  );
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-component",
    "status-tag",
  );
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-tone",
    "muted",
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

  const resizeHandle = sourceCard
    .locator("..")
    .getByRole("button", { name: /调整.*宽度/ });
  await expect(resizeHandle).toHaveCSS("border-radius", "6px");

  await page.getByRole("button", { name: "计价货币" }).click();
  const currencyMenu = page.getByRole("listbox", { name: "计价货币" });
  await expect(currencyMenu).toHaveCSS("box-shadow", "none");
  await expect(currencyMenu.getByRole("option").first()).toHaveCSS(
    "border-radius",
    "6px",
  );
});

test("空状态说明在 Light 和 Dark 下保持正文级对比度", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/reset");
  await page.emulateMedia({ colorScheme: "light" });
  await loginAsOwner(page);
  await page.evaluate(() => localStorage.setItem("pad-theme", "system"));

  async function contrastRatio() {
    return page.locator(".empty-hint").evaluate((element) => {
      function luminance(color: string) {
        const channels = color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
        const [red, green, blue] = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(document.body).backgroundColor);
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
    });
  }

  await page.reload();
  expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
});
