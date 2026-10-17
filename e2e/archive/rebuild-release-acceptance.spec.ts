import { expect, test, type Page } from "@playwright/test";

const WORKBENCH_DESTINATIONS = [
  { heading: "总览", path: "/" },
  { heading: "资产与持仓", path: "/assets" },
  { heading: "收益分析", path: "/performance" },
  { heading: "来源管理", path: "/asset-sources" },
  { heading: "来源管理", path: "/data-health" },
  { heading: "设置与安全", path: "/settings" },
] as const;

const VIEW_PROFILES = [
  {
    colorScheme: "light" as const,
    name: "桌面浅色",
    reducedMotion: "no-preference" as const,
    viewport: { width: 1280, height: 900 },
  },
  {
    colorScheme: "dark" as const,
    name: "桌面深色减少动态",
    reducedMotion: "reduce" as const,
    viewport: { width: 1280, height: 900 },
  },
  {
    colorScheme: "light" as const,
    name: "中屏浅色减少动态",
    reducedMotion: "reduce" as const,
    viewport: { width: 800, height: 900 },
  },
  {
    colorScheme: "dark" as const,
    name: "中屏深色",
    reducedMotion: "no-preference" as const,
    viewport: { width: 800, height: 900 },
  },
  {
    colorScheme: "light" as const,
    name: "390px 浅色减少动态",
    reducedMotion: "reduce" as const,
    viewport: { width: 390, height: 844 },
  },
  {
    colorScheme: "dark" as const,
    name: "390px 深色",
    reducedMotion: "no-preference" as const,
    viewport: { width: 390, height: 844 },
  },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentOverflow =
      Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) - viewportWidth;
    return { documentOverflow };
  });
  expect(overflow.documentOverflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed-migration" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.request.post("/test-doubles/owner-session");
});

test("全产品核心路径在三种宽度、浅深色与减少动态下保持可读、可导航且无控制台错误", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  for (const profile of VIEW_PROFILES) {
    await page.setViewportSize(profile.viewport);
    await page.emulateMedia({
      colorScheme: profile.colorScheme,
      reducedMotion: profile.reducedMotion,
    });
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      profile.colorScheme,
    );
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "查看全部资产与持仓" }),
    ).toHaveAttribute("href", "/assets");

    const navigation = page.getByTestId(
      profile.viewport.width < 1200
        ? "workbench-mobile-navigation"
        : "workbench-desktop-navigation",
    );
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "来源管理", exact: true }),
    ).toHaveAttribute("href", "/asset-sources");

    for (const destination of WORKBENCH_DESTINATIONS) {
      await page.goto(destination.path);
      await expect(
        page.getByRole("heading", { name: destination.heading }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);

      if (destination.path === "/performance") {
        await expect(
          page.getByRole("region", { name: "投资资金进出账本" }),
        ).toBeVisible();
      }
    }

    if (profile.reducedMotion === "reduce") {
      const durations = await page
        .getByRole("button", { name: /^当前主题：/ })
        .evaluate((element) =>
          getComputedStyle(element)
            .transitionDuration.split(",")
            .map((duration) => Number.parseFloat(duration)),
        );
      expect(Math.max(...durations)).toBeLessThanOrEqual(0.001);
    }
  }

  expect(browserErrors).toEqual([]);
});
