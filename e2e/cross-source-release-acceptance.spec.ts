import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { chooseOverviewOption } from "./overview-control-helpers";

const FORBIDDEN_SECRETS = [
  "release-longbridge-token",
  "release-binance-secret",
  "release-okx-secret",
  "release-bitget-secret",
  "release-ethereum-addresses",
  "release-bsc-addresses",
];

async function attachPasskey(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return client;
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

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

  for (const testId of [
    "longbridge-card",
    "binance-card",
    "okx-card",
    "bitget-card",
    "ethereum-watch-card",
    "bsc-watch-card",
  ]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const sourceCardTops = await page.getByTestId("card").evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top)),
  );
  expect(new Set(sourceCardTops.slice(0, 3)).size).toBe(1);
  expect(new Set(sourceCardTops.slice(3, 6)).size).toBe(1);
  expect(sourceCardTops[3]).toBeGreaterThan(sourceCardTops[0]);
  const overview = page.getByTestId("total-overview-card");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText("142,548.00 USD");
  await expect(overview).toContainText("当前估值：不完整 · 2 项未估值");
  await expect(overview.getByLabel("资产分布")).toContainText("证券");
  await expect(overview.getByLabel("资产分布")).toContainText("100,000.00 USD");
  await expect(overview.getByLabel("资产分布")).toContainText("加密资产");
  await expect(overview.getByLabel("资产分布")).toContainText("42,548.00 USD");

  await chooseOverviewOption(overview, "分布维度", "资产来源");
  for (const source of [
    "长桥账户",
    "Binance 只读账户",
    "OKX 只读账户",
    "Bitget 只读账户",
    "Ethereum 观察钱包",
    "BNB Smart Chain 观察钱包",
  ]) {
    await expect(overview.getByLabel("资产分布")).toContainText(source);
  }
  await chooseOverviewOption(overview, "计价货币", "CNY");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText(
    "1,026,345.60 CNY",
  );
  await expect(overview).toContainText("USD/CNY 7.2000 · 发布验收汇率");
  await chooseOverviewOption(overview, "计价货币", "USD");

  await expect(page.getByTestId("asset-refresh-status")).toContainText("同步完成");
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T00:10:00.000Z" },
  });
  const failed = await page.request.post("/test-doubles/release-acceptance", {
    data: { action: "partial-failure" },
  });
  expect(failed.ok()).toBeTruthy();
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成 · 2 个来源失败",
  );
  await expect(page.getByTestId("longbridge-card")).toContainText("过期数据");
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("过期数据");
  await expect(page.getByTestId("binance-card")).toContainText("数据当前");
  await expect(page.getByTestId("bsc-watch-card")).toContainText("数据当前");
  await expect(page.getByTestId("longbridge-card")).toContainText("最后更新：2026-01-01 08:00");
  await expect(page.getByTestId("binance-card")).toContainText("最后更新：2026-01-01 08:10");
  await expect(page.getByTestId("longbridge-card")).not.toContainText("最后成功：");
  await expect(overview).toContainText("包含 2 个过期来源");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText("142,548.00 USD");
  await expect(page.getByTestId("longbridge-card").getByTestId("asset-source-total")).toHaveText(
    "100,000.00 USD",
  );
});

test("完整锁定到所有者再锁定旅程不泄露敏感数据且不存在越界入口", async ({
  page,
}) => {
  await loginAsOwner(page);
  await expect(page.getByRole("link", { name: "本机设置" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "配置备用登录" }),
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
    page.getByRole("heading", { name: "个人资产看板已锁定" }),
  ).toBeVisible();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);

  const networkBodies: string[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== "http://localhost:3101" || url.pathname.startsWith("/_next/")) {
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
