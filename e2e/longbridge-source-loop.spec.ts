import { expect, test, type CDPSession, type Page } from "@playwright/test";

import {
  isLongbridgeUsOptionSymbol,
} from "@/server/asset-sources/longbridge";
import { supportsLongbridgeCandlesticks } from "@/domain/longbridge-symbols";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

const PRIVATE_CARD = {
  id: "private-entry",
  kind: "asset",
  title: "私密入口",
  body: "仅用于解锁所有者视图",
  span: 1,
} as const;

const SECRET_TOKEN = "oauth-access-token-must-never-reach-browser";
const PRODUCTION_ACCESS_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: JSON.stringify({ account_channel: "lb" }),
  })).toString("base64url"),
  "test-signature",
].join(".");
const PRODUCTION_REFRESH_TOKEN = "refresh-token-must-never-reach-browser";

test("长桥美股期权代码支持可变长度行权价且拒绝无效到期日", () => {
  for (const symbol of [
    "NVDA260805C210000.US",
    "HOOD260807P89000.US",
    "SPXW260807P6345.US",
    "^SPX260807C1.US",
    "BRK.B260807C450000.US",
  ]) {
    expect(isLongbridgeUsOptionSymbol(symbol)).toBe(true);
  }
  for (const symbol of [
    "AAPL260232C210000.US",
    "AAPL260807C210000.HK",
    "AAPL.US",
  ]) {
    expect(isLongbridgeUsOptionSymbol(symbol)).toBe(false);
  }
  expect(supportsLongbridgeCandlesticks("AAPL.US")).toBe(true);
  expect(supportsLongbridgeCandlesticks("NVDA260805C210000.US")).toBe(false);
  expect(supportsLongbridgeCandlesticks("HK0000038064")).toBe(false);
});

async function attachPasskey(page: Page): Promise<VirtualPasskey> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = (await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    },
  )) as { authenticatorId: string };
  return { client, authenticatorId };
}

async function colorToken(
  page: Page,
  token: "--success" | "--error",
): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function configureLongbridge(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const response = await page.request.post("/test-doubles/longbridge", {
    data: {
      credentials: {
        accessToken: SECRET_TOKEN,
        refreshToken: "refresh-token-must-never-reach-browser",
      },
      permissions: ["account", "positions"],
      account: { id: "U12345", label: "长桥证券账户 U12345" },
      accountPages: [
        {
          code: 0,
          data: {
            list: [
              {
                account_channel: "lb",
                currency: "USD",
                net_assets: "123456.7891",
              },
            ],
          },
        },
      ],
      positionPages: [
        {
          code: 0,
          data: { list: [{
            account_channel: "lb",
            stock_info: [{
              symbol: "AAPL.US",
              symbol_name: "Apple",
              quantity: "10.125",
              currency: "USD",
              cost_price: "190.1234",
            }, {
              symbol: "NVDA.US",
              symbol_name: "NVIDIA",
              quantity: "20",
              currency: "USD",
              cost_price: "150.5",
            }, {
              symbol: "0700.HK",
              symbol_name: "Tencent",
              quantity: "50",
              currency: "HKD",
              cost_price: "410.75",
            }, {
              symbol: "MSFT.US",
              symbol_name: "Microsoft",
              quantity: "12",
              currency: "USD",
              cost_price: "350",
            }, {
              symbol: "9988.HK",
              symbol_name: "Alibaba",
              quantity: "80",
              currency: "USD",
              cost_price: "98.8",
            }, {
              symbol: "TSLA.US",
              symbol_name: "Tesla",
              quantity: "3.5",
              currency: "USD",
              cost_price: "390",
            }],
          }] },
        },
        {
          code: 0,
          data: { list: [{
            account_channel: "lb",
            fund_info: [{
              symbol: "HK0000038064",
              symbol_name: "高腾微金美元货币基金A",
              holding_units: "10",
              currency: "USD",
              current_net_asset_value: "15.22",
              cost_net_asset_value: "14.50",
              net_asset_value_day: "1649865600",
            }],
          }] },
        },
      ],
      quotes: [{
        symbol: "AAPL.US",
        lastDone: "10",
        prevClose: "9.5",
        timestamp: 1767225600,
      }],
      exchangeRates: [{
        base_currency: "CNY",
        other_currency: "USD",
        average_rate: "7.2",
      }, {
        base_currency: "HKD",
        other_currency: "USD",
        average_rate: "7.8",
      }],
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function startLongbridgeFlow(page: Page): Promise<void> {
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "长桥 Longbridge" }).click();
  await page.getByRole("button", { name: "开始 OAuth 授权" }).click();
}

function longbridgePreview(page: Page) {
  return page.getByRole("region", { name: "校验与范围预览" });
}

async function confirmLongbridgeSourceAndOpenDetail(page: Page): Promise<void> {
  const directory = page.waitForURL("**/asset-sources");
  await longbridgePreview(page)
    .getByRole("button", { name: "确认并保存" })
    .click();
  await directory;
  await page.getByRole("link", { name: /^长桥账户 · 自动账户/ }).click();
  await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/asset-cards", { data: { assetCards: [PRIVATE_CARD] } });
});

test("长桥 OAuth 回调的所有者会话允许跨站顶层导航", async ({ page }) => {
  await loginAsOwner(page);

  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "pad_session",
  );
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
});

