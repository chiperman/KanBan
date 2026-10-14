import { expect, test, type CDPSession, type Page } from "@playwright/test";

const API_KEY = "bit-browser-api-key";
const API_SECRET = "bit-browser-secret-must-not-leak";
const USER_ID = "605788";

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
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function configure(page: Page, scenario = "valid") {
  const response = await page.request.post("/test-doubles/bit", {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

async function startBitFlow(page: Page, assertFieldHelp = false) {
  await page.goto("/asset-sources/new");
  await expect(page).toHaveURL("/asset-sources/new");
  await page.getByRole("radio", { name: "BIT / Matrixport" }).click();
  if (assertFieldHelp) {
    await expect(
      page.getByText("理财权限由 Matrixport 强制绑定公网出口 IP。"),
    ).toBeVisible();
  }
  await page.getByLabel("BIT / Matrixport Access Key").fill(API_KEY);
  await page.getByLabel("BIT / Matrixport Secret Key").fill(API_SECRET);
  await page.getByLabel("BIT / Matrixport 用户 ID（个人中心 UID）").fill(USER_ID);
  await page.getByRole("button", { name: "验证只读凭证" }).click();
}

async function state(page: Page) {
  return (await (await page.request.get("/test-doubles/bit")).json()) as {
    savedSources: number;
    savedSecrets: number;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("BIT / Matrixport 以只读凭证保存 Wallet、Balance+ 与 DCP，且不泄露密钥", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  const responseBodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responseBodies.push(await response.text().catch(() => ""));
    }
  });

  await startBitFlow(page, true);
  await expect(
    page.getByRole("heading", { name: "校验与范围预览" }),
  ).toBeVisible();
  await expect(page.getByText("BIT / Matrixport", { exact: true })).toBeVisible();
  await expect(page.getByText("Wallet 余额、Balance+、DCP（只读）")).toBeVisible();
  await expect(page.getByText(API_SECRET)).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("交易");
  await expect(page.locator("main")).not.toContainText("提现");

  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", {
    name: /BIT \/ Matrixport 账户.*自动账户/,
  }).click();
  const card = page.getByTestId("bit-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("160.00 USD");
  await expect(card).toContainText("Wallet");
  await expect(card.getByTestId("bit-coverage-status")).toHaveCount(0);
  await expect(card.getByTestId("asset-holdings-detail")).toContainText(
    "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
  );
  const coverage = card.getByTestId("bit-product-coverage");
  await expect(coverage).toContainText("03 PRODUCTS");
  await expect(coverage).toBeVisible();
  await coverage.locator("summary").click();
  await expect(coverage).not.toContainText("Fixed Income");
  await expect(coverage).toContainText("Balance+");
  await expect(coverage).toContainText("DCP");
  await expect(coverage).toContainText("明细");
  expect(responseBodies.join("\n")).not.toContain(API_SECRET);
  expect(await state(page)).toEqual({ savedSources: 1, savedSecrets: 1 });
});

test("BIT / Matrixport 同步异常时来源详情明确标记失败", async ({ page }) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitFlow(page);
  await page.getByRole("button", { name: "确认并保存" }).click();
  await page.getByRole("link", {
    name: /BIT \/ Matrixport 账户.*自动账户/,
  }).click();
  const card = page.getByTestId("bit-card");
  await expect(card).toBeVisible();

  await configure(page, "refresh-failure");
  await page.getByRole("button", { name: /刷新 BIT \/ Matrixport/ }).click();
  await expect(page.getByTestId(/asset-source-refresh-status-/)).toContainText("刷新失败");
  await expect(card.locator(".source-live-state")).toHaveText("BIT / ERROR");
  await expect(card.getByTestId("asset-source-total")).toHaveText("160.00 USD");
});

