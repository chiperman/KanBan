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
    "success",
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
  await expect(overviewCard.locator(".card-corner-mark")).toHaveCount(2);
  await expect(
    overviewCard.locator(
      ".card-corner-mark-top-right, .card-corner-mark-bottom-right",
    ),
  ).toHaveCount(0);
  expect(
    await overviewCard.locator(".card-corner-marks").evaluate((element) => ({
      before: getComputedStyle(element, "::before").content,
      after: getComputedStyle(element, "::after").content,
    })),
  ).toEqual({ before: "none", after: "none" });

  const overviewBox = await overviewCard.boundingBox();
  const totalStatusBox = await overviewCard.locator(".total-status").boundingBox();
  expect(overviewBox).not.toBeNull();
  expect(totalStatusBox).not.toBeNull();
  expect(
    Math.abs(
      overviewBox!.x +
        overviewBox!.width -
        Number.parseFloat(overviewSpacing.padding[1]) -
        (totalStatusBox!.x + totalStatusBox!.width),
    ),
  ).toBeLessThanOrEqual(1);

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
    "success",
  );
  await expect(sourceCard.locator(".source-live-state")).toHaveText(
    "LB / CURRENT",
  );
  const cardDecoration = await sourceCard.evaluate((element) => {
    const decoration = getComputedStyle(element, "::after");
    return {
      backgroundImage: decoration.backgroundImage,
      content: decoration.content,
    };
  });
  expect(cardDecoration.content).not.toBe("none");
  expect(cardDecoration.backgroundImage).toContain("radial-gradient");
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
  const sourceCardShell = sourceCard.locator("..");
  await expect(sourceCardShell.locator(".card-corner-mark")).toHaveCount(2);
  await expect(
    sourceCardShell.locator(
      ".card-corner-mark-top-right, .card-corner-mark-bottom-right",
    ),
  ).toHaveCount(0);
  await expect(sourceCard.locator("..")).toHaveAttribute(
    "data-vibe-surface",
    "data-card",
  );

  const resizeHandle = sourceCard
    .locator("..")
    .getByRole("button", { name: /调整.*宽度/ });
  await expect(resizeHandle).toHaveCSS("border-radius", "6px");
  await resizeHandle.hover();
  expect(
    await resizeHandle.evaluate((element) => {
      const before = getComputedStyle(element, "::before");
      const after = getComputedStyle(element, "::after");
      return {
        beforeBackground: before.backgroundColor,
        afterBackground: after.backgroundColor,
      };
    }),
  ).toEqual({
    beforeBackground: "rgba(0, 0, 0, 0)",
    afterBackground: "rgba(0, 0, 0, 0)",
  });

  const dragHandle = sourceCardShell.getByRole("button", {
    name: /拖动.*调整排序/,
  });
  await dragHandle.hover();
  const dragLines = await dragHandle.evaluate((element) => {
    const handle = getComputedStyle(element, "::before");
    return {
      background: handle.backgroundColor,
      shadows: handle.boxShadow,
    };
  });
  expect(dragLines.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(dragLines.shadows).toContain("0px 4px");
  expect(dragLines.shadows).toContain("0px 8px");

  const currencyTrigger = page.getByRole("button", { name: "计价货币" });
  await expect(currencyTrigger).toHaveClass(/vibe-select__trigger/);
  await expect(currencyTrigger).toHaveCSS("height", "44px");
  await currencyTrigger.click();
  const currencyMenu = page.getByRole("listbox", { name: "计价货币" });
  await expect(currencyMenu.locator("..")).toHaveAttribute(
    "data-vibe-variant",
    "compact",
  );
  await expect(currencyMenu).toHaveCSS("box-shadow", "none");
  const selectedCurrency = currencyMenu.getByRole("option", { name: "USD" });
  await expect(selectedCurrency).toHaveCSS(
    "border-radius",
    "6px",
  );
  await expect(
    selectedCurrency.locator(".vibe-select__selected-mark"),
  ).toHaveCSS("width", "6px");
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
