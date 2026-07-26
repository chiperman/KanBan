import { expect, test, type CDPSession, type Page } from "@playwright/test";

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
  await page
    .getByTestId("restricted-card")
    .first()
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
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
  await expect(page.getByTestId("restricted-card")).toHaveCount(6);
  await expect(page.getByTestId("total-overview-placeholder")).toBeVisible();
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
  await expect(overview).toContainText("汇总不完整 · 2 项未估值");
  await expect(overview.getByLabel("资产分布")).toContainText("证券");
  await expect(overview.getByLabel("资产分布")).toContainText("100,000.00 USD");
  await expect(overview.getByLabel("资产分布")).toContainText("加密资产");
  await expect(overview.getByLabel("资产分布")).toContainText("42,548.00 USD");

  await page.getByTestId("binance-card").getByRole("button", { name: "查看全部持仓" }).click();
  const binance = page.getByRole("dialog", { name: "Binance 全部持仓" });
  await expect(binance).toContainText("0.998 USD");
  await binance.getByRole("button", { name: "关闭详情" }).click();
  await page.getByTestId("okx-card").getByRole("button", { name: "查看全部持仓" }).click();
  const okx = page.getByRole("dialog", { name: "OKX 全部持仓" });
  await expect(okx).toContainText("1.005 USD");
  await okx.getByRole("button", { name: "关闭详情" }).click();

  await overview.getByLabel("分布维度").selectOption("source");
  for (const source of [
    "长桥只读账户",
    "Binance 只读账户",
    "OKX 只读账户",
    "Bitget 只读账户",
    "Ethereum 观察钱包",
    "BNB Smart Chain 观察钱包",
  ]) {
    await expect(overview.getByLabel("资产分布")).toContainText(source);
  }
  await overview.getByLabel("计价货币").selectOption("CNY");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText(
    "1,026,345.60 CNY",
  );
  await expect(overview).toContainText("USD/CNY 7.2 · 发布验收汇率");
  await overview.getByLabel("计价货币").selectOption("USD");

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
  await expect(page.getByTestId("longbridge-card")).toContainText("最后成功：2026-01-01 00:00 UTC");
  await expect(page.getByTestId("binance-card")).toContainText("最后成功：2026-01-01 00:10 UTC");
  await expect(overview).toContainText("包含 2 个过期来源");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText("142,548.00 USD");
  await expect(page.getByTestId("longbridge-card").getByTestId("asset-source-total")).toHaveText(
    "100,000 USD",
  );
});

test("完整访客到所有者再锁定旅程不泄露敏感数据且不存在越界入口", async ({
  page,
}) => {
  await loginAsOwner(page);
  await expect(page.getByRole("button", { name: "配置恢复认证" })).toBeVisible();
  await page.getByRole("button", { name: "编辑布局" }).click();
  await expect(page.getByText(/布局编辑模式：/)).toBeVisible();
  await page.getByRole("button", { name: "取消布局编辑" }).click();
  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("锁定");
  await page.getByRole("button", { name: "立即锁定敏感内容" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByTestId("restricted-card")).toHaveCount(6);

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
