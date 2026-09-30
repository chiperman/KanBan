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

test("总览与来源刷新统一尺寸，次级控件保持不透明", async ({ page }) => {
  await configureWorkspace(page);
  await page.goto("/");

  const actions = page.getByLabel("总览快捷操作");
  const secondaryControls = actions.locator(
    ".vibe-select__trigger, .vibe-button--outline",
  );
  await expect(secondaryControls).toHaveCount(2);

  const backgrounds = await secondaryControls.evaluateAll((controls) =>
    controls.map((control) => getComputedStyle(control).backgroundColor),
  );
  expect(backgrounds).not.toContain("rgba(0, 0, 0, 0)");

  await expect(page.getByTestId("workbench-sidebar")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await expect(
    actions.getByRole("button", { name: "立即刷新资产" }),
  ).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const style = (button: Element) => {
    const css = getComputedStyle(button);
    return {
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      fontSize: css.fontSize,
      borderRadius: css.borderRadius,
      background: css.backgroundColor,
      iconWidth: button.querySelector("svg")?.getBoundingClientRect().width,
    };
  };
  const globalStyle = await actions.getByRole("button", { name: "立即刷新资产" }).evaluate(style);
  await page.goto("/asset-sources/source-beta");
  const header = page.getByTestId("workbench-page-header");
  const sourceRefresh = page.getByRole("button", { name: "刷新 Beta Crypto" });
  await expect(sourceRefresh).toHaveCount(1);
  await expect(header.getByRole("button", { name: "刷新 Beta Crypto" })).toBeVisible();
  await expect(header.locator(".workbench-page-header__copy").getByRole("link", { name: "返回资产来源" })).toBeVisible();
  const sourceStyle = await sourceRefresh.evaluate(style);
  expect(sourceStyle).toEqual(globalStyle);
  expect(sourceStyle.height).toBeGreaterThanOrEqual(40);
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
