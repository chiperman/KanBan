import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";

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
  "/assets",
  "/performance",
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
  { label: "资产与持仓", path: "/assets", heading: "资产与持仓" },
  { label: "收益分析", path: "/performance", heading: "收益分析" },
  { label: "资产来源", path: "/asset-sources", heading: "资产来源" },
  { label: "设置与安全", path: "/settings", heading: "设置与安全" },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function expectUniformStandardControls(controls: Locator[]): Promise<void> {
  const heights: number[] = [];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    heights.push(box!.height);
  }

  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(0.5);
  for (const height of heights) {
    expect(height).toBeGreaterThanOrEqual(43.5);
    expect(height).toBeLessThanOrEqual(44.5);
  }
}

async function expectUniformControlWidths(controls: Locator[]): Promise<void> {
  const widths: number[] = [];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    widths.push(box!.width);
  }

  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
}

async function expectAlignedControlRow(controls: Locator[]): Promise<void> {
  const boxes = await Promise.all(
    controls.map(async (control) => {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      return box!;
    }),
  );
  const tops = boxes.map((box) => box.y);
  const bottoms = boxes.map((box) => box.y + box.height);
  const gaps = boxes.slice(1).map(
    (box, index) => box.x - boxes[index].x - boxes[index].width,
  );

  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(0.5);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.5);
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

