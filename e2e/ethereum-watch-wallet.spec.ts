import { expect, test, type CDPSession, type Page } from "@playwright/test";

const ADDRESS_ONE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ADDRESS_TWO = "0x1111111111111111111111111111111111111111";

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

async function openEthereumAssetScope(page: Page): Promise<void> {
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  await page.goto(`${page.url()}/settings`);
  await expect(page).toHaveURL(/\/asset-sources\/.+\/settings$/);
}

async function connectEthereum(page: Page, includeBsc = false): Promise<void> {
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  if (!includeBsc) {
    await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  }
  await page.getByLabel("EVM 公开地址（每行一个）").fill(
    includeBsc ? `${ADDRESS_ONE}\n${ADDRESS_TWO}` : ADDRESS_ONE,
  );
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("EVM 观察钱包只输入一次公开地址，默认预览并保存两条链", async ({
  page,
}) => {
  const configured = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(page.getByLabel(/Secret|Passphrase|助记词|私钥/)).toHaveCount(0);
  await page.getByLabel("EVM 公开地址（每行一个）").fill(
    `${ADDRESS_ONE}\n${ADDRESS_TWO}`,
  );
  await page.getByRole("button", { name: "验证公开地址" }).click();

  await expect(
    page.getByRole("region", { name: "校验与范围预览" }),
  ).toBeVisible();
  await expect(page.getByText("Ethereum 观察钱包")).toBeVisible();
  await expect(page.getByText("BNB Smart Chain 观察钱包")).toBeVisible();
  await expect(page.getByText("ETH、ERC-20（公开地址只读）")).toBeVisible();
  await expect(page.getByText("BNB、BEP-20（公开地址只读）")).toBeVisible();
  await expect(page.getByText("5,519.00 USD")).toBeVisible();
  await expect(page.getByText("2,019.00 USD")).toBeVisible();
  await page.getByRole("button", { name: "确认并保存" }).click();

  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const card = page.getByTestId("ethereum-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("5,519.00 USD");
  await expect(card).not.toContainText("待确认资产");
  await expect(card).not.toContainText("含 1 项未估值资产");
  await page.goto("/asset-sources");
  await expect(
    page.getByRole("link", { name: /BNB Smart Chain 观察钱包.*观察钱包/ }),
  ).toBeVisible();
});

test("待确认 EVM 资产在对应钱包的设置页中管理", async ({
  page,
}) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);

  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const card = page.getByTestId("ethereum-watch-card");
  await expect(card.getByTestId("holding-top-list")).not.toContainText("UNKNOWN");
  await expect(card.getByTestId("asset-holdings-detail")).not.toContainText("UNKNOWN");
  await expect(card).not.toContainText("待确认资产");
  await page.goto("/");
  const overview = page.getByTestId("total-asset-overview");
  await expect(overview).toContainText("当前估值：不完整 · 1 项未估值");

  await openEthereumAssetScope(page);
  const scopeSettings = page.getByTestId("evm-token-preference-settings");
  await expect(scopeSettings).toContainText("待确认资产");
  await expect(scopeSettings).toContainText("0xcccccccccccccccccccccccccccccccccccccccc");
  await scopeSettings.getByRole("button", { name: "需要关注" }).click();

  await expect(page.getByTestId("evm-token-preference-settings")).not.toContainText(
    "待确认资产",
  );
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const focusedCard = page.getByTestId("ethereum-watch-card");
  await expect(focusedCard.getByTestId("holding-top-list")).toContainText("UNKNOWN");
  await expect(focusedCard.getByTestId("asset-holdings-detail")).toContainText("UNKNOWN");
  await expect(focusedCard).not.toContainText("已保留");
  await expect(focusedCard).not.toContainText("待确认资产");
  await page.goto("/");
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "当前估值：不完整 · 1 项未估值",
  );

  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-unknown-valued" },
  });
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const refreshedCard = page.getByTestId("ethereum-watch-card");
  await refreshedCard.getByRole("button", { name: "刷新 Ethereum 观察钱包" }).click();
  await expect(
    refreshedCard.getByTestId(/asset-source-refresh-status-/),
  ).toContainText("刷新完成");
  await expect(refreshedCard).toContainText("VALUATION / COMPLETE");
  await expect(refreshedCard).not.toContainText("待确认资产");
});

test("钱包设置页可按合约忽略和恢复待确认 EVM 资产", async ({
  page,
}) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);

  await openEthereumAssetScope(page);
  const scopeUrl = await page.url();
  await page
    .getByTestId("evm-token-preference-settings")
    .getByRole("button", { name: "忽略" })
    .click();

  await expect(page.getByTestId("evm-token-preference-settings")).toContainText(
    "已忽略代币",
  );
  await page.goto("/");
  await expect(page.getByTestId("total-asset-overview")).toContainText("当前估值：完整");
  await expect(page.getByTestId("total-asset-overview")).not.toContainText("1 项未估值");

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const updatedCard = page.getByTestId("ethereum-watch-card");
  await expect(updatedCard).not.toContainText("已忽略");
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-unknown-valued" },
  });
  await updatedCard.getByRole("button", { name: "刷新 Ethereum 观察钱包" }).click();
  await expect(
    updatedCard.getByTestId(/asset-source-refresh-status-/),
  ).toContainText("刷新完成");

  await page.goto(scopeUrl);
  const restored = page.waitForEvent("load");
  await page
    .getByTestId("evm-token-preference-settings")
    .getByRole("button", { name: "恢复到待确认" })
    .click();
  await restored;

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();

  await expect(page.getByTestId("ethereum-watch-card")).not.toContainText(
    "已忽略 1 个代币",
  );
  await expect(page.getByTestId("ethereum-watch-card").getByTestId(
    "holding-top-list",
  )).toContainText("UNKNOWN");
});
