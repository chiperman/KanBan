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

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("Ethereum 观察钱包只用公开地址预览并保存，按链与合约区分同名代币", async ({
  page,
}) => {
  const configured = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Ethereum 观察钱包" }).check();
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await expect(dialog.getByText(/助记词|私钥|MPC|WalletConnect|连接钱包|签名/)).toHaveCount(0);
  await expect(dialog.getByLabel(/Secret|Passphrase|助记词|私钥/)).toHaveCount(0);
  await page
    .getByLabel("Ethereum 公开地址（每行一个）")
    .fill(`${ADDRESS_ONE}\n${ADDRESS_TWO}`);
  await page.getByRole("button", { name: "验证公开地址" }).click();

  const preview = page.getByRole("dialog", { name: "确认 Ethereum 观察钱包" });
  await expect(preview).toContainText("Ethereum 观察钱包 · 2 个地址");
  await expect(preview).toContainText("ETH、ERC-20（公开地址只读）");
  await expect(preview).toContainText("5,519 USD");
  await preview.getByRole("button", { name: "确认并保存" }).click();

  const card = page.getByTestId("ethereum-watch-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText("5,519 USD");
  await expect(card).toContainText("含 1 项未估值资产");
});