test("既有自动来源、观察钱包与手工记录经工作台入口保持身份、持仓、趋势和只读授权", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);

  const binanceSummary = page.getByRole("link", {
    name: "查看 Binance 只读账户 的资产明细",
  });
  await expect(binanceSummary).toBeVisible();
  await expect(
    page.getByRole("link", { name: "查看 Ethereum 观察钱包 的资产明细" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "查看 迁移手工储备 的资产明细" }),
  ).toBeVisible();
  await binanceSummary.click();
  await expect(page).toHaveURL(/\/asset-sources\/test-binance-source-2$/);
  await expect(page.getByRole("heading", { name: "Binance 只读账户" })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("已连接（只读）", { exact: true })).toBeVisible();
  await expect(page.getByText("账户读取 · 持仓读取 · 行情读取")).toBeVisible();
  await expect(page.getByTestId("holding-top-list")).toContainText("USDT");
  await expect(page.getByText("资产金额趋势", { exact: true })).toBeVisible();
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
  await expect(page.getByText("资产金额趋势", { exact: true })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /刷新 迁移手工储备/ }),
  ).toHaveCount(0);

  await page.goto("/data-health");
  await expect(page).toHaveURL(/\/asset-sources#history-coverage$/);
  const diagnostics = page.getByTestId("data-health-diagnostics");
  await expect(diagnostics).toContainText("Ethereum 观察钱包");
  await expect(diagnostics.locator('[data-testid^="data-health-source-"]')).toHaveCount(7);
  await expect(diagnostics).toContainText("Binance 只读账户");
  await expect(diagnostics).toContainText("迁移手工储备");
  await expect(
    diagnostics.getByRole("button", { name: /刷新|修复|断开|删除/ }),
  ).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
  await expect(page.getByRole("region", { name: "备份与恢复" })).toContainText("不含凭证、令牌和密钥");
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

test("工作台在关键宽度下保持一致内容基线、可用宽度和无横向溢出", async ({
  page,
}) => {
  await loginAsOwner(page);

  for (const viewport of [
    {
      width: 1920,
      height: 1080,
      navigation: "desktop",
      minimumMainWidth: 1279,
    },
    {
      width: 1440,
      height: 1000,
      navigation: "desktop",
      minimumMainWidth: 1104,
    },
    {
      width: 1280,
      height: 900,
      navigation: "desktop",
      minimumMainWidth: 944,
    },
    {
      width: 1200,
      height: 900,
      navigation: "desktop",
      minimumMainWidth: 864,
    },
    {
      width: 1199,
      height: 900,
      navigation: "mobile",
      minimumMainWidth: 1103,
    },
    {
      width: 1024,
      height: 900,
      navigation: "mobile",
      minimumMainWidth: 928,
    },
    {
      width: 960,
      height: 900,
      navigation: "mobile",
      minimumMainWidth: 896,
    },
    {
      width: 800,
      height: 900,
      navigation: "mobile",
      minimumMainWidth: 736,
    },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");
    const navigation =
      viewport.navigation === "desktop"
        ? page.getByTestId("workbench-desktop-navigation")
        : page.getByTestId("workbench-mobile-navigation");
    const hiddenNavigation =
      viewport.navigation === "desktop"
        ? page.getByTestId("workbench-mobile-navigation")
        : page.getByTestId("workbench-desktop-navigation");
    await expect(navigation).toBeVisible();
    await expect(hiddenNavigation).toBeHidden();

    const destinationMainBoxes: Array<{
      width: number;
      x: number;
    }> = [];
    for (const destination of PRIMARY_DESTINATIONS) {
      const link = navigation.getByRole("link", {
        name: destination.label,
        exact: true,
      });
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
      const mainBox = await page.locator("main").boundingBox();
      expect(mainBox).not.toBeNull();
      expect(mainBox!.width).toBeGreaterThanOrEqual(viewport.minimumMainWidth);
      destinationMainBoxes.push({
        width: mainBox!.width,
        x: mainBox!.x,
      });
      if (
        destination.path === "/asset-sources" &&
        viewport.navigation === "desktop"
      ) {
        const firstSourceRow = page.locator(".asset-source-directory__row").first();
        const firstSourceLink = firstSourceRow.getByRole("link");
        await expect(firstSourceLink).toHaveCount(1);
        const sourceRowBox = await firstSourceRow.boundingBox();
        const sourceLinkBox = await firstSourceLink.boundingBox();
        const sourceIdentityBox = await firstSourceLink
          .locator(".asset-source-directory__identity")
          .boundingBox();
        const sourceMetaBox = await firstSourceRow
          .locator(".asset-source-directory__meta")
          .boundingBox();
        expect(sourceRowBox).not.toBeNull();
        expect(sourceLinkBox).not.toBeNull();
        expect(sourceIdentityBox).not.toBeNull();
        expect(sourceMetaBox).not.toBeNull();
        expect(sourceIdentityBox!.x - sourceLinkBox!.x).toBeLessThanOrEqual(2);
        expect(sourceMetaBox!.x).toBeGreaterThanOrEqual(sourceRowBox!.x);
        expect(
          sourceMetaBox!.x + sourceMetaBox!.width -
            (sourceRowBox!.x + sourceRowBox!.width),
        ).toBeLessThanOrEqual(2);
      }
      await expectNoHorizontalOverflow(page);
    }

    const firstMainBox = destinationMainBoxes[0];
    for (const mainBox of destinationMainBoxes.slice(1)) {
      expect(Math.abs(mainBox.x - firstMainBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mainBox.width - firstMainBox.width)).toBeLessThanOrEqual(1);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  await expect(mobileNavigation).toBeVisible();
  for (const destination of PRIMARY_DESTINATIONS) {
    const link = mobileNavigation.getByRole("link", {
      name: destination.label,
      exact: true,
    });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`${destination.path.replace("/", "\\/")}$`),
    );
    await expectNoHorizontalOverflow(page);
  }
});

test("同级标准操作保持统一的 44px 高度和响应式宽度", async ({ page }) => {
  await loginAsOwner(page);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1202, height: 942 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);

    await page.goto("/");
    const overviewControls = [
      page.getByRole("button", { name: "计价货币" }),
      page.getByRole("button", { name: "立即刷新资产" }),
    ];
    await expectUniformStandardControls(overviewControls);
    await expectUniformControlWidths(
      overviewControls,
    );
    if (viewport.width > 720) {
      await expectAlignedControlRow(overviewControls);
    }

    await page.goto("/assets");
    const holdingsControls = [
      page.getByRole("button", { name: "计价货币" }),
    ];
    await expectUniformStandardControls(holdingsControls);
    await expectUniformControlWidths(holdingsControls);

    await expectUniformStandardControls([
      page.getByTestId("global-sensitive-info-toggle"),
    ]);

    await page.goto("/settings");
    await expectUniformStandardControls([
      page.getByRole("button", { name: "配置 TOTP 登录" }),
      page.getByRole("button", { name: "导出业务数据备份" }),
      page.getByRole("button", { name: "预演恢复" }),
      page.getByRole("button", { name: "保存并验证", exact: true }),
    ]);
  }
});
