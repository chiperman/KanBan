import { expect, test, type Page } from "@playwright/test";

async function configureWorkspace(page: Page): Promise<void> {
  await page.request.post("/test-doubles/reset");
  const configured = await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
  expect(configured.ok()).toBeTruthy();
  const session = await page.request.post("/test-doubles/owner-session");
  expect(session.ok()).toBeTruthy();
}

test("总览裸页面上的次级控件遮住点阵，主刷新保持实心", async ({ page }) => {
  await configureWorkspace(page);
  await page.goto("/");

  const actions = page.getByLabel("总览快捷操作");
  const secondaryControls = actions.locator(
    ".vibe-select__trigger, .vibe-button--outline",
  );
  await expect(secondaryControls).toHaveCount(1);

  const backgrounds = await secondaryControls.evaluateAll((controls) =>
    controls.map((control) => getComputedStyle(control).backgroundColor),
  );
  expect(backgrounds).not.toContain("rgba(0, 0, 0, 0)");

  await expect(page.getByTestId("global-sensitive-info-toggle")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await expect(
    actions.getByRole("button", { name: "立即刷新资产" }),
  ).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("来源总额隐藏时使用明确文案，并与查看操作保留间距", async ({ page }) => {
  await configureWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assets");

  await page.getByRole("button", { name: "隐藏关键信息" }).click();

  const source = page.getByTestId("assets-source-total-source-beta");
  await expect(source).toContainText("金额已隐藏");
  await expect(source).not.toContainText("••••••");

  const separation = await source.evaluate((element) => {
    const value = element.querySelector(
      ".assets-holdings__source-value > strong",
    );
    const detail = element.querySelector(".assets-holdings__source-detail");
    if (value === null || detail === null) return null;
    const valueBox = value.getBoundingClientRect();
    const detailBox = detail.getBoundingClientRect();
    return detailBox.left - valueBox.right;
  });
  expect(separation).not.toBeNull();
  expect(separation).toBeGreaterThanOrEqual(8);
});
