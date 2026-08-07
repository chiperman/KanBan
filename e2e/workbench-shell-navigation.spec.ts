import { expect, test, type CDPSession, type Page } from "@playwright/test";

const SENSITIVE_TITLE = "SENSITIVE-WORKBENCH-ASSET";
const SENSITIVE_BODY = "SENSITIVE-WORKBENCH-BODY-123456.78";

const PRIMARY_DESTINATIONS = [
  { label: "总览", path: "/" },
  { label: "资产来源", path: "/asset-sources" },
  { label: "数据健康", path: "/data-health" },
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
  await expect(page.getByRole("status")).toContainText("已完成预置");
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
  await page.goto("/asset-sources");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "工作台主导航" }),
  ).toHaveCount(0);
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);
  expect(await page.content()).not.toContain(SENSITIVE_BODY);

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

test("已认证所有者在桌面可通过左侧主导航和键盘到达四个入口", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsOwner(page);

  const desktopNavigation = page.getByTestId("workbench-desktop-navigation");
  await expect(desktopNavigation).toBeVisible();
  await expect(page.getByTestId("workbench-mobile-navigation")).toBeHidden();

  for (const destination of PRIMARY_DESTINATIONS) {
    const link = desktopNavigation.getByRole("link", {
      name: destination.label,
    });
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${destination.path.replace("/", "\\/")}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
  }
});

test("已认证所有者在手机可通过底部主导航和 Command-K 到达入口", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  const commandTrigger = page.getByRole("button", {
    name: "打开快捷命令",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect(page.getByTestId("workbench-desktop-navigation")).toBeHidden();
  await expect(commandTrigger).toBeVisible();
  await expect(commandTrigger.locator("kbd")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  for (const destination of PRIMARY_DESTINATIONS) {
    await mobileNavigation
      .getByRole("link", { name: destination.label })
      .click();
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
