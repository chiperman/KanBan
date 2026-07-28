import { expect, test, type CDPSession, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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

async function addEvmSource(
  page: Page,
  chain: "ethereum" | "bsc",
  address = ADDRESS,
): Promise<void> {
  await page.getByRole("button", { name: "添加资产来源" }).click();
  const label = chain === "ethereum" ? "Ethereum 观察钱包" : "BNB Smart Chain 观察钱包";
  await page.getByRole("radio", { name: label }).check();
  await page
    .getByLabel(`${chain === "ethereum" ? "Ethereum" : "BNB Smart Chain"} 公开地址（每行一个）`)
    .fill(address);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: `确认 ${label}` })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.getByTestId(chain === "ethereum" ? "ethereum-watch-card" : "bsc-watch-card"))
    .toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("生产 Ethereum 适配器读取 ETH 与 ERC-20 分页，按合约区分同名代币并使用 CoinGecko", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.account.label).toBe("Ethereum 观察钱包 · 2 个地址");
  expect(body.permissions).toEqual(["public-address", "market-data", "positions"]);
  expect(body.snapshot.total).toEqual({ amount: "5519", currency: "USD" });
  expect(body.snapshot.holdings.map((holding: { sourceAsset: string }) => holding.sourceAsset))
    .toEqual(expect.arrayContaining([
      "evm:1:native",
      "evm:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "evm:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]));
  expect(body.snapshot.holdings.filter((holding: { symbol: string }) => holding.symbol === "SAME"))
    .toHaveLength(2);
  expect(body.snapshot.holdings.find((holding: { symbol: string }) => holding.symbol === "UNKNOWN"))
    .toMatchObject({ marketValue: null, valuation: { status: "unvalued" } });
  expect(body.rpcMethods).toEqual([
    "eth_chainId",
    "eth_getBalance",
    "alchemy_getTokenBalances",
    "alchemy_getTokenBalances",
    "eth_getBalance",
    "alchemy_getTokenBalances",
    "alchemy_getTokenMetadata",
    "alchemy_getTokenMetadata",
    "alchemy_getTokenMetadata",
  ]);
  expect(body.rpcMethods.join("\n")).not.toMatch(/send|sign|transaction|nft|transfer/i);
  expect(body.priceRequests).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain("server-secret-test-key");
});

test("共享 EVM 适配器用 chain ID 56 独立映射 BNB 与 BEP-20", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview", chain: "bsc" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.account.label).toBe("BNB Smart Chain 观察钱包 · 2 个地址");
  expect(body.snapshot.total).toEqual({ amount: "2019", currency: "USD" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ symbol: "BNB", sourceAsset: "evm:56:native" }),
    expect.objectContaining({
      symbol: "SAME",
      name: "SAME · BNB Smart Chain BEP-20",
      sourceAsset: "evm:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
  ]));
  expect(body.priceRequests.join("\n")).toContain("/networks/bsc/token_price/");
  expect(JSON.stringify(body)).not.toContain("server-secret-test-key");
});

test("统一来源流程可独立保存 BNB Smart Chain 公开地址", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "BNB Smart Chain 观察钱包" }).check();
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await expect(dialog.getByText(/助记词|私钥|MPC|WalletConnect|连接钱包|签名/)).toHaveCount(0);
  await page.getByLabel("BNB Smart Chain 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  const preview = page.getByRole("dialog", { name: "确认 BNB Smart Chain 观察钱包" });
  await expect(preview).toContainText("BNB、BEP-20（公开地址只读）");
  await expect(preview).toContainText("2,019.00 USD");
  await preview.getByRole("button", { name: "确认并保存" }).click();
  const card = page.getByTestId("bsc-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("2,019.00 USD");
  await expect(card).toContainText("BNB Smart Chain");
});

test("公开地址验证与保存保持原子，失败不留下来源或服务端配置", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid", commitError: "EVM 原子保存失败" },
  });
  await loginAsOwner(page);
  const invalid = await page.request.post("/api/asset-sources/evm/preview", {
    data: { chain: "ethereum", addresses: ["not-an-address"] },
  });
  expect(invalid.status()).toBe(400);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Ethereum 观察钱包" }).check();
  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: "确认 Ethereum 观察钱包" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.locator(".login-error[role=alert]")).toContainText("EVM 原子保存失败");
  const state = await page.request.get("/test-doubles/ethereum");
  await expect(state.json()).resolves.toMatchObject({ savedSources: 0, savedSecrets: 0 });
});

test("Ethereum 余额失败只使该来源过期，BSC 继续当前且未认证状态收不到地址与资产", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await addEvmSource(page, "ethereum");
  await addEvmSource(page, "bsc");
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-ethereum-failure" },
  });
  const refreshed = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "holdings" },
  });
  await expect(refreshed.json()).resolves.toEqual({ successCount: 1, failureCount: 1 });
  await page.reload();
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("过期数据");
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("Ethereum 同步失败");
  await expect(page.getByTestId("bsc-watch-card")).toContainText("数据当前");
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-ethereum-price-failure" },
  });
  const failedPrices = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "prices" },
  });
  await expect(failedPrices.json()).resolves.toEqual({ successCount: 1, failureCount: 1 });
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-passthrough" },
  });
  const prices = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "prices" },
  });
  await expect(prices.json()).resolves.toEqual({ successCount: 2, failureCount: 0 });
  await page.reload();
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("过期数据");
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("Ethereum 同步失败");
  await expect(page.getByTestId("bsc-watch-card")).toContainText("数据当前");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.reload();
  const publicSurface = await page.content();
  for (const sensitive of [ADDRESS.toLowerCase(), "SAME", "5,519", "2,019"]) {
    expect(publicSurface.toLowerCase()).not.toContain(sensitive.toLowerCase());
  }
});

test("Ethereum 空钱包为零资产，RPC 部分失败不会提交不完整结果", async ({ request }) => {
  const empty = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "empty" },
  });
  expect(empty.ok()).toBeTruthy();
  await expect(empty.json()).resolves.toMatchObject({
    snapshot: { total: { amount: "0", currency: "USD" }, holdings: [] },
  });

  const failed = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "partial-failure" },
  });
  expect(failed.status()).toBe(400);
  await expect(failed.json()).resolves.toMatchObject({
    error: expect.stringContaining("sample RPC failure"),
  });

  for (const action of ["index-failure", "price-failure"] as const) {
    const response = await request.post("/test-doubles/ethereum/production-start", {
      data: { action },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain(action === "index-failure" ? "sample index failure" : "HTTP 429");
    expect(body.snapshot).toBeUndefined();
  }
});

test("Ethereum 30 秒价格刷新不读取链上余额，5 分钟持仓刷新恢复完整读取", async ({ request }) => {
  const prices = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "refresh-prices" },
  });
  expect(prices.ok()).toBeTruthy();
  await expect(prices.json()).resolves.toMatchObject({
    snapshot: { total: { amount: "5519", currency: "USD" } },
    rpcMethods: [],
    priceRequests: expect.arrayContaining([
      expect.stringContaining("/api/v3/simple/price"),
      expect.stringContaining("/api/v3/onchain/simple/networks/eth/token_price/"),
    ]),
  });

  const holdings = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "refresh-holdings" },
  });
  expect(holdings.ok()).toBeTruthy();
  const body = await holdings.json();
  expect(body.rpcMethods).toContain("eth_getBalance");
  expect(body.rpcMethods).toContain("alchemy_getTokenBalances");
  expect(body.snapshot.total).toEqual({ amount: "5519", currency: "USD" });
});
