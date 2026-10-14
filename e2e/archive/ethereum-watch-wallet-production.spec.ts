import {
  expect,
  test,
  type Page,
} from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LIDO_WITHDRAWAL_QUEUE = "0x889edc2edab5f40e902b864ad4d7ade8e412f9b1";
const LISTA_STAKE_MANAGER = "0x1adb950d8bb3da4be104211d5ab038628e477fe6";

async function addEvmSource(
  page: Page,
  chain: "ethereum" | "bsc",
  address = ADDRESS,
): Promise<void> {
  await page.goto("/asset-sources/new");
  await expect(page).toHaveURL("/asset-sources/new");
  const label = chain === "ethereum" ? "Ethereum 观察钱包" : "BNB Smart Chain 观察钱包";
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await page
    .getByRole("checkbox", {
      name: chain === "ethereum" ? "BNB Smart Chain 观察钱包" : "Ethereum 观察钱包",
    })
    .uncheck();
  await page
    .getByLabel("EVM 公开地址（每行一个）")
    .fill(address);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", { name: new RegExp(`${label}.*观察钱包`) }).click();
  await expect(page.getByTestId(
    chain === "ethereum" ? "ethereum-watch-card" : "bsc-watch-card",
  )).toBeVisible();
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
  expect(body.rpcMethods).toEqual(expect.arrayContaining([
    "eth_chainId",
    "eth_getBalance",
    "alchemy_getTokenBalances",
    "alchemy_getTokenMetadata",
  ]));
  expect(body.rpcMethods.join("\n")).not.toMatch(/send|sign|transaction|nft|transfer/i);
  expect(body.priceRequests).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain("server-secret-test-key");
});

test("生产 Ethereum 适配器把 Lido 提现申请作为独立 ETH 仓位读取，且不按 ERC-20 元数据处理", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview-lido-withdrawal" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.total).toEqual({ amount: "9499", currency: "USD" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      symbol: "ETH",
      sourceProduct: "lido-withdrawal-request",
      providerPositionId: "18",
      providerPositionState: "排队中",
      quantity: "1.5",
      marketValue: "3000",
    }),
    expect.objectContaining({
      symbol: "ETH",
      sourceProduct: "lido-withdrawal-request",
      providerPositionId: "27",
      providerPositionState: "可领取",
      quantity: "0.49",
      marketValue: "980",
    }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "complete",
    products: [{
      product: "lido-withdrawal-request",
      capability: "detailed",
      freshness: "current",
    }],
  });
  expect(body.rpcMethods).toContain("eth_call");
  expect(body.metadataContracts).not.toContain(LIDO_WITHDRAWAL_QUEUE);
  expect(body.rpcMethods.join("\n")).not.toMatch(/send|sign|transaction|nft|transfer/i);
});

test("Lido 提现申请读取失败时保留其他钱包资产，并明确保留该合约为未估值", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview-lido-failure" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.total).toEqual({ amount: "5519", currency: "USD" });
  expect(body.snapshot.coverage).toMatchObject({
    status: "partial",
    products: [{
      product: "lido-withdrawal-request",
      capability: "unknown",
      freshness: "current",
    }],
  });
  expect(body.snapshot.unrecognizedEvmTokens).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: `evm:1:${LIDO_WITHDRAWAL_QUEUE}`,
      symbol: "unstETH",
      reason: expect.stringContaining("Lido 提现申请读取失败"),
    }),
  ]));
});

test("Lido 提现申请在价格刷新中保留仓位身份，只重新读取 ETH 参考价", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "refresh-lido-prices" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceProduct: "lido-withdrawal-request",
      providerPositionId: "18",
      marketValue: "3000",
    }),
    expect.objectContaining({
      sourceProduct: "lido-withdrawal-request",
      providerPositionId: "27",
      marketValue: "980",
    }),
  ]));
  expect(body.rpcMethods).toEqual([]);
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

