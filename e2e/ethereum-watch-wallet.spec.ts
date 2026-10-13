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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function openEthereumAssetScope(page: Page): Promise<void> {
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  await page.getByRole("link", { name: "管理资产范围" }).click();
  await expect(page).toHaveURL(/\/asset-sources\/.+\/settings$/);
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "管理资产范围" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "返回来源详情" }),
  ).toHaveAttribute("href", /\/asset-sources\/[^/]+$/);
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
  await expect(card).not.toContainText("含 未估值 1 项资产");
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
  const overview = page.getByTestId("overview-confidence");
  await expect(overview).toContainText("总额完整");
  await expect(overview).not.toContainText("未估值");

  await openEthereumAssetScope(page);
  await page.getByRole("link", { name: "返回来源详情" }).click();
  await expect(page).toHaveURL(/\/asset-sources\/.+$/);
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
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
  await expect(page.getByTestId("overview-confidence")).toContainText(
    "未估值 1 项",
  );

  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-unknown-valued" },
  });
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const refreshedCard = page.getByTestId("ethereum-watch-card");
  await page.getByRole("button", { name: "刷新 Ethereum 观察钱包" }).click();
  await expect(
    page.getByTestId(/asset-source-refresh-status-/),
  ).toContainText("刷新完成");
  await expect(refreshedCard).toContainText("VALUATION / COMPLETE");
  await expect(refreshedCard).not.toContainText("待确认资产");
});

test("来源详情把 Lido 提现申请显示为带状态的 ETH 仓位", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "lido-withdrawal" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);

  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const card = page.getByTestId("ethereum-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("9,499.00 USD");
  const pending = card
    .getByTestId("holding-top-list")
    .locator('[data-holding-key*="lido-withdrawal:18"]');
  await expect(pending).toContainText("Lido 提现申请 #18");
  await expect(pending.locator(".asset-provider-position")).toHaveText("排队中");
  const claimable = card
    .getByTestId("asset-holdings-detail")
    .locator('[data-holding-key*="lido-withdrawal:27"]');
  await expect(claimable).toContainText("Lido 提现申请 #27");
  await expect(claimable.locator(".asset-provider-position")).toHaveText("可领取");
  await expect(card.getByTestId("asset-holdings-detail")).toContainText("1.5");
  await expect(card.getByTestId("asset-holdings-detail")).toContainText("0.49");
  await expect(card.getByTestId("asset-holdings-detail")).toContainText("3,000.00");
  await expect(card.getByTestId("evm-watch-ethereum-product-coverage")).toBeVisible();
  await card.getByTestId("evm-watch-ethereum-product-coverage").locator("summary").click();
  await expect(card.getByTestId("evm-watch-ethereum-product-coverage")).toContainText(
    "已读取 2 笔未领取申请",
  );
  await expect(card.getByTestId("evm-unreadable-assets")).toHaveCount(0);
});

test("来源详情把 Lista slisBNB 提现申请显示为带状态的 BNB 仓位", async ({ page }) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "lista-slisbnb-withdrawal" },
  });
  await loginAsOwner(page);
  await connectEthereum(page, true);

  await page.getByRole("link", { name: /BNB Smart Chain 观察钱包.*观察钱包/ }).click();
  const card = page.getByTestId("bsc-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("5,449.00 USD");
  const locked = card
    .getByTestId("holding-top-list")
    .locator('[data-holding-key*="lista-slisbnb-withdrawal:101"]');
  await expect(locked).toContainText("Lista slisBNB 提现申请 #101");
  await expect(locked.locator(".asset-provider-position")).toContainText(
    "锁仓中",
  );
  await expect(locked.locator(".asset-provider-position")).toContainText(
    "最早预计可领取 2026-08-27",
  );
  const claimable = card
    .getByTestId("asset-holdings-detail")
    .locator('[data-holding-key*="lista-slisbnb-withdrawal:102"]');
  await expect(claimable).toContainText("Lista slisBNB 提现申请 #102");
  await expect(claimable.locator(".asset-provider-position")).toHaveText("可领取");
  await expect(card.getByTestId("asset-holdings-detail")).toContainText("slisBNB");
  await expect(card).toContainText("Lista slisBNB 提现申请");
  await card.getByTestId("evm-watch-bsc-product-coverage").locator("summary").click();
  await expect(card.getByTestId("evm-watch-bsc-product-coverage")).toContainText(
    "已读取 2 笔未领取申请",
  );
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
  await page.getByLabel("待确认资产")
    .getByRole("button", { name: "忽略" })
    .click();

  await expect(page.getByTestId("evm-token-preference-settings")).toContainText(
    "已忽略资产",
  );
  await page.goto("/");
  await expect(page.getByTestId("overview-confidence")).toContainText("总额完整");
  await expect(page.getByTestId("overview-confidence")).not.toContainText("未估值 1 项");

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
    .getByRole("button", { name: "恢复显示" })
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

test("钱包设置页可忽略已估值 ERC-20 和经确认的原生币", async ({
  page,
}) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);

  await openEthereumAssetScope(page);
  const recognized = page.getByTestId("recognized-evm-assets");
  await expect(recognized).toContainText("SAME");
  await expect(recognized).toContainText("原生币");

  await recognized
    .locator('[data-asset-key="evm:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]')
    .getByRole("button", { name: "忽略" })
    .click();
  const ignored = page.getByTestId("evm-token-preference-settings");
  await expect(ignored).toContainText("已忽略资产");

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  const tokenIgnoredCard = page.getByTestId("ethereum-watch-card");
  await expect(tokenIgnoredCard.getByTestId("asset-source-total")).toHaveText(
    "5,019.00 USD",
  );

  await openEthereumAssetScope(page);
  const restored = page.waitForEvent("load");
  await page
    .getByTestId("evm-token-preference-settings")
    .locator('[data-asset-key="evm:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]')
    .getByRole("button", { name: "恢复显示" })
    .click();
  await restored;

  await page.getByTestId("recognized-evm-assets")
    .locator('[data-asset-key="evm:1:native"]')
    .getByRole("button", { name: "忽略" })
    .click();
  const nativeDialog = page.getByRole("dialog", { name: "确认忽略 ETH" });
  await expect(nativeDialog).toContainText("不影响链上资产");
  const nativeIgnored = page.waitForEvent("load");
  await nativeDialog.getByRole("button", { name: "仍要忽略" }).click();
  await nativeIgnored;

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  await expect(page.getByTestId("ethereum-watch-card").getByTestId("asset-source-total")).toHaveText(
    "519.00 USD",
  );
});

test("钱包设置页可取消关注已确认的 EVM 资产并恢复待确认", async ({
  page,
}) => {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);

  await openEthereumAssetScope(page);
  const scopeSettings = page.getByTestId("evm-token-preference-settings");
  await scopeSettings.getByRole("button", { name: "需要关注" }).click();

  await expect(scopeSettings).toContainText("已关注资产");
  await scopeSettings.getByRole("button", { name: "取消关注" }).click();
  await expect(scopeSettings).toContainText("待确认资产");
});
