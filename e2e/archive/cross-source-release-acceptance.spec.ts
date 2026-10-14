import { expect, test, type Page } from "@playwright/test";

import { chooseOverviewOption } from "../overview-control-helpers";
import { loginAsOwner } from "../owner-auth-helpers";

const FORBIDDEN_SECRETS = [
  "release-longbridge-token",
  "release-binance-secret",
  "release-okx-secret",
  "release-bitget-secret",
  "release-ethereum-addresses",
  "release-bsc-addresses",
];

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await expect(seeded.json()).resolves.toEqual({ sourceCount: 6, secretCount: 6 });
});

test("六类来源形成正确总额、分布、真实稳定币价格与失败隔离", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);
  await loginAsOwner(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  const overview = page.getByTestId("overview-current-total");
  await expect(overview).toContainText("142,548.00 USD");
  await expect(page.getByTestId("overview-confidence")).toContainText("总额完整");
  await page.goto("/assets");
  await expect(page.locator("tr.is-unvalued")).toHaveCount(0);
  // Unfollowed EVM assets stay visible in asset scope, outside the valued portfolio.
  for (const [sourceId, chainId] of [
    ["test-evm-watch-ethereum-source-5", "1"],
    ["test-evm-watch-bsc-source-6", "56"],
  ]) {
    await page.goto(`/asset-sources/${sourceId}/settings`);
    const pending = page.getByRole("region", { name: "待确认资产" });
    await expect(pending.getByRole("listitem")).toHaveCount(1);
    await expect(pending).toContainText("UNKNOWN");
    await expect(pending).toContainText(`evm:${chainId}:0xcccccccccccccccccccccccccccccccccccccccc`);
    await expect(pending).toContainText("数量：7");
    await expect(pending.getByRole("button", { name: "需要关注" })).toBeEnabled();
  }
  await page.goto("/");
  const summaries = page.locator(".daily-overview__source-list > li");
  await expect(summaries).toHaveCount(6);
  const securities = summaries.filter({ hasText: "长桥账户" });
  await expect(securities.locator(".daily-overview__source-total")).toContainText("100,000.00 USD");
  const cryptoAmounts = await summaries.filter({ hasNotText: "长桥账户" }).locator(".daily-overview__source-total").allTextContents();
  expect(cryptoAmounts.reduce((sum, amount) => sum + Number(amount.replaceAll(",", "").replace("USD", "").trim()), 0)).toBe(42548);

  await chooseOverviewOption(page, "计价货币", "CNY");
  await expect(overview).toContainText(
    "1,026,345.60 CNY",
  );
  await expect(page.getByTestId("overview-reporting-rate")).toContainText("USD/CNY 7.2000");
  await chooseOverviewOption(page, "计价货币", "USD");

  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:10:00.000Z" },
  });
  const failed = await page.request.post("/test-doubles/release-acceptance", {
    data: { action: "partial-failure" },
  });
  expect(failed.ok()).toBeTruthy();
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "部分来源刷新失败",
  );
  await expect(page.getByTestId("overview-confidence")).toContainText("过期来源 2 个");
  await expect(overview).toContainText("142,548.00 USD");

  await page.getByRole("link", { name: "查看 长桥账户 的资产明细" }).click();
  const longbridge = page.getByTestId("longbridge-card");
  await expect(longbridge.locator(".source-live-state")).toHaveText("LB / ERROR");
  await expect(longbridge).toContainText("最后更新：2026-01-01 08:00");
  await expect(longbridge).not.toContainText("最后成功：");
  await expect(longbridge.getByTestId("asset-source-total")).toHaveText(
    "100,000.00 USD",
  );

  await page.goto("/");
  await page.getByRole("link", { name: "查看 Binance 只读账户 的资产明细" }).click();
  const binance = page.getByTestId("binance-card");
  await expect(binance.locator(".source-live-state")).toHaveText("BN / CURRENT");
  await expect(binance).toContainText("最后更新：2026-01-01 08:10");

  await page.goto("/");
  await page.getByRole("link", {
    name: "查看 Ethereum 观察钱包 的资产明细",
  }).click();
  await expect(page.getByTestId("ethereum-watch-card").locator(".source-live-state")).toHaveText("ETH / ERROR");
  await page.goto("/");
  await page.getByRole("link", {
    name: "查看 BNB Smart Chain 观察钱包 的资产明细",
  }).click();
  await expect(page.getByTestId("bsc-watch-card").locator(".source-live-state")).toHaveText("BSC / CURRENT");
});

test("完整锁定到所有者再锁定旅程不泄露敏感数据且不存在越界入口", async ({
  page,
}) => {
  await loginAsOwner(page);
  await expect(page.getByRole("link", { name: "设置与安全", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "配置 TOTP 登录" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /新建身份卡片|新建 Now 卡片|新建链接卡片|新建 Markdown 卡片/,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("锁定");
  await page.getByRole("button", { name: "立即锁定敏感内容" }).click();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);

  const networkBodies: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || url.pathname.startsWith("/_next/")) {
      return;
    }
    const contentType = response.headers()["content-type"] ?? "";
    if (!/text|json/.test(contentType)) return;
    networkBodies.push(await response.text().catch(() => ""));
  });
  await page.reload();
  const unauthorized = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  expect(unauthorized.status()).toBe(401);
  expect(await unauthorized.text()).not.toContain("142548");
  const html = await (await page.request.get("/")).text();
  const browserHtml = await page.content();
  const exposed = `${html}\n${browserHtml}\n${networkBodies.join("\n")}`;
  for (const secret of FORBIDDEN_SECRETS) expect(exposed).not.toContain(secret);
  for (const privateValue of [
    "142548",
    "NVDA",
    "USDT",
    "长桥只读账户",
    "Ethereum 观察钱包",
    "2026-01-01T00:00:00.000Z",
  ]) {
    expect(exposed).not.toContain(privateValue);
  }
  await expect(
    page.getByRole("button", {
      name: /下单|交易|划转|提现|签名|通知|合约|杠杆|DeFi|NFT|注册/,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开快捷命令" })).toHaveCount(0);
});
