import {
  expect,
  test,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";

const SENSITIVE_TITLE = "SENSITIVE-WORKBENCH-ASSET";
const SENSITIVE_BODY = "SENSITIVE-WORKBENCH-BODY-123456.78";

const PRIMARY_DESTINATIONS = [
  { label: "总览", path: "/" },
  { label: "资产与持仓", path: "/assets" },
  { label: "收益分析", path: "/performance" },
  { label: "资产来源", path: "/asset-sources" },
  { label: "设置与安全", path: "/settings" },
] as const;

async function loginAsOwner(page: Page): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectUtilitiesInHeader(
  page: Page,
  testInfo: TestInfo,
  screenshotName: string,
) {
  const utilities = page.getByTestId("workbench-utilities");
  const header = page.getByTestId("workbench-page-header");
  const [utilitiesBox, headerBox] = await Promise.all([
    utilities.boundingBox(),
    header.boundingBox(),
  ]);

  expect(utilitiesBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(utilitiesBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(utilitiesBox!.x + utilitiesBox!.width).toBeLessThanOrEqual(
    headerBox!.x + headerBox!.width,
  );
  expect(utilitiesBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
  expect(utilitiesBox!.y + utilitiesBox!.height).toBeLessThanOrEqual(
    headerBox!.y + headerBox!.height,
  );
  await page.screenshot({
    path: testInfo.outputPath(screenshotName),
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        {
          id: "sensitive-workbench-asset",
          kind: "asset",
          title: SENSITIVE_TITLE,
          body: SENSITIVE_BODY,
          span: 2,
        },
      ],
    },
  });
});

test("锁定状态和受保护入口不渲染工作台导航或资产数据", async ({
  page,
}) => {
  for (const protectedPath of ["/assets", "/performance", "/asset-sources"]) {
    await page.goto(protectedPath);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "工作台主导航" }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain(SENSITIVE_TITLE);
    expect(await page.content()).not.toContain(SENSITIVE_BODY);
  }

  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "工作台主导航" }),
  ).toHaveCount(0);
});

test("所有者主动锁定后立即移除工作台壳和敏感数据", async ({ page }) => {
  await loginAsOwner(page);

  await page.route("**/api/auth/logout", (route) => route.abort());
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "敏感内容已锁定" }),
  ).toContainText("敏感内容已锁定");
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "工作台主导航" }),
  ).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(SENSITIVE_TITLE);
  expect(await page.locator("body").innerText()).not.toContain(SENSITIVE_BODY);
  await page.unroute("**/api/auth/logout");
});

test("已认证所有者在桌面可通过左侧主导航和键盘到达五个入口", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsOwner(page);

  const desktopNavigation = page.getByTestId("workbench-desktop-navigation");
  const commandContainer = page.locator(".workbench-command");
  const commandTrigger = page.getByRole("button", {
    name: "打开快捷命令",
  });
  const commandKeycap = commandTrigger.locator("kbd");
  await expect(desktopNavigation).toBeVisible();
  await expect(page.getByTestId("workbench-mobile-navigation")).toBeHidden();
  await expect(commandContainer).toHaveCSS("border-radius", "6px");
  await expect(commandTrigger).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(commandKeycap).toBeVisible();

  const portfolioGroup = desktopNavigation.locator(
    '[aria-controls="workbench-navigation-group-portfolio"]',
  );
  const managementGroup = desktopNavigation.locator(
    '[aria-controls="workbench-navigation-group-management"]',
  );
  await expect(portfolioGroup).toHaveAccessibleName("收起资产组合导航");
  await expect(managementGroup).toHaveAccessibleName("收起管理导航");
  await expect(portfolioGroup).toHaveAttribute("aria-expanded", "true");
  await expect(managementGroup).toHaveAttribute("aria-expanded", "true");
  await portfolioGroup.focus();
  await portfolioGroup.press("Space");
  await expect(portfolioGroup).toHaveAttribute("aria-expanded", "false");
  await expect(desktopNavigation.locator('a[href="/assets"]')).toBeHidden();
  await expect(desktopNavigation.locator('a[href="/performance"]')).toBeHidden();
  await expect(portfolioGroup).toHaveAccessibleName("展开资产组合导航");
  await portfolioGroup.press("Space");
  await expect(desktopNavigation.locator('a[href="/assets"]')).toBeVisible();
  await expect(
    desktopNavigation.locator('a[href="/performance"]'),
  ).toBeVisible();

  for (const destination of PRIMARY_DESTINATIONS) {
    const link = desktopNavigation.getByRole("link", {
      name: destination.label,
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(destination.label);
    await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${destination.path.replace("/", "\\/")}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    if (["/assets", "/performance"].includes(destination.path)) {
      await expect(portfolioGroup).toHaveAttribute("aria-expanded", "true");
    }
    if (["/asset-sources", "/settings"].includes(destination.path)) {
      await expect(managementGroup).toHaveAttribute("aria-expanded", "true");
    }
  }
});

test("桌面和窄窗口的快捷命令与全局工具均位于页面抬头", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await loginAsOwner(page);

  const utilities = page.getByTestId("workbench-utilities");
  const desktopNavigation = page.getByTestId("workbench-desktop-navigation");
  const commandContainer = page.locator(".workbench-command");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expectUtilitiesInHeader(page, testInfo, "utilities-wide.png");
  const [desktopUtilities, desktopNavigationBox, desktopCommand] = await Promise.all([
    utilities.boundingBox(),
    desktopNavigation.boundingBox(),
    commandContainer.boundingBox(),
  ]);
  expect(desktopUtilities).not.toBeNull();
  expect(desktopNavigationBox).not.toBeNull();
  expect(desktopCommand).not.toBeNull();
  expect(desktopUtilities!.x).toBeGreaterThanOrEqual(
    desktopNavigationBox!.x + desktopNavigationBox!.width,
  );
  const desktopHeader = await page.getByTestId("workbench-page-header").boundingBox();
  expect(desktopHeader).not.toBeNull();
  expect(desktopCommand!.x).toBeGreaterThanOrEqual(desktopHeader!.x);
  expect(desktopCommand!.x + desktopCommand!.width).toBeLessThanOrEqual(
    desktopHeader!.x + desktopHeader!.width,
  );
  expect(desktopCommand!.y).toBeGreaterThanOrEqual(desktopHeader!.y);
  expect(desktopCommand!.y + desktopCommand!.height).toBeLessThanOrEqual(
    desktopHeader!.y + desktopHeader!.height,
  );
  await expect(
    page.locator(".workbench-shell > .workbench-utilities"),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 975, height: 900 });
  await expect(page.getByTestId("workbench-mobile-navigation")).toBeVisible();
  await expectUtilitiesInHeader(page, testInfo, "utilities-medium.png");
  const mediumUtilities = await utilities.boundingBox();
  const mediumHeader = await page.getByTestId("workbench-page-header").boundingBox();
  expect(mediumUtilities!.x).toBeGreaterThan(
    mediumHeader!.x + mediumHeader!.width / 2,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expectUtilitiesInHeader(page, testInfo, "utilities-mobile.png");
  const [mobileUtilities, mobileNavigation] = await Promise.all([
    utilities.boundingBox(),
    page.getByTestId("workbench-mobile-navigation").boundingBox(),
  ]);
  expect(mobileUtilities!.y + mobileUtilities!.height).toBeLessThanOrEqual(
    mobileNavigation!.y - 8,
  );
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole("button", { name: "隐藏关键信息", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "显示关键信息", exact: true }),
  ).toBeVisible();
});