test("长桥 OAuth 先预览后原子保存，并在来源详情展示总额与持仓", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);

  const responseBodies: string[] = [];
  const consoleErrors: string[] = [];
  const browserRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => browserRequests.push(request.url()));
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responseBodies.push(await response.text().catch(() => ""));
    }
  });

  await startLongbridgeFlow(page);

  const preview = longbridgePreview(page);
  await expect(preview).toContainText("账户、持仓（只读）");
  await expect(preview).toContainText("123,456.7891 USD");
  await expect(page.getByText("oauth-access-token")).toHaveCount(0);

  const beforeConfirm = await page.request.get("/test-doubles/longbridge");
  await expect(beforeConfirm.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await confirmLongbridgeSourceAndOpenDetail(page);
  const sourceDetailUrl = page.url();

  const card = page.getByTestId("longbridge-card");
  await expect(card).toContainText("123,456.79 USD");
  await expect(card).toContainText("最后更新：2026-01-01 08:00");
  await expect(card).not.toContainText("UTC");
  const holdingDetails = card.getByTestId("asset-holdings-detail");
  await expect(holdingDetails).toBeVisible();
  await expect(card.getByRole("button", { name: "查看全部持仓" })).toHaveCount(0);

  const holdingsDetailToggle = card.getByTestId("asset-holdings-detail-toggle");
  await expect(holdingsDetailToggle).toHaveAttribute("aria-expanded", "true");
  await expect(holdingsDetailToggle).toHaveAccessibleName("收起证券持仓明细");
  await holdingsDetailToggle.click();
  await expect(holdingDetails).toBeHidden();
  await expect(holdingsDetailToggle).toHaveAttribute("aria-expanded", "false");
  await expect(holdingsDetailToggle).toHaveAccessibleName("展开证券持仓明细");
  await holdingsDetailToggle.click();
  await expect(holdingDetails).toBeVisible();
  await expect(holdingDetails.getByRole("row")).toHaveCount(8);
  await expect(holdingDetails.getByRole("columnheader")).toHaveText([
    "名称",
    /市值\s*\/\s*数量/,
    /现价\s*\/\s*成本/,
    "当日盈亏",
    "持仓盈亏",
  ]);
  const appleHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "Apple" });
  const appleTodayProfit = appleHolding.locator(
    ".holding-profit-summary--today",
  );
  await expect(appleTodayProfit).toContainText("+5.06");
  await expect(appleTodayProfit).toContainText("+5.26%");
  const fundHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" });
  await expect(fundHolding.getByRole("cell")).toHaveText([
    /高腾微金美元货币基金A.*HK0000038064.*Longbridge 基金净值 · 2022-04-14 00:00/,
    /152.20.*10/,
    /15.22.*14.50/,
    /—.*—/,
    /\+7.20.*\+4.97%/,
  ]);
  await expect(holdingDetails).not.toContainText(/\bUSD\b/);

  await page.getByRole("button", { name: /计价货币/ }).click();
  await page.getByRole("option", { name: "CNY" }).click();
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "无法折算 CNY",
  );
  await page.getByRole("button", { name: /计价货币/ }).click();
  await page.getByRole("option", { name: "USD" }).click();
  const profitCells = fundHolding.locator(".holding-profit-summary--position");
  await expect(profitCells).toHaveCount(1);
  const errorColor = await colorToken(page, "--error");
  await expect(profitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "red-up",
  );
  await expect(profitCells).toHaveCSS("color", errorColor);

  await expect(
    page.getByTestId("total-asset-overview").getByRole("button", {
      name: "盈亏颜色",
    }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "设置与安全" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "盈亏颜色" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /绿涨红跌/ }).check();
  await expect(page.getByRole("radio", { name: /绿涨红跌/ })).toBeChecked();
  await expect(
    page.getByRole("link", { name: "返回资产看板" }),
  ).toHaveCount(0);
  await page.goto(sourceDetailUrl);

  const updatedProfitCells = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-holdings-detail")
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" })
    .locator(".holding-profit-summary--position");
  const successColor = await colorToken(page, "--success");
  await expect(updatedProfitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "green-up",
  );
  await expect(updatedProfitCells).toHaveCSS(
    "color",
    successColor,
  );

  await page.reload();
  const reloadedProfitCells = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-holdings-detail")
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" })
    .locator(".holding-profit-summary--position");
  await expect(reloadedProfitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "green-up",
  );
  await expect(holdingDetails).toContainText("Longbridge 基金净值 · 2022-04-14 00:00");

  const state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 1,
    savedSecrets: 1,
    fetchedPositionPages: 2,
  });

  expect(responseBodies.join("\n")).not.toContain(SECRET_TOKEN);
  expect(await page.content()).not.toContain(SECRET_TOKEN);
  expect(consoleErrors).toEqual([]);
  expect(browserRequests).not.toContainEqual(expect.stringContaining("mcp.longbridge.com"));
});

