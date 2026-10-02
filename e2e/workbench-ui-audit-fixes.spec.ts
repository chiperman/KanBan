import { expect, test, type Page } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function configureWorkspace(page: Page) {
  expect((await page.request.post("/test-doubles/reset")).ok()).toBeTruthy();
  expect((await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/test-doubles/refresh", {
    data: { action: "anchor-full-refresh" },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
}

test("隐藏金额后整页刷新，在客户端脚本加载前仍保持隐藏", async ({ page }) => {
  await configureWorkspace(page);
  await page.goto("/assets");
  const value = page.getByTestId("assets-source-total-source-beta")
    .locator(".assets-holdings__source-value");
  await expect(value).toContainText("USD");
  const visibleValue = await value.innerText();
  await page.getByRole("button", { name: "隐藏关键信息", exact: true }).click();
  await expect(value).toHaveText("金额已隐藏");

  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route("**/_next/static/**", async (route) => {
    if (route.request().resourceType() === "script") await scriptsReady;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(value).toBeVisible();
    await expect(value).toHaveText("金额已隐藏");
    await expect(value).not.toContainText(visibleValue);
  } finally {
    releaseScripts();
  }
  await page.waitForLoadState("load");
  await expect(value).toHaveText("金额已隐藏");
  await page.getByRole("button", { name: "显示关键信息", exact: true }).click();
  await expect(value).toHaveText(visibleValue);
});

test("演示模式的服务端首屏仍展示虚构金额", async ({ page }) => {
  await page.route("**/_next/static/**", async (route) => {
    if (route.request().resourceType() === "script") await route.abort();
    else await route.continue();
  });
  await page.goto("/?mode=demo");
  const total = page.getByTestId("overview-current-total");
  await expect(total).toBeVisible();
  await expect(total).toContainText("USD");
  await expect(total).not.toContainText("••••••");
});