test("窄窗口切换主页面时不闪现底部全局工具", async ({ page }) => {
  await page.addInitScript(() => {
    const flashes: string[] = [];

    window.addEventListener("load", () => {
      const inspectFallback = () => {
        const fallback = document.querySelector(
          ".workbench-shell > .workbench-utilities",
        );
        if (
          fallback !== null &&
          getComputedStyle(fallback).display !== "none"
        ) {
          flashes.push(window.location.pathname);
        }
      };

      new MutationObserver(inspectFallback).observe(document.body, {
        childList: true,
        subtree: true,
      });
      inspectFallback();
    });

    Object.defineProperty(window, "__workbenchUtilityFlashes", {
      configurable: true,
      value: flashes,
    });
  });
  await page.setViewportSize({ width: 975, height: 844 });
  await loginAsOwner(page);

  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  for (const destination of PRIMARY_DESTINATIONS.slice(1)) {
    await mobileNavigation
      .getByRole("link", { name: destination.label, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${destination.path.replace("/", "\\/")}$`),
    );
  }

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __workbenchUtilityFlashes: string[];
            }
          ).__workbenchUtilityFlashes,
      ),
    )
    .toEqual([]);
});

test("五个工作台页面共享统一的页面抬头", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsOwner(page);

  for (const destination of [
    {
      label: "PORTFOLIO / TODAY",
      path: "/",
      title: "总览",
    },
    {
      label: "PORTFOLIO / HOLDINGS",
      path: "/assets",
      title: "资产与持仓",
    },
    {
      label: "PORTFOLIO / PERFORMANCE",
      path: "/performance",
      title: "收益分析",
    },
    {
      label: "PORTFOLIO / SOURCES",
      path: "/asset-sources",
      title: "资产来源",
    },
    {
      label: "LOCAL / SETTINGS",
      path: "/settings",
      title: "设置与安全",
    },
  ]) {
    await page.goto(destination.path);
    const header = page.getByTestId("workbench-page-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator(".card-label")).toHaveText(destination.label);
    await expect(
      header.getByRole("heading", { name: destination.title }),
    ).toBeVisible();
    await expect(header.getByTestId("workbench-utilities")).toHaveCount(1);
    await expect(
      page.locator(".workbench-shell > .workbench-utilities"),
    ).toHaveCount(0);
  }
});

test("已认证所有者在手机可通过底部主导航和 Command-K 到达入口", async ({
  page,
}) => {
  await loginAsOwner(page);

  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  const commandTrigger = page.getByRole("button", {
    name: "打开快捷命令",
  });
  const commandContainer = page.locator(".workbench-command");
  const commandKeycap = commandTrigger.locator("kbd");

  for (const width of [975, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(mobileNavigation).toBeVisible();
    await expect(page.getByTestId("workbench-desktop-navigation")).toBeHidden();
    await expect(commandContainer).toBeVisible();
    await expect(commandTrigger).toBeVisible();
    await expect(commandKeycap).toBeVisible();
    await expect(commandContainer).toHaveCSS("border-radius", "6px");
    expect(
      await commandContainer.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expect(commandTrigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      await commandKeycap.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expectNoHorizontalOverflow(page);
  }

  for (const destination of PRIMARY_DESTINATIONS) {
    const link = mobileNavigation.getByRole("link", {
      name: destination.label,
      exact: true,
    });
    await expect(link).toHaveAttribute("aria-label", destination.label);
    await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
    await expect(link).toHaveText("");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${destination.path.replace("/", "\\/")}$`));
  }

  await commandTrigger.click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("数据健康");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/data-health$/);
  await expect(
    page.getByRole("heading", { name: "数据健康" }),
  ).toBeVisible();
});
