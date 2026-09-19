import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function screenshot(page: Page, name: string) {
  const directory = process.env.FORMAL_SETTLEMENT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name + ".png"), fullPage: true });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  // Authentication responds before the client finishes its dashboard navigation.
  await expect(page.getByTestId("formal-daily-settlement")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("正式日结固定证券官方收盘、同窗加密价格且幂等", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-production-shaped" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result).toMatchObject({
    currentSecurityPrice: "217.250",
    currentSecuritySession: "post-market",
    firstRun: { outcome: "recorded" },
    secondRun: { outcome: "already-recorded" },
    dailyTrendCount: 0,
    settlements: [{
      anchor: {
        key: "securities-close:US:2026-08-05",
        kind: "securities-close",
        market: "US",
        tradingDay: "2026-08-05",
        scheduledCloseAt: "2026-08-05T20:00:00.000Z",
      },
      capturedAt: "2026-08-05T20:05:00.000Z",
      status: "complete",
      diagnostic: null,
      total: {
        USD: "313.94",
        CNY: "2260.368",
        HKD: "2448.732",
      },
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        source: "正式日结测试汇率",
        observedAt: "2026-08-05T20:05:00.000Z",
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "正式日结测试汇率",
        observedAt: "2026-08-05T20:05:00.000Z",
      }],
      sources: [{
        sourceId: "longbridge-source",
        label: "长桥证券",
        kind: "longbridge",
        capturedAt: "2026-08-05T20:05:00.000Z",
        status: "complete",
        diagnostic: null,
        total: {
          USD: "211.94",
          CNY: "1525.968",
          HKD: "1653.132",
        },
      }, {
        sourceId: "crypto-source",
        label: "加密资产",
        kind: "crypto-fixture",
        capturedAt: "2026-08-05T20:05:00.000Z",
        status: "complete",
        diagnostic: null,
        total: {
          USD: "102",
          CNY: "734.4",
          HKD: "795.6",
        },
      }],
      holdings: [{
        sourceId: "longbridge-source",
        symbol: "NVDA.US",
        quantity: "1",
        assetClass: "securities",
        price: { amount: "211.940", currency: "USD" },
        priceBasis: "official-close",
        market: "US",
        marketTradingDay: "2026-08-05",
      }, {
        sourceId: "crypto-source",
        symbol: "BTC",
        quantity: "0.002",
        assetClass: "crypto",
        price: { amount: "51000", currency: "USD" },
        priceBasis: "capture-time",
        market: null,
        marketTradingDay: null,
      }],
    }],
  });
  expect(result.settlements).toHaveLength(1);
  expect(result.settlements[0].sources).toHaveLength(2);
  expect(result.settlements[0].holdings).toHaveLength(2);
  expect(result.settlementCountAfterSourceDeletion).toBe(0);
});

test("手工资产保留已知金额但不阻塞正式日结", async ({ request }) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-with-manual-source" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.outcome).toBe("recorded");
  expect(result.settlement.status).toBe("incomplete");
  expect(result.settlement.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({
    sourceId: "manual-source",
    status: "incomplete",
    diagnostic: "手工资产没有同一采集窗口的可验证行情",
    total: { USD: "13888.888888888888888888", CNY: "100000", HKD: "108333.3333333333333333264" },
    }),
  ]));
});

test("公开观察钱包没有可靠参考汇率时严格标记不完整", async ({ request }) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-with-public-evm-source" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.outcome).toBe("recorded");
  expect(result.settlement.status).toBe("incomplete");
  expect(result.settlement.sources).toHaveLength(1);
  expect(result.settlement.sources[0]).toMatchObject({
    sourceId: "public-evm-source",
    status: "incomplete",
  });
});

test("公开观察钱包带长桥参考汇率时完成正式日结", async ({ request }) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-with-public-evm-source-with-reference" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.outcome).toBe("recorded");
  expect(result.settlement.status).toBe("complete");
  expect(result.settlement.exchangeRates).toEqual(expect.arrayContaining([
    expect.objectContaining({ quoteCurrency: "CNY", rate: "7.2" }),
    expect.objectContaining({ quoteCurrency: "HKD", rate: "7.8" }),
  ]));
  expect(result.settlement.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceId: "public-evm-source",
      status: "complete",
    }),
  ]));
});

for (const [currency, action] of [
  ["CNY", "run-without-cny-rate"],
  ["HKD", "run-without-hkd-rate"],
] as const) {
  test(`缺少 ${currency} 汇率时正式日结严格标记不完整`, async ({ request }) => {
    const response = await request.post("/test-doubles/formal-settlements", {
      data: { action },
    });

    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.outcome).toBe("recorded");
    expect(result.settlement.status).toBe("incomplete");
    expect(result.settlement.total[currency]).toBeNull();
    expect(result.settlement.exchangeRates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ quoteCurrency: currency })]),
    );
  });
}