test("DCP 订单列表失败时保留总额并退回仅汇总", async ({ page }) => {
  await configure(page, "dcp-orders-failure");
  await loginAsOwner(page);
  await startBitFlow(page);
  await page.getByRole("button", { name: "确认并保存" }).click();
  await page.getByRole("link", {
    name: /BIT \/ Matrixport 账户.*自动账户/,
  }).click();

  const card = page.getByTestId("bit-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("160.00 USD");
  await expect(card.getByTestId("bit-coverage-status")).toContainText(
    "当前总额完整 · 部分产品仅汇总",
  );
  await expect(card).not.toContainText("DCP #7125082312731329000");

  const coverage = card.getByTestId("bit-product-coverage");
  await coverage.locator("summary").click();
  await expect(coverage).toContainText("DCP");
  await expect(coverage).toContainText("仅汇总");
  await expect(coverage).toContainText("订单明细本次未读取；保留 USD 总头寸");
});

test("BIT / Matrixport 确认前账户变化或保存失败不会遗留来源与凭证", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitFlow(page);
  await configure(page, "identity-changed");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(
    page.locator(".asset-source-flow__notice[role=alert]"),
  ).toContainText("账户范围已变化");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });

  await configure(page, "commit-failure");
  await startBitFlow(page);
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(
    page.locator(".asset-source-flow__notice[role=alert]"),
  ).toContainText("原子事务写入失败");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 BIT 适配器读取 DCP 活跃订单明细但不重复计入总额", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/bit/production-start", {
    data: { action: "preview-valid" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(body.allowedPathsOnly).toBe(true);
  expect(body.requests).toEqual([
    "GET /mapi/v1/wallet/balance",
    "GET /flexible/api/v2/app/homepage?product_type=flexi_saving&subject_type=flexi_saving",
    "GET /dcp/api/v1/total-positions",
    "GET /dcp/api/v1/orders?status_category=1&order_sort_by=4&limit=100&offset=0",
  ]);
  expect(body.account).toEqual({
    id: "bit:605788",
    label: "BIT / Matrixport 账户 · UID 605788",
  });
  expect(body.snapshot.total).toEqual({ amount: "13760", currency: "USD" });
  expect(body.referencePriceRequests).toEqual(["bitcoin,tether"]);
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "wallet",
      sourceProduct: "wallet",
      symbol: "USDT",
      marketValue: "100",
    }),
    expect.objectContaining({
      sourceProduct: "balance-plus",
      marketValue: "30",
    }),
    expect.objectContaining({
      sourceProduct: "dcp",
      marketValue: "30",
    }),
    expect.objectContaining({
      symbol: "USDT",
      name: "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
      sourceAsset: "bit:dcp:order:7125082312731329000",
      sourceAccount: "earn",
      sourceProduct: "dcp",
      providerPositionId: "7125082312731329000",
      providerPositionState: "进行中",
      quantity: "30",
      currentPrice: null,
      marketValue: null,
      sourceMarketValue: null,
      valuation: {
        status: "quote-unavailable",
        reason: "BIT / Matrixport DCP 已含入 USD 总头寸，订单级当前估值未提供",
      },
    }),
    expect.objectContaining({
      symbol: "BTC",
      currentPrice: { amount: "68000", currency: "USD" },
      marketValue: "13600",
      valuation: expect.objectContaining({ status: "valued" }),
    }),
  ]));
  expect(body.snapshot.coverage.products).toContainEqual({
    product: "dcp",
    capability: "detailed",
    freshness: "current",
    message: "已读取 1 个活跃订单；总额仍以平台 USD 总头寸为准",
  });
  expect(JSON.stringify(body)).not.toContain(API_SECRET);

  const prices = await request.post("/test-doubles/bit/production-start", {
    data: { action: "refresh-prices" },
  });
  expect(prices.ok()).toBeTruthy();
  await expect(prices.json()).resolves.toMatchObject({
    requests: [],
    referencePriceRequests: ["bitcoin,tether"],
    refreshedSnapshot: {
      total: { amount: "13960", currency: "USD" },
      syncedAt: "2026-08-04T00:10:00.000Z",
      holdings: expect.arrayContaining([
        expect.objectContaining({
          symbol: "BTC",
          currentPrice: { amount: "69000", currency: "USD" },
          marketValue: "13800",
          valuation: expect.objectContaining({ status: "valued" }),
        }),
      ]),
    },
  });
});

test("生产 BIT 适配器在 DCP 订单列表失败时保留 USD 总头寸", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/bit/production-start", {
    data: { action: "preview-orders-failure" },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(body.allowedPathsOnly).toBe(true);
  expect(body.snapshot.total).toEqual({ amount: "13760", currency: "USD" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "bit:dcp:aggregate",
      sourceProduct: "dcp",
      marketValue: "30",
    }),
  ]));
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "bit:dcp:order:7125082312731329000",
    }),
  ]));
  expect(body.snapshot.coverage.products).toContainEqual({
    product: "dcp",
    capability: "aggregate-only",
    freshness: "current",
    message: expect.stringContaining("订单明细本次未读取；保留 USD 总头寸"),
  });
});