test("长桥普通证券 K 线默认日K，可切换周期且遵守隐私状态", async ({
  page,
}) => {
  const anonymousCandles = await page.request.get(
    "/api/asset-sources/not-a-source/candles?symbol=AAPL.US&period=day",
  );
  expect(anonymousCandles.status()).toBe(401);

  await configureLongbridge(page);
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await confirmLongbridgeSourceAndOpenDetail(page);

  const card = page.getByTestId("longbridge-card");

  const holdingDetails = card.getByTestId("asset-holdings-detail");
  await expect(holdingDetails).toBeVisible();
  const appleHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "Apple" });
  const fundHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" });
  const appleCandles = appleHolding.getByRole("button", { name: "K线" });
  await expect(appleCandles).toBeVisible();
  await expect(fundHolding.getByRole("button", { name: "K线" })).toHaveCount(0);

  const candleRequestUrls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/candles")) {
      candleRequestUrls.push(request.url());
    }
  });
  const hasCandlePeriod = (url: string, period: string) => {
    const parsed = new URL(url);
    return (
      parsed.pathname.includes("/candles") &&
      parsed.searchParams.get("symbol") === "AAPL.US" &&
      parsed.searchParams.get("period") === period
    );
  };

  const firstRequest = page.waitForRequest((request) =>
    hasCandlePeriod(request.url(), "day"),
  );
  const firstResponse = page.waitForResponse((response) =>
    hasCandlePeriod(response.url(), "day"),
  );
  await appleCandles.click();
  expect(new URL((await firstRequest).url()).searchParams.get("period")).toBe("day");
  const dayResponse = await firstResponse;
  expect(dayResponse.status()).toBe(200);
  const dayBody = await dayResponse.json();
  expect(dayBody).toMatchObject({ symbol: "AAPL.US", period: "day" });
  expect(JSON.stringify(dayBody)).not.toContain(SECRET_TOKEN);

  const dialog = page.getByRole("dialog", { name: "查看 Apple K线" });
  await expect(dialog.getByRole("button", { name: "日K" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog).toContainText("常规盘 · 未复权 · 日K");
  await expect(dialog.getByTestId("holding-candlestick")).toHaveCount(12);
  await expect(dialog.locator("svg polyline")).toHaveCount(0);

  const fiveDayRequest = page.waitForRequest((entry) =>
    hasCandlePeriod(entry.url(), "five-day"),
  );
  const fiveDayResponse = page.waitForResponse((entry) =>
    hasCandlePeriod(entry.url(), "five-day"),
  );
  await dialog.getByRole("button", { name: "5日" }).click();
  expect(new URL((await fiveDayRequest).url()).searchParams.get("period")).toBe("five-day");
  const fiveDayResult = await fiveDayResponse;
  expect(fiveDayResult.status(), await fiveDayResult.text()).toBe(200);
  const fiveDayBody = await fiveDayResult.json();
  expect(fiveDayBody).toMatchObject({ symbol: "AAPL.US", period: "five-day" });
  expect(fiveDayBody, JSON.stringify(fiveDayBody)).toHaveProperty("trend");
  expect(fiveDayBody.trend).toHaveLength(390);
  await expect(dialog).toContainText("常规盘 · 未复权 · 近五个交易日走势（5分钟）");
  await expect(dialog.getByTestId("holding-trend-line")).toHaveCount(1);
  await expect(dialog.getByTestId("holding-candlestick")).toHaveCount(0);

  for (const [label, period] of [
    ["周K", "week"],
    ["月K", "month"],
    ["年K", "year"],
    ["1分", "min-1"],
  ]) {
    const request = page.waitForRequest((entry) => hasCandlePeriod(entry.url(), period));
    const response = page.waitForResponse((entry) => hasCandlePeriod(entry.url(), period));
    await dialog.getByRole("button", { name: label }).click();
    expect(new URL((await request).url()).searchParams.get("period")).toBe(period);
    expect((await response).status()).toBe(200);
  }

  const requestCountBeforeHide = candleRequestUrls.length;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("global-sensitive-info-toggle").click();
  await expect(appleHolding.getByRole("button", { name: "K线" })).toHaveCount(0);
  expect(candleRequestUrls).toHaveLength(requestCountBeforeHide);
});