test("生产 BSC 适配器把 Lista slisBNB 提现申请作为独立 BNB 仓位读取，并保留剩余 slisBNB", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview-lista-withdrawal", chain: "bsc" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "evm:56:lista-slisbnb-withdrawal:101",
      symbol: "BNB",
      sourceProduct: "lista-slisbnb-withdrawal-request",
      providerPositionId: "101",
      providerPositionState: "锁仓中",
      positionState: "redeeming",
      quantity: "1.2",
      marketValue: "720",
    }),
    expect.objectContaining({
      sourceAsset: "evm:56:lista-slisbnb-withdrawal:102",
      providerPositionState: "可领取",
      quantity: "2.45",
      marketValue: "1470",
    }),
    expect.objectContaining({
      sourceAsset: "evm:56:lista-slisbnb-withdrawal:201",
      providerPositionState: "锁仓中",
      quantity: "0.7",
      marketValue: "420",
    }),
    expect.objectContaining({
      sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
      symbol: "slisBNB",
      quantity: "2",
    }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "complete",
    products: [{
      product: "lista-slisbnb-withdrawal-request",
      capability: "detailed",
      freshness: "current",
    }],
  });
  expect(body.rpcMethods).toContain("eth_call");
  expect(body.metadataContracts).toContain("0xdddddddddddddddddddddddddddddddddddddddd");
  expect(body.metadataContracts).not.toContain(LISTA_STAKE_MANAGER);
  expect(body.rpcMethods.join("\n")).not.toMatch(/send|sign|transaction|nft|transfer/i);
});

test("BSC Lista 适配器明确覆盖空申请，读取失败时保留普通资产并标记部分覆盖", async ({ request }) => {
  const empty = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview-lista-empty", chain: "bsc" },
  });
  expect(empty.ok()).toBeTruthy();
  const emptyBody = await empty.json();
  expect(emptyBody).toMatchObject({
    snapshot: {
      coverage: {
        status: "complete",
        products: [],
      },
    },
  });
  expect(emptyBody.rpcMethods).toContain("eth_call");
  expect(emptyBody.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceAsset: "evm:56:native", symbol: "BNB" }),
    expect.objectContaining({
      sourceAsset: "evm:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "SAME",
    }),
    expect.objectContaining({
      sourceAsset: "evm:56:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "SAME",
    }),
  ]));
  expect(emptyBody.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceProduct: "lista-slisbnb-withdrawal-request" }),
  ]));

  const failed = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "preview-lista-failure", chain: "bsc" },
  });
  expect(failed.ok()).toBeTruthy();
  const body = await failed.json();
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceAsset: "evm:56:native", symbol: "BNB" }),
    expect.objectContaining({
      sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
      symbol: "slisBNB",
    }),
  ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "partial",
    products: [{
      product: "lista-slisbnb-withdrawal-request",
      capability: "unknown",
      freshness: "current",
      message: expect.stringContaining("Lista slisBNB 提现申请读取失败"),
    }],
  });
});

test("BSC Lista 完整持仓刷新重新读取提现申请", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "refresh-lista-holdings", chain: "bsc" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceProduct: "lista-slisbnb-withdrawal-request",
      providerPositionId: "101",
    }),
  ]));
  expect(body.rpcMethods).toEqual(expect.arrayContaining([
    "eth_getBalance",
    "alchemy_getTokenBalances",
    "eth_call",
  ]));
});

test("加密持仓在现价区域显示 24h 而不伪造证券交易时段", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await addEvmSource(page, "ethereum");

  const card = page.getByTestId("ethereum-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("5,519.00 USD");

  const ethRow = card
    .getByTestId("asset-holdings-detail")
    .locator("tbody tr")
    .first();
  await expect(ethRow).toContainText("Ethereum");
  await expect(ethRow).toContainText("ETH");
  const ethPrice = ethRow.locator(".holding-current-price-cell");
  await expect(ethPrice).toContainText("24h · 行情 2026-01-01 08:00");
  await expect(ethPrice).not.toContainText(/常规盘|盘前|盘后|夜盘/);
});

test("统一来源流程可独立保存 BNB Smart Chain 公开地址", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await page.getByRole("checkbox", { name: "Ethereum 观察钱包" }).uncheck();
  await expect(page.getByLabel(/Secret|Passphrase|助记词|私钥/)).toHaveCount(0);
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await expect(page.getByText("BNB、BEP-20（公开地址只读）")).toBeVisible();
  await expect(page.getByText("2,019.00 USD")).toBeVisible();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await page.getByRole("link", { name: /BNB Smart Chain 观察钱包.*观察钱包/ }).click();
  const card = page.getByTestId("bsc-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("2,019.00 USD");
  await expect(card).toContainText("BNB Smart Chain");
});

