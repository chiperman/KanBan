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
  const value = page.getByTestId("assets-source-total-source-a-shares")
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

test("日期 Escape 只关闭日历并恢复焦点，保留外层表单草稿", async ({ page }) => {
  await configureWorkspace(page);
  await page.goto("/asset-sources/source-beta");
  const trigger = page.getByRole("button", { name: "手动记录", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "手动记录Beta Crypto", exact: true });
  const amount = dialog.getByRole("textbox", { name: "期初本金", exact: true });
  await amount.fill("12345");
  const date = dialog.getByRole("button", { name: /^记录日期 / });
  const selectedDate = await date.innerText();
  await expect(date).toHaveAccessibleName(`记录日期 ${selectedDate}`);

  for (const focusCalendar of [false, true]) {
    await date.click();
    const calendar = page.getByRole("dialog", { name: "选择记录日期", exact: true });
    await expect(calendar).toBeVisible();
    if (focusCalendar) await calendar.locator("button[aria-pressed=true]").focus();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(amount).toHaveValue("12345");
    await expect(date).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("下拉控件的可访问名称随当前选项更新", async ({ page }) => {
  await configureWorkspace(page);
  await page.goto("/assets");
  const currency = page.getByRole("button", { name: /^计价货币 / });
  await expect(currency).toHaveAccessibleName("计价货币 USD");
  await currency.click();
  await page.getByRole("option", { name: "CNY", exact: true }).click();
  await expect(currency).toHaveAccessibleName("计价货币 CNY");
  await expect(currency).toBeFocused();
});
