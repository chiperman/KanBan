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
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function configure(page: Page, scenario = "valid") {
  const response = await page.request.post("/test-doubles/bit", {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

async function startBitFlow(page: Page, assertFieldHelp = false) {
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: "添加资产来源" }).click();
  }
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
  const preview = page.getByRole("dialog", {
    name: "确认 BIT / Matrixport 资产来源",
  });
  await expect(preview).toContainText("BIT / Matrixport 账户 · UID 605788");
  await expect(preview).toContainText("Wallet 余额、Balance+、DCP（只读）");
  await expect(page.getByText(API_SECRET)).toHaveCount(0);
  await expect(preview).not.toContainText("交易");
  await expect(preview).not.toContainText("提现");

  await preview.getByRole("button", { name: "确认并保存" }).click();
  const card = page.getByTestId("bit-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("160.00 USD");
  await expect(card).toContainText("Wallet");
  await expect(card.getByTestId("bit-coverage-status")).toContainText(
    "当前总额完整 · 部分产品仅汇总",
  );
  const coverage = card.getByTestId("bit-product-coverage");
  await expect(coverage).toContainText("03 PRODUCTS");
  const currentTarget = page.getByTestId("card-index").getByRole("button", {
    name: "定位 BIT / Matrixport 资产",
  });
  await expect(currentTarget).not.toHaveAttribute("data-source-state", "error");
  const resizeHandle = page.getByRole("button", {
    name: /调整\s*BIT \/ Matrixport 资产宽度/,
  });
  await resizeHandle.press("ArrowRight");
  await expect(coverage).toBeVisible();
  await coverage.locator("summary").click();
  await expect(coverage).not.toContainText("Fixed Income");
  await expect(coverage).toContainText("Balance+");
  await expect(coverage).toContainText("DCP");
  expect(responseBodies.join("\n")).not.toContain(API_SECRET);
  expect(await state(page)).toEqual({ savedSources: 1, savedSecrets: 1 });
});

test("BIT / Matrixport 同步异常时顶部导航标红", async ({ page }) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitFlow(page);
  await page.getByRole("dialog", {
    name: "确认 BIT / Matrixport 资产来源",
  }).getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByTestId("bit-card")).toBeVisible();

  await configure(page, "refresh-failure");
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("bit-card")).toContainText("BIT 同步失败");

  const target = page.getByTestId("card-index").getByRole("button", {
    name: "定位 BIT / Matrixport 资产（数据异常）",
  });
  await expect(target).toHaveAttribute("data-source-state", "error");
  await expect(target).toHaveCSS(
    "color",
    /rgb\((255, 82, 71|210, 59, 48)\)/,
  );
});

test("BIT / Matrixport 确认前账户变化或保存失败不会遗留来源与凭证", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitFlow(page);
  const preview = page.getByRole("dialog", {
    name: "确认 BIT / Matrixport 资产来源",
  });
  await configure(page, "identity-changed");
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("账户范围已变化");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });

  await preview.getByRole("button", { name: "取消" }).click();
  await configure(page, "commit-failure");
  await startBitFlow(page);
  const failed = page.getByRole("dialog", {
    name: "确认 BIT / Matrixport 资产来源",
  });
  await failed.getByRole("button", { name: "确认并保存" }).click();
  await expect(failed.getByRole("alert")).toContainText("原子事务写入失败");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 BIT 适配器只调用三条 GET 白名单并使用 Matrixport V2 签名", async ({
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
      symbol: "BTC",
      currentPrice: { amount: "68000", currency: "USD" },
      marketValue: "13600",
      valuation: expect.objectContaining({ status: "valued" }),
    }),
  ]));
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