test("证券持仓表在现价与成本之间显示供应商报价时段", async ({
  page,
}) => {
  await configureLongbridge(page, {
    quotes: [{
      symbol: "AAPL.US",
      lastDone: "215",
      prevClose: "210",
      timestamp: 1785960000,
      tradeStatus: "NORMAL",
    }, {
      symbol: "NVDA.US",
      lastDone: "181",
      prevClose: "180",
      timestamp: 1785960000,
      tradeStatus: "US_PREV",
      preMarketQuote: { lastDone: "184.25", timestamp: 1785964320 },
    }, {
      symbol: "TSLA.US",
      lastDone: "420",
      prevClose: "415",
      timestamp: 1785960000,
      tradeStatus: "US_AFTER",
      postMarketQuote: { lastDone: "422.5", timestamp: 1785963360 },
    }, {
      symbol: "MSFT.US",
      lastDone: "430",
      prevClose: "425",
      timestamp: 1785960000,
      tradeStatus: "US_NIGHT",
      overnightQuote: { lastDone: "432.5", timestamp: 1785958800 },
    }, {
      symbol: "0700.HK",
      lastDone: "600",
      prevClose: "590",
      timestamp: 1785961320,
      tradeStatus: "CLOSING",
      delivery: "delayed",
    }, {
      symbol: "9988.HK",
      lastDone: "128.25",
      prevClose: "125",
      timestamp: -1,
      tradeStatus: "CLOSING",
    }],
  });
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await confirmLongbridgeSourceAndOpenDetail(page);

  const card = page.getByTestId("longbridge-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "123,456.79 USD",
  );
  const detail = card.getByTestId("asset-holdings-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("columnheader")).toHaveText([
    "名称",
    /市值\s*\/\s*数量/,
    /现价\s*\/\s*成本/,
    "当日盈亏",
    "持仓盈亏",
  ]);

  for (const [symbol, label] of [
    ["AAPL.US", "常规盘 · 行情 2026-08-06 04:00"],
    ["NVDA.US", "盘前 · 行情 2026-08-06 05:12"],
    ["TSLA.US", "盘后 · 行情 2026-08-06 04:56"],
    ["MSFT.US", "夜盘 · 行情 2026-08-06 03:40"],
    ["0700.HK", "延迟行情 · 时段未知 · 行情 2026-08-06 04:22"],
    ["9988.HK", "时段未知 · 时间不可用"],
  ]) {
    const row = detail.locator("tbody tr").filter({ hasText: symbol });
    const priceCell = row.locator(".holding-current-cost-price");
    await expect(priceCell).toContainText(label);
    await expect(priceCell.locator(".holding-quote-session")).toHaveCount(1);
  }
  await expect(
    detail.locator("tbody tr").filter({ hasText: "9988.HK" }),
  ).toContainText("Longbridge 行情 · 时间不可用");

  const applePriceCell = detail
    .locator("tbody tr")
    .filter({ hasText: "AAPL.US" })
    .locator(".holding-current-cost-price");
  await expect(applePriceCell).toContainText("215.00");
  await expect(applePriceCell).toContainText("190.12");
});

