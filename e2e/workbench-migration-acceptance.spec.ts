import { expect, test, type CDPSession, type Page } from "@playwright/test";

const MIGRATED_SENSITIVE_VALUES = [
  "Binance 只读账户",
  "Ethereum 观察钱包",
  "迁移手工储备",
  "NVDA",
  "USDT",
  "12,345.67",
  "2025-12-31",
  "release-binance-secret",
  "release-ethereum-addresses",
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
];

const PROTECTED_PATHS = [
  "/asset-sources",
  "/asset-sources/new",
  "/asset-sources/test-binance-source-2",
  "/asset-sources/test-binance-source-2/reauthorize",
  "/asset-sources/test-binance-source-2/settings",
  "/data-health",
  "/settings",
] as const;

const PRIMARY_DESTINATIONS = [
  { label: "总览", path: "/", heading: null },
  { label: "资产来源", path: "/asset-sources", heading: "资产来源" },
  { label: "数据健康", path: "/data-health", heading: "数据健康" },
  { label: "设置与安全", path: "/settings", heading: "设置与安全" },
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

function expectNoMigratedData(html: string): void {
  for (const value of MIGRATED_SENSITIVE_VALUES) {
    expect(html).not.toContain(value);
  }
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed-migration" },
  });
  expect(seeded.ok()).toBeTruthy();
});

test("既有自动来源、观察钱包与手工记录经工作台入口保持身份、持仓、趋势、布局和只读授权", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);

  const binanceSummary = page.getByRole("link", {
    name: /查看 Binance 资产来源详情/,
  });
  await expect(binanceSummary).toBeVisible();
  await expect(
    page.getByRole("link", { name: /查看 Ethereum 观察钱包来源详情/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /查看 迁移手工储备来源详情/ }),
  ).toBeVisible();
  const binanceLayoutCard = binanceSummary.locator("xpath=ancestor::article[1]");
  await expect(binanceLayoutCard).toHaveClass(
    /span-2/,
  );
  await expect(binanceLayoutCard).toHaveClass(
    /starts-new-row/,
  );

  await binanceSummary.click();
  await expect(page).toHaveURL(/\/asset-sources\/test-binance-source-2$/);
  await expect(page.getByRole("heading", { name: "Binance 只读账户" })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("已连接（只读）", { exact: true })).toBeVisible();
  await expect(page.getByText("账户读取 · 持仓读取 · 行情读取")).toBeVisible();
  await expect(page.getByTestId("holding-top-list")).toContainText("USDT");
  await expect(page.getByText("来源趋势", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新 Binance 只读账户" }),
  ).toBeVisible();

  await page.goto("/asset-sources");
  await expect(
    page.getByRole("link", { name: /Binance 只读账户.*自动账户.*已连接/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包.*已连接/ }),
  ).toBeVisible();
  const manualSource = page.getByRole("link", {
    name: /迁移手工储备.*手工资产记录.*无凭证/,
  });
  await expect(manualSource).toBeVisible();
  await manualSource.click();
  await expect(page.getByRole("heading", { name: "迁移手工储备" })).toBeVisible();
  await expect(page.getByLabel("迁移手工储备历史记录")).toContainText(
    "2025-12-31",
  );
  await expect(page.getByLabel("迁移手工储备历史记录")).toContainText(
    "12,345.67 USD",
  );
  await expect(page.getByText("来源趋势", { exact: true })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /刷新 迁移手工储备/ }),
  ).toHaveCount(0);

  await page.goto("/data-health");
  const diagnostics = page.getByTestId("data-health-diagnostics");
  await expect(diagnostics).toContainText("Binance 只读账户");
  await expect(diagnostics).toContainText("Ethereum 观察钱包");
  await expect(diagnostics).toContainText("迁移手工储备");
  await expect(
    diagnostics.getByRole("button", { name: /刷新|修复|断开|删除/ }),
  ).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
  await expect(page.getByText("外部来源凭证、令牌和密钥不会导出、回显或恢复。")).toBeVisible();
});

test("锁定态及所有工作台认证入口不泄露迁移前存量数据", async ({
  page,
}) => {
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: "创建所有者 Passkey" })).toBeVisible();
  expectNoMigratedData(await page.content());

  for (const path of PROTECTED_PATHS) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
    expectNoMigratedData(await page.content());
  }

  await loginAsOwner(page);
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  expectNoMigratedData(await page.content());

  for (const path of PROTECTED_PATHS) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
    expectNoMigratedData(await page.content());
  }
});

test("桌面、中等宽度与手机在四个工作台入口保持键盘焦点和无横向溢出", async ({
  page,
}) => {
  await loginAsOwner(page);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const navigation = page.getByTestId("workbench-desktop-navigation");
    await expect(navigation).toBeVisible();

    for (const destination of PRIMARY_DESTINATIONS) {
      const link = navigation.getByRole("link", { name: destination.label });
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`${destination.path.replace("/", "\\/")}$`),
      );
      if (destination.heading !== null) {
        await expect(
          page.getByRole("heading", { name: destination.heading }),
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  await expect(mobileNavigation).toBeVisible();
  for (const destination of PRIMARY_DESTINATIONS) {
    const link = mobileNavigation.getByRole("link", { name: destination.label });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`${destination.path.replace("/", "\\/")}$`),
    );
    await expectNoHorizontalOverflow(page);
  }
});