test("确认保存 EVM 公开地址时显示进行中状态", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", { data: { scenario: "valid" } });
  await loginAsOwner(page);
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();

  let releaseConfirm: (() => void) | undefined;
  let confirmStarted!: () => void;
  const confirmPending = new Promise<void>((resolve) => {
    confirmStarted = resolve;
  });
  await page.route("**/api/asset-sources/evm/confirm", async (route) => {
    confirmStarted();
    await new Promise<void>((resolve) => {
      releaseConfirm = resolve;
    });
    await route.continue();
  });

  const confirmButton = page.getByRole("button", {
    name: /确认并保存|正在保存…/,
  });
  await confirmButton.click();
  await confirmPending;

  await expect(confirmButton).toBeDisabled();
  await expect(confirmButton).toHaveAttribute("aria-busy", "true");
  await expect(confirmButton).toContainText("正在保存…");

  releaseConfirm?.();
  await expect(page).toHaveURL("/asset-sources");
  await expect(
    page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }),
  ).toBeVisible();
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
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(
    page.locator(".asset-source-flow__notice[role=alert]"),
  ).toContainText("EVM 原子保存失败");
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
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const ethereumCard = page.getByTestId("ethereum-watch-card");
  await expect(ethereumCard.locator(".source-live-state")).toHaveText("ETH / ERROR");
  await expect(ethereumCard.getByTestId("asset-source-total")).toHaveText("5,519.00 USD");
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /BNB Smart Chain 观察钱包.*观察钱包/ }).click();
  await expect(page.getByTestId("bsc-watch-card").locator(".source-live-state")).toHaveText("BSC / CURRENT");
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
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  await expect(page.getByTestId("ethereum-watch-card").locator(".source-live-state")).toHaveText("ETH / ERROR");
  await expect(page.getByTestId("ethereum-watch-card").getByTestId("asset-source-total")).toHaveText("5,519.00 USD");
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /BNB Smart Chain 观察钱包.*观察钱包/ }).click();
  await expect(page.getByTestId("bsc-watch-card").locator(".source-live-state")).toHaveText("BSC / CURRENT");
  await page.goto("/");
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(page.getByRole("heading", { name: "看板已锁定" })).toBeVisible();
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

test("CoinGecko 网络瞬断不阻断 EVM 公开地址预览", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "price-network-failure" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "0", currency: "USD" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      symbol: "ETH",
      marketValue: null,
      valuation: expect.objectContaining({ status: "unvalued" }),
    }),
  ]));
});

test("Alchemy RPC 单次网络瞬断会重试并继续预览", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "rpc-network-once" },
  });
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({
    snapshot: { total: { amount: "5519", currency: "USD" } },
  });
});

test("单个 ERC-20 合约无法读取 decimals 时仍返回待确认资产", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "metadata-decimals-failure" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "5519", currency: "USD" });
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "evm:1:0xcccccccccccccccccccccccccccccccccccccccc",
    }),
  ]));
  expect(body.snapshot.unrecognizedEvmTokens).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "evm:1:0xcccccccccccccccccccccccccccccccccccccccc",
      symbol: "WstETH",
      name: "Lido: stETH Withdrawal NFT",
      quantity: null,
    }),
  ]));
});

test("代币元数据 RPC 故障仍使整条 Ethereum 读取失败", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "metadata-rpc-failure" },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringContaining("metadata temporary failure"),
  });
});

test("已忽略的异常合约在完整刷新时不再读取元数据", async ({ request }) => {
  const response = await request.post("/test-doubles/ethereum/production-start", {
    data: { action: "refresh-ignored-unreadable" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.unrecognizedEvmTokens).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "evm:1:0xcccccccccccccccccccccccccccccccccccccccc",
      quantity: null,
    }),
  ]));
  expect(body.metadataContracts).not.toContain(
    "0xcccccccccccccccccccccccccccccccccccccccc",
  );
  // 普通钱包没有协议覆盖字段；忽略异常合约后仍保留已估值资产总额。
  expect(body.snapshot.total).toEqual({ amount: "5519", currency: "USD" });
});

test("Ethereum 行情刷新不读取链上余额，完整刷新恢复读取持仓", async ({ request }) => {
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
