import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 800 },
  { name: "中等", width: 800, height: 900 },
  { name: "手机", width: 390, height: 844 },
] as const;

const THEMES = ["light", "dark"] as const;

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: number[]): number {
  const [red, green, blue] = rgb.map(channelToLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: number[], background: number[]): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color: string): number[] {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  expect(channels, `无法解析颜色 ${color}`).toHaveLength(3);
  return channels!;
}

async function expectReadableText(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const styles = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      color: computed.color,
      fontSize: Number.parseFloat(computed.fontSize),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });

  expect(styles.fontSize).toBeGreaterThanOrEqual(12);
  expect(
    contrastRatio(parseRgb(styles.color), parseRgb(styles.background)),
  ).toBeGreaterThanOrEqual(4.5);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function provisionOwner(page: Page): Promise<void> {
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
}

test("锁定页以可读中文状态传达安全边界并保留清晰键盘焦点", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await provisionOwner(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "个人资产看板已锁定" }),
  ).toBeVisible();

  for (const locator of [
    page.locator(".page-locked .header-wordmark"),
    page.getByTestId("view-mode"),
    page.locator(".locked-clock > strong"),
    page.locator(".page-locked .card-label"),
    page.locator(".login-eyebrow"),
    page.locator(".page-locked .login-copy"),
    page.locator(".login-hint"),
    page.locator(".login-trust-line"),
    page.locator(".locked-footer span").first(),
    page.locator(".locked-footer span").last(),
  ]) {
    await expectReadableText(locator);
  }

  await expect(page.locator(".locked-clock > strong")).toHaveCSS(
    "font-family",
    /Space Mono/,
  );

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
  await page.keyboard.press("Tab");

  const primaryAction = page.getByRole("button", { name: "使用 Passkey 登录" });
  await expect(primaryAction).toBeFocused();
  const actionStyles = await primaryAction.evaluate((element) => {
    const computed = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      height: bounds.height,
      outlineStyle: computed.outlineStyle,
      outlineWidth: Number.parseFloat(computed.outlineWidth),
    };
  });
  expect(actionStyles.height).toBeGreaterThanOrEqual(44);
  expect(actionStyles.outlineStyle).not.toBe("none");
  expect(actionStyles.outlineWidth).toBeGreaterThanOrEqual(2);
});

test("所有者预置页在桌面提供合理正文宽度和可读反馈", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/setup");

  const panel = page.locator(".setup-panel");
  const title = page.getByRole("heading", {
    name: "预置唯一所有者的 Passkey",
  });
  const layout = await title.evaluate((element) => {
    const computed = getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    return {
      panelWidth: element.parentElement!.getBoundingClientRect().width,
      titleWidth: element.getBoundingClientRect().width,
      lineCount: Math.round(element.getBoundingClientRect().height / lineHeight),
    };
  });
  expect(layout.panelWidth).toBeGreaterThanOrEqual(640);
  expect(layout.titleWidth).toBeGreaterThanOrEqual(480);
  expect(layout.lineCount).toBeLessThanOrEqual(2);

  await expectReadableText(panel.locator(".card-label"));
  await expectReadableText(page.locator(".setup-copy"));

  const moduleLabel = await panel.evaluate((element) => {
    const computed = getComputedStyle(element, "::before");
    return {
      color: computed.color,
      fontSize: Number.parseFloat(computed.fontSize),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(moduleLabel.fontSize).toBeGreaterThanOrEqual(12);
  expect(
    contrastRatio(parseRgb(moduleLabel.color), parseRgb(moduleLabel.background)),
  ).toBeGreaterThanOrEqual(4.5);

  const primaryAction = page.getByRole("button", {
    name: "创建所有者 Passkey",
  });
  await primaryAction.focus();
  const actionStyles = await primaryAction.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      outlineWidth: Number.parseFloat(computed.outlineWidth),
    };
  });
  expect(actionStyles.height).toBeGreaterThanOrEqual(44);
  expect(actionStyles.outlineWidth).toBeGreaterThanOrEqual(2);

  await primaryAction.click();
  await expectReadableText(page.locator(".login-error[role=alert]"));
  await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`${theme} ${viewport.name}宽度下锁定页与预置页无横向溢出或内容截断`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });

      for (const path of ["/", "/setup"] as const) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page);

        const primaryAction =
          path === "/"
            ? page.getByRole("link", { name: "开始首次预置" })
            : page.getByRole("button", { name: "创建所有者 Passkey" });
        await expect(primaryAction).toBeVisible();
        const bounds = await primaryAction.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }

      await provisionOwner(page);
      await page.goto("/");
      await expectNoHorizontalOverflow(page);
      await expect(
        page.getByRole("heading", { name: "个人资产看板已锁定" }),
      ).toBeVisible();

      const lockedAction = page.getByRole("button", {
        name: "使用 Passkey 登录",
      });
      await expect(lockedAction).toBeVisible();
      const lockedBounds = await lockedAction.boundingBox();
      expect(lockedBounds).not.toBeNull();
      expect(lockedBounds!.x).toBeGreaterThanOrEqual(0);
      expect(lockedBounds!.x + lockedBounds!.width).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(lockedBounds!.height).toBeGreaterThanOrEqual(44);
    });
  }
}
