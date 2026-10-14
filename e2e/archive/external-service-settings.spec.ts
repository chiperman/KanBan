import { expect, test, type CDPSession, type Page } from "@playwright/test";

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

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("外部服务只在设置与安全中加密配置，EVM 来源仅提示依赖", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "设置与安全", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const statuses = page.getByTestId("external-service-statuses");
  await expect(statuses).toContainText("未配置");
  await page.getByLabel("CoinGecko Demo API Key").fill("demo-test-key");
  await page.getByLabel("Ethereum RPC URL").fill("https://ethereum.example/rpc");
  await page.getByLabel("BNB Smart Chain RPC URL").fill("https://bsc.example/rpc");
  await page.getByRole("button", { name: "保存并验证", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("已保存并验证。");
  await expect(statuses).toContainText("已验证");
  const response = await page.request.get("/api/external-services");
  const body = await response.json();
  expect(body).toEqual(expect.objectContaining({
    coinGecko: expect.objectContaining({ configured: true }),
    ethereumRpc: expect.objectContaining({ configured: true }),
    bscRpc: expect.objectContaining({ configured: true }),
  }));
  expect(JSON.stringify(body)).not.toContain("demo-test-key");

  await page.goto("/asset-sources/new");
  const statusRead = page.waitForResponse((response) =>
    response.url().endsWith("/api/external-services") &&
    response.request().method() === "GET",
  );
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await statusRead;
  await expect(page.getByText("EVM 钱包依赖全局 CoinGecko")).toHaveCount(0);
});

test("未配置 EVM 服务时，来源配置页指向本机设置", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  const notice = page.getByText("EVM 钱包依赖全局 CoinGecko");
  await expect(notice).toBeVisible();
  const settings = page.getByRole("link", { name: "前往本机设置" });
  await expect(settings).toHaveAttribute("href", "/settings");
});