test("所有者看板把正式日结与每日趋势观测分开标注", async ({
  page,
  request,
}) => {
  const configured = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure-classified" },
  });
  expect(configured.ok()).toBeTruthy();
  const seeded = await request.post("/test-doubles/formal-settlements", {
    data: { action: "seed-owner-view" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  const settlement = page.getByTestId("formal-daily-settlement");
  await expect(settlement).toContainText("正式日结");
  await expect(settlement).toContainText("完整");
  await expect(settlement).toContainText("US 常规盘 · 交易日 2026-08-05");
  await expect(settlement).toContainText("证券按官方日 K 常规盘收盘记录");
  await expect(settlement).toContainText("加密资产按同一采集窗口市价记录");
  await expect(page.getByTestId("overview-trend").getByRole("heading", { name: "近 7 日资产走势" })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`正式日结空态、历史质量与隐私 ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginAsOwner(page);
    const settlement = page.getByTestId("formal-daily-settlement");
    await expect(settlement).toContainText("暂无记录");
    await expect(settlement).toContainText("尚无正式日结记录，实时资产和近7日趋势仍可查看");
    await expect(settlement).not.toContainText("日切后生成");
    await expect(settlement.getByRole("link", { name: "查看自动日结状态" })).toHaveAttribute("href", "/settings#automatic-daily-settlement");
    await expectNoOverflow(page);
    await screenshot(page, `home-empty-${width}`);
    for (const [quality, label] of [["complete", "完整"], ["incomplete", "不完整"], ["missed", "错过窗口"]] as const) {
      expect((await request.post("/test-doubles/formal-settlements", { data: { action: "seed-owner-view", quality } })).ok()).toBe(true);
      await page.reload();
      await expect(settlement).toContainText(label);
      await expect(settlement).toContainText("US 常规盘 · 交易日 2026-08-05");
      if (quality === "missed") {
        await expect(settlement).toContainText("未采集");
        await expect(settlement).toContainText("未使用之后的实时数据补写");
        await expect(settlement.locator(".formal-daily-settlement-amount")).toHaveText("未完整折算");
      } else {
        await expect(settlement.locator(".formal-daily-settlement-amount")).toHaveText("313.94 USD");
        if (quality === "incomplete") await expect(settlement).toContainText("已知金额不代表完整资产总额");
      }
      await expectNoOverflow(page);
      await screenshot(page, `home-${quality}-${width}`);
      if (quality === "complete") {
        await page.getByTestId("global-sensitive-info-toggle").click();
        await expect(settlement.locator(".formal-daily-settlement-amount")).toHaveText("•••••• USD");
        await expect(settlement).not.toContainText("313.94");
        await screenshot(page, `home-hidden-${width}`);
        await page.getByTestId("global-sensitive-info-toggle").click();
      }
    }
  });

  test(`自动日结只读状态与安全原因 ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginAsOwner(page);
    for (const scenario of ["not-loaded", "unknown", "error", "waiting"] as const) {
      expect((await request.post("/test-doubles/formal-settlements", { data: { action: "seed-runtime-view", scenario } })).ok()).toBe(true);
      await page.goto("/settings#automatic-daily-settlement");
      // Same-document hash navigation does not fetch the newly seeded server state.
      await page.reload();
      const panel = page.locator("#automatic-daily-settlement");
      await expect(panel).toContainText(scenario === "not-loaded" ? "本机配置存在，任务未加载" : "调度状态未知：无法确认本机任务");
      await expect(panel).toContainText("外部调度状态未知");
      await expect(panel).toContainText("暂无记录不代表未启用");
      await expect(panel.getByRole("button")).toHaveCount(0);
      if (scenario === "error" || scenario === "waiting") {
        await expect(panel).toContainText(scenario === "error" ? "执行失败" : "等待行情");
        await expect(panel).toContainText(scenario === "error" ? "官方日 K 读取失败，本次未生成日结" : "官方收盘行情尚未齐备，本次未生成日结");
      } else await expect(panel).toContainText("暂无执行记录");
      await expectNoOverflow(page);
      await screenshot(page, `settings-${scenario}-${width}`);
      if (scenario === "error" || scenario === "waiting") {
        await page.goto("/");
        await expect(page.getByTestId("formal-daily-settlement")).toContainText(scenario === "error" ? "最近一次执行：执行失败" : "最近一次执行：等待行情");
      }
    }
  });
}

test("未登录及演示不暴露执行记录", async ({ page, request }) => {
  expect((await request.post("/test-doubles/formal-settlements", { data: { action: "seed-runtime-view", scenario: "error" } })).ok()).toBe(true);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#automatic-daily-settlement")).toHaveCount(0);
  await expect(page.getByTestId("formal-daily-settlement")).toHaveCount(0);
  await page.goto("/?mode=demo");
  await expect(page.getByTestId("demo-mode-dashboard")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("最近一次执行：执行失败");
  await expect(page.locator("body")).not.toContainText("官方日 K 读取失败");
});
