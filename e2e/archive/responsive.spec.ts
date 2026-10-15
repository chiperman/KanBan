import { expect, test } from "@playwright/test";

import { loginAsOwner } from "../owner-auth-helpers";

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 800 },
  { name: "中等", width: 834, height: 1112 },
  { name: "手机", width: 390, height: 844 },
];

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}宽度下无横向溢出且内容可访问`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await loginAsOwner(page, { waitForTestId: null });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("portfolio-overview-workspace")).toBeVisible();
    await expect(page.getByTestId("overview-source-summary")).toBeVisible();
    await expect(page.locator(".daily-overview__source-list > li")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^当前主题：/ })).toBeVisible();
  });
}