test("长桥持仓刷新失败时保留最后成功数据并明确标记过期", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await confirmLongbridgeSourceAndOpenDetail(page);

  const card = page.getByTestId("longbridge-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "123,456.79 USD",
  );
  const configured = await page.request.post("/test-doubles/longbridge", {
    data: { scenario: "refresh-failure" },
  });
  expect(configured.ok()).toBeTruthy();

  await page.getByRole("button", { name: /^刷新 / }).click();
  await expect(page.getByTestId(/asset-source-refresh-status-/)).toContainText(
    "刷新失败",
  );
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "123,456.79 USD",
  );
  await expect(card.locator(".source-live-state")).toHaveText("LB / ERROR");
  await page.goto("/");
  await expect(page.getByTestId("overview-confidence")).toContainText(
    "过期来源 1 个",
  );
});

test("交易权限与授权或预览失败都被拒绝且不留下来源或凭证", async ({
  page,
}) => {
  await configureLongbridge(page, {
    permissions: ["account", "positions", "trade"],
  });
  await loginAsOwner(page);
  const started = await page.request.post(
    "/api/asset-sources/longbridge/oauth/start",
  );
  expect(started.ok()).toBeTruthy();
  const tampered = await page.request.get(
    "/api/asset-sources/longbridge/oauth/callback?code=fake-authorization-code&state=tampered",
    { maxRedirects: 0 },
  );
  expect(tampered.status()).toBe(302);
  expect(tampered.headers().location).toContain("longbridge_error=");
  await startLongbridgeFlow(page);
  const errorNotice = page.locator(".asset-source-flow__notice[role=alert]");
  await expect(errorNotice).toContainText(
    "检测到交易权限，已拒绝连接",
  );
  await expect(errorNotice).toHaveCSS("margin-bottom", "24px");

  let state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await configureLongbridge(page, { previewError: "长桥账户暂时无法读取" });
  await startLongbridgeFlow(page);
  await expect(page.locator(".asset-source-flow__notice[role=alert]")).toContainText("长桥账户暂时无法读取");
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await configureLongbridge(page, { commitError: "原子事务写入失败" });
  await startLongbridgeFlow(page);
  const preview = longbridgePreview(page);
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.locator(".asset-source-flow__notice[role=alert]")).toContainText("原子事务写入失败");
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", { name: /^长桥账户 · 自动账户/ }).click();
  await expect(page.getByTestId("longbridge-card")).toBeVisible();

  await page.goto(`${page.url()}/reauthorize?longbridge_error=授权范围校验失败`);
  const reauthorizationError = page.locator(
    ".asset-source-flow__notice[role=alert]",
  );
  const reauthorizationPanel = page.locator(".asset-source-flow__panel");
  await expect(reauthorizationError).toContainText("授权范围校验失败");
  await expect(reauthorizationPanel).toBeVisible();
  const reauthorizationErrorGap = await reauthorizationError.evaluate((notice) => {
    const panel = notice.parentElement?.querySelector(
      ":scope > .asset-source-flow__panel",
    );
    return panel === null || panel === undefined
      ? null
      : panel.getBoundingClientRect().top - notice.getBoundingClientRect().bottom;
  });
  expect(reauthorizationErrorGap).toBe(24);

  await configureLongbridge(page);
  const previewResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/asset-sources/longbridge/preview" &&
      url.searchParams.has("id")
    );
  });
  await startLongbridgeFlow(page);
  const concurrentPreview = longbridgePreview(page);
  await expect(concurrentPreview).toBeVisible();
  const previewId = (await previewResponse).json().then((body) => body.id);
  await expect(previewId).resolves.toEqual(expect.any(String));
  const confirmations = await Promise.all([
    page.request.post("/api/asset-sources/longbridge/confirm", { data: { id: await previewId } }),
    page.request.post("/api/asset-sources/longbridge/confirm", { data: { id: await previewId } }),
  ]);
  expect(confirmations.filter((response) => response.status() === 201)).toHaveLength(1);
  expect(confirmations.filter((response) => response.status() !== 201)).toHaveLength(1);
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({ savedSources: 1, savedSecrets: 1 });
  await expect(concurrentPreview).toBeVisible();
});

