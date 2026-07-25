import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 800 },
  { name: "中等", width: 834, height: 1112 },
  { name: "手机", width: 390, height: 844 },
];

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/cards", {
    data: {
      cards: [
        {
          id: "wide",
          title: "宽卡片",
          body: "占据三列的内容卡片",
          span: 3,
          access: "public",
        },
        {
          id: "mid",
          title: "中卡片",
          body: "占据两列的内容卡片",
          span: 2,
          access: "public",
        },
        {
          id: "narrow",
          title: "窄卡片",
          body: "占据一列的内容卡片",
          span: 1,
          access: "public",
        },
      ],
    },
  });
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}宽度下无横向溢出且内容可访问`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("card-grid")).toBeVisible();
    await expect(page.getByTestId("card").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "跟随系统" }),
    ).toBeVisible();
  });
}
