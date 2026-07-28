import { expect, test, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function loginAsOwner(page: Page): Promise<void> {
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

test("添加来源先选择类型再配置，返回保留草稿而取消会清空", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();

  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await expect(dialog.getByLabel("Ethereum 公开地址（每行一个）")).toHaveCount(0);

  await dialog.getByRole("radio", { name: "Ethereum 观察钱包" }).check();
  await expect(dialog.getByRole("heading", { name: "Ethereum 观察钱包" })).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);

  const addressField = dialog.getByLabel("Ethereum 公开地址（每行一个）");
  await addressField.fill(ADDRESS);
  await dialog.getByRole("button", { name: "返回来源列表" }).click();
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();

  await dialog.getByRole("radio", { name: "Ethereum 观察钱包" }).click();
  await expect(addressField).toHaveValue(ADDRESS);
  await dialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "添加资产来源" }).click();
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await dialog.getByRole("radio", { name: "Ethereum 观察钱包" }).check();
  await expect(dialog.getByLabel("Ethereum 公开地址（每行一个）")).toHaveValue("");
});