test("Keychain 长桥快照使用 USD 总额并按官方汇率估值跨币种持仓", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-snapshot" } },
  );
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.total).toEqual({ amount: "74442.43", currency: "USD" });
  expect(body.snapshot.exchangeRates).toContainEqual({
    baseCurrency: "HKD",
    quoteCurrency: "USD",
    rate: "0.12751",
    source: "Longbridge 官方账户汇率",
    observedAt: expect.any(String),
  });
  expect(body.snapshot.holdings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        symbol: "700.HK",
        marketValue: "6000",
        sourceMarketValue: { amount: "765.06", currency: "USD" },
        valuation: expect.objectContaining({ status: "valued" }),
      }),
      expect.objectContaining({
        symbol: "CASH.USD",
        name: "账户现金",
        quantity: "677.82",
        currency: "USD",
        assetClass: "cash",
        marketValue: "677.82",
        sourceMarketValue: { amount: "677.82", currency: "USD" },
        cashBalances: [{
          amount: "661.11",
          availableCash: "660.54",
          currency: "USD",
          frozenCash: "0.57",
          settlingCash: "0.57",
          withdrawCash: "660.54",
        }, {
          amount: "131.05",
          availableCash: "131.05",
          currency: "HKD",
          frozenCash: "0",
          settlingCash: "0",
          withdrawCash: "131.05",
        }],
        valuation: expect.objectContaining({
          status: "valued",
          priceSource: "Longbridge 账户现金总额",
        }),
      }),
      expect.objectContaining({
        symbol: "NVDA260805C210000.US",
        quantity: "-1",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "quote-unavailable",
          reason: "Longbridge Open API 未接入期权行情",
        },
      }),
      expect.objectContaining({
        symbol: "HOOD260807P89000.US",
        quantity: "-2",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "quote-unavailable",
          reason: "Longbridge Open API 未接入期权行情",
        },
      }),
      expect.objectContaining({
        symbol: "SPXW260807P6345.US",
        quantity: "-1",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "quote-unavailable",
          reason: "Longbridge Open API 未接入期权行情",
        },
      }),
    ]),
  );
});

