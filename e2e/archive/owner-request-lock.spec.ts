import { expect, test, type Page } from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";
import { confirmSourceFlow, openSourceFlow } from "../source-flow-helpers";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

/** SessionGuard 收到 OWNER_LOCK_EVENT 后先展示锁定罩，再销毁服务端会话。 */
async function expectImmediateLock(page: Page): Promise<void> {
  await expect(
    page.getByRole("status").filter({ hasText: "敏感内容已锁定" }),
  ).toBeVisible();
}

async function connectEthereum(page: Page): Promise<void> {
  await openSourceFlow(page, "EVM 观察钱包");
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await confirmSourceFlow(page, "Ethereum");
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
}

test("资金明细请求被驳回时立即锁定并收起套件内容", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/performance");
  await expect(page.getByTestId("workbench-shell")).toBeVisible();

  await page.route("**/api/investment-cashflows", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "需要所有者身份" }),
    }),
  );

  await page.getByRole("button", { name: "新增资金记录" }).click();
  await page.getByLabel("发生时间").fill("2026-08-09T12:00");
  await page.getByLabel("金额").fill("100");
  await page.getByRole("button", { name: "保存资金记录" }).click();

  await expectImmediateLock(page);
  await expect(page.getByTestId("investment-performance-workspace")).toHaveCount(0);
});

test("来源详情请求被驳回时立即锁定，不再展示来源详情", async ({ page, request }) => {
  await request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await connectEthereum(page);
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /^Ethereum 观察钱包 · / }).click();
  await expect(page.getByRole("heading", { name: "Ethereum 观察钱包" })).toBeVisible();

  await page.route("**/api/asset-sources/*", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "需要所有者身份" }),
    }),
  );

  await page.getByLabel("自定义名称").fill("长期钱包");
  await page.getByRole("button", { name: "保存名称" }).click();

  await expectImmediateLock(page);
  await expect(page.getByRole("heading", { name: "Ethereum 观察钱包" })).toHaveCount(0);
});

test("备份导出请求被驳回时立即锁定，不再展示设置与安全", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();

  await page.route("**/api/business-data-backups", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "需要所有者身份" }),
    }),
  );

  await page.getByRole("button", { name: "导出业务数据备份" }).click();

  await expectImmediateLock(page);
  await expect(page.getByRole("heading", { name: "设置与安全" })).toHaveCount(0);
});
