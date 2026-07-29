import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("主题默认跟随系统", async ({ browser }) => {
  const darkContext = await browser.newContext({ colorScheme: "dark" });
  const darkPage = await darkContext.newPage();
  await darkPage.goto("/");
  await expect(darkPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await darkContext.close();

  const lightContext = await browser.newContext({ colorScheme: "light" });
  const lightPage = await lightContext.newPage();
  await lightPage.goto("/");
  await expect(lightPage.locator("html")).toHaveAttribute("data-theme", "light");
  await lightContext.close();
});

test("点阵背景在浅色和深色模式下保持局部反相", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto("/");

    const dotField = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const dotStyle = getComputedStyle(document.body, "::before");

      return {
        isolation: bodyStyle.isolation,
        backgroundImage: dotStyle.backgroundImage,
        backgroundSize: dotStyle.backgroundSize,
        backgroundAttachment: dotStyle.backgroundAttachment,
        mixBlendMode: dotStyle.mixBlendMode,
      };
    });

    expect(dotField.isolation).toBe("isolate");
    expect(dotField.backgroundImage).toContain("rgba(255, 255, 255, 0.42)");
    expect(dotField.backgroundSize).toBe("120px 120px");
    expect(dotField.backgroundAttachment).toBe("fixed");
    expect(dotField.mixBlendMode).toBe("difference");

    await context.close();
  }
});

test("所有者可以选择浅色或深色并记住选择", async ({ page }) => {
  await page.goto("/");
  const themeToggle = page.getByRole("button", { name: /^当前主题：/ });

  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-choice", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(themeToggle).toHaveAccessibleName(/^当前主题：深色/);

  await themeToggle.click();
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("选择跟随系统后会继续响应系统主题变化", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const themeToggle = page.getByRole("button", { name: /^当前主题：/ });

  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-choice", "system");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("减少动态效果偏好会关闭页面非必要过渡", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  expect(
    await page.evaluate(() =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);

  const transitionSeconds = await page
    .getByRole("button", { name: /^当前主题：/ })
    .evaluate((element) =>
      getComputedStyle(element)
        .transitionDuration.split(",")
        .map((duration) => Number.parseFloat(duration)),
    );
  expect(Math.max(...transitionSeconds)).toBeLessThanOrEqual(0.001);
});