test("Keychain 行情只按供应商会话与时间选择当前证券报价", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-quote-sessions" } },
  );

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const holdings = body.snapshot.holdings as Array<{
    symbol: string;
    currentPrice: { amount: string; currency: string } | null;
    quoteEvidence?: {
      session: string;
      quotedAt: string | null;
      freshness: string;
      delivery: string;
      provider: { name: string; tradeStatus: string | null };
    };
  }>;
  const holding = (symbol: string) =>
    holdings.find((item) => item.symbol === symbol);

  expect(holding("AAPL.US")).toMatchObject({
    currentPrice: { amount: "215.000", currency: "USD" },
    quoteEvidence: {
      session: "regular",
      quotedAt: "2026-08-05T20:00:00.000Z",
      freshness: "current",
      delivery: "unknown",
      provider: { name: "longbridge", tradeStatus: "NORMAL" },
    },
  });
  expect(holding("NVDA.US")).toMatchObject({
    currentPrice: { amount: "184.250", currency: "USD" },
    quoteEvidence: {
      session: "pre-market",
      quotedAt: "2026-08-05T21:12:00.000Z",
    },
  });
  expect(holding("TSLA.US")).toMatchObject({
    currentPrice: { amount: "422.500", currency: "USD" },
    quoteEvidence: {
      session: "post-market",
      quotedAt: "2026-08-05T20:56:00.000Z",
    },
  });
  expect(holding("MSFT.US")).toMatchObject({
    currentPrice: { amount: "500.125", currency: "USD" },
    quoteEvidence: {
      session: "overnight",
      quotedAt: "2026-08-05T19:40:00.000Z",
    },
  });
  expect(holding("0700.HK")).toMatchObject({
    currentPrice: { amount: "600.000", currency: "HKD" },
    quoteEvidence: {
      session: "unknown",
      quotedAt: "2026-08-05T20:22:00.000Z",
      delivery: "delayed",
    },
  });
  expect(holding("AMD.US")).toMatchObject({
    currentPrice: { amount: "177.000", currency: "USD" },
    quoteEvidence: {
      session: "unknown",
      quotedAt: "2026-08-05T20:05:00.000Z",
    },
  });
  expect(holding("META.US")).toMatchObject({
    currentPrice: { amount: "601.000", currency: "USD" },
    quoteEvidence: {
      session: "unknown",
      quotedAt: null,
    },
  });
});

test("Keychain 完整持仓刷新在单标的无报价时保留旧报价证据", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-holdings-retains-quote-evidence" } },
  );

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.syncedAt).toBe("2026-05-29T00:00:00.000Z");
  expect(body.snapshot.holdings).toHaveLength(1);
  expect(body.snapshot.holdings[0]).toMatchObject({
    symbol: "AAPL.US",
    currentPrice: { amount: "100", currency: "USD" },
    marketValue: "1000",
    quoteEvidence: {
      session: "post-market",
      quotedAt: "2026-05-28T20:04:00.000Z",
      freshness: "retained",
      delivery: "unknown",
    },
    valuation: {
      status: "valued",
      priceSource: "Longbridge 行情",
      pricedAt: "2026-05-28T20:04:00.000Z",
    },
  });
});

test("Keychain 瞬时认证失败只重试一次并给出统一修复命令", async ({
  request,
}) => {
  const recovered = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-refresh-retry" } },
  );
  expect(recovered.ok()).toBeTruthy();
  await expect(recovered.json()).resolves.toMatchObject({
    readAssetsCalls: 2,
    snapshot: {
      total: { amount: "74442.43", currency: "USD" },
    },
  });

  const exhausted = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-refresh-retry-exhausted" } },
  );
  expect(exhausted.status()).toBe(400);
  const exhaustedBody = await exhausted.json();
  expect(exhaustedBody.error).toContain("pnpm longbridge:keychain:repair");
  expect(exhaustedBody.error).not.toContain(
    "The user name or passphrase you entered is not correct",
  );
});

