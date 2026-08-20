import { expect, test, type Page } from "@playwright/test";

const RETAINED_SYNC_FAILURE =
  "同步失败 · 数据过期 · 显示 2026-03-03 20:00 的最后成功数据";

async function configureDataHealth(page: Page): Promise<void> {
  await page.request.post("/test-doubles/reset");
  const configured = await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
  expect(configured.ok()).toBeTruthy();
  const session = await page.request.post("/test-doubles/owner-session");
  expect(session.ok()).toBeTruthy();
}

async function chooseCurrency(page: Page, currency: "CNY" | "HKD"): Promise<void> {
  await page.getByRole("button", { name: "计价货币" }).click();
  await page.getByRole("option", { name: currency, exact: true }).click();
}

async function navigateInWorkbench(
  page: Page,
  label: "总览" | "资产与持仓" | "收益分析",
  path: "/" | "/assets" | "/performance",
): Promise<void> {
  await page
    .getByTestId("workbench-desktop-navigation")
    .getByRole("link", { name: label, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("总览的计价货币与隐私显示会持续到资产、收益分析和重新登录后", async ({
  page,
}) => {
  await configureDataHealth(page);
  await page.goto("/");

  await chooseCurrency(page, "CNY");
  await page.getByTestId("global-sensitive-info-toggle").click();
  await expect(
    page.getByTestId("portfolio-overview-workspace").getByTestId(
      "overview-current-total",
    ),
  ).toContainText("••••••");

  await page.getByRole("link", { name: "查看全部资产与持仓" }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole("button", { name: "计价货币" })).toContainText(
    "CNY",
  );
  await expect(
    page.getByTestId("assets-source-total-source-beta"),
  ).toContainText("金额已隐藏");

  await navigateInWorkbench(page, "收益分析", "/performance");
  await expect(page.getByRole("button", { name: "计价货币" })).toContainText(
    "CNY",
  );
  await expect(
    page.getByTestId("performance-current-total"),
  ).toContainText("••••••");

  await page.getByRole("link", { name: "资产与持仓", exact: true }).click();
  await page.getByRole("link", { name: /查看 Beta Crypto 来源详情/ }).click();
  await expect(page).toHaveURL(/\/asset-sources\/source-beta$/);
  await expect(page.getByTestId("asset-source-total")).toContainText("••••••");

  await navigateInWorkbench(page, "总览", "/");
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(page.getByRole("status")).toContainText("敏感内容已锁定");

  const session = await page.request.post("/test-doubles/owner-session");
  expect(session.ok()).toBeTruthy();
  await page.goto("/performance");

  await expect(page.getByRole("button", { name: "计价货币" })).toContainText(
    "CNY",
  );
  await expect(
    page.getByTestId("performance-current-total"),
  ).not.toContainText("••••••");
});

test("同一来源同步失败在总览、资产、来源列表和数据健康中使用一致口径", async ({
  page,
}) => {
  await configureDataHealth(page);

  await page.goto("/");
  await expect(page.getByTestId("overview-source-summary")).toContainText(
    RETAINED_SYNC_FAILURE,
  );

  await page.goto("/assets");
  await expect(
    page.getByTestId("assets-source-total-source-beta"),
  ).toContainText(RETAINED_SYNC_FAILURE);

  await page.goto("/asset-sources");
  await expect(
    page.getByRole("link", { name: /Beta Crypto.*同步失败/ }),
  ).toContainText(RETAINED_SYNC_FAILURE);

  await page.goto("/data-health");
  const beta = page.getByTestId("data-health-source-source-beta");
  await expect(beta).toContainText(RETAINED_SYNC_FAILURE);
  await expect(beta).toContainText("来源暂时不可用");
  await expect(
    beta.getByRole("link", { name: "排查同步 Beta Crypto 来源详情" }),
  ).toBeVisible();
});
