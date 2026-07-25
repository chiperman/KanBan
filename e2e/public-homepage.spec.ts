import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("访客无需登录即可打开公开主页并看到空状态", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/个人终端/);
  await expect(page.getByRole("banner")).toContainText("公开主页");
  await expect(page.getByTestId("card-grid")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toContainText("暂无公开内容");
});

test("公开主页渲染测试数据存储中的卡片", async ({ page, request }) => {
  await request.post("/test-doubles/cards", {
    data: {
      cards: [
        { id: "identity", title: "身份", body: "所有者的一句话介绍", span: 2 },
        { id: "now", title: "Now", body: "正在关注的事", span: 1 },
      ],
    },
  });

  await page.goto("/");

  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  const cards = page.getByTestId("card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("身份");
  await expect(cards.nth(0)).toContainText("所有者的一句话介绍");
  await expect(cards.nth(1)).toContainText("Now");
});