test("生产 OAuth 只申请 scope=6，接受已知只读组合并在读取前拒绝异常 scope", async ({
  request,
}) => {
  const started = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "start" } },
  );
  expect(started.ok()).toBeTruthy();
  const startBody = (await started.json()) as {
    authorizationUrl: string;
    state: string;
  };
  const authorizationUrl = new URL(startBody.authorizationUrl);
  expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
    "https://openapi.longbridge.com/oauth2/authorize",
  );
  expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
  expect(authorizationUrl.searchParams.get("client_id")).toBe(
    "browser-test-client",
  );
  expect(authorizationUrl.searchParams.get("scope")).toBe("6");
  expect(authorizationUrl.searchParams.get("state")).toBe(startBody.state);
  expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
    "S256",
  );
  expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );
  expect(authorizationUrl.searchParams.has("code_verifier")).toBeFalsy();

  for (const scenario of ["trade", "missing", "unknown", "extra", "duplicate"] as const) {
    const rejected = await request.post(
      "/test-doubles/longbridge/production-start",
      { data: { action: "finish", scenario } },
    );
    expect(rejected.status(), scenario).toBe(400);
    const body = await rejected.json();
    expect(body.error, scenario).toContain(
      scenario === "trade" ? "交易写权限" : "授权范围",
    );
    expect(body.assetRequests, scenario).toEqual([]);
    expect(JSON.stringify(body), scenario).not.toContain(SECRET_TOKEN);
  }

  const finished = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "finish", scenario: "readonly-combined" } },
  );
  expect(finished.ok()).toBeTruthy();
  const finishBody = await finished.json();
  expect(finishBody).toMatchObject({
    permissions: ["account", "positions"],
    account: {
      id: expect.stringMatching(/^longbridge:[a-f0-9]{12}$/),
      label: expect.stringMatching(/^长桥账户（类型 lb · USD · [a-f0-9]{12}）$/),
    },
    snapshot: {
      total: { amount: "123456.7891", currency: "USD" },
      holdings: [
        {
          symbol: "AAPL.US",
          marketValue: null,
          currency: "USD",
          costPrice: "190.1234",
          platformProfit: null,
        },
      ],
    },
    assetRequests: [
      "GET /v1/asset/account",
      "GET /v1/asset/stock",
      "GET /v1/asset/fund",
    ],
  });
  expect(finishBody.assetRequests).toEqual(
    expect.arrayContaining([
      "GET /v1/asset/account",
      "GET /v1/asset/stock",
      "GET /v1/asset/fund",
    ]),
  );
  expect(
    finishBody.assetRequests.every((entry: string) => entry.startsWith("GET ")),
  ).toBeTruthy();
  expect(JSON.stringify(finishBody)).not.toContain("mcp.longbridge.com");
  expect(JSON.stringify(finishBody)).not.toContain("/v1/trade/order");
  expect(JSON.stringify(finishBody)).not.toContain(SECRET_TOKEN);
  expect(JSON.stringify(finishBody)).not.toContain(PRODUCTION_ACCESS_TOKEN);
  expect(JSON.stringify(finishBody)).not.toContain(PRODUCTION_REFRESH_TOKEN);

  const sourceAudit = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "rest-source-audit" } },
  );
  expect(sourceAudit.ok()).toBeTruthy();
  await expect(sourceAudit.json()).resolves.toEqual({
    forbidden: [],
    hasMcpDependency: false,
    hasMcpEndpoint: false,
    hasSdkDependency: false,
    hasSdkReference: false,
  });

  const persistence = await request.post(
    "/test-doubles/longbridge/persistence",
  );
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    sourceSurvivesReopen: true,
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    rotatedSecretReadableAndEncrypted: true,
    failedWriteRolledBack: true,
    orphanRecovered: true,
    referencedPendingRecovered: true,
    rotatedBeforeDownstreamFailure: true,
    keychainReferencePersistsDirectly: true,
    keychainReferenceRefreshesAndReadsCandles: true,
    reauthorizationReplacesLegacySecretReference: true,
  });
});

test("锁定首页只显示登录入口，不含长桥账户、证券、金额或更新时间", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await confirmLongbridgeSourceAndOpenDetail(page);

  await page.goto("/");
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(
    page.getByRole("heading", { name: "看板已锁定" }),
  ).toBeVisible();
  const visitorResponses: string[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      url.origin === "http://localhost:3101" &&
      (response.request().resourceType() === "document" || url.pathname.startsWith("/api/"))
    ) {
      visitorResponses.push(await response.text().catch(() => ""));
    }
  });
  await page.reload();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);

  const html = await page.content();
  const serverHtml = await (await page.request.get("/")).text();
  await expect(page.getByText("最后更新：")).toHaveCount(0);
  for (const privateValue of [
    "U12345",
    "AAPL.US",
    "NVIDIA",
    "123456",
    SECRET_TOKEN,
  ]) {
    expect(html).not.toContain(privateValue);
    expect(serverHtml).not.toContain(privateValue);
    expect(visitorResponses.join("\n")).not.toContain(privateValue);
  }
  expect((await page.request.get("/api/asset-sources/longbridge/preview?id=guess")).status()).toBe(401);
});
