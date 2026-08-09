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
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function chooseOption(page: Page, label: string, option: string) {
  const control = page.getByRole("button", { name: label });
  await control.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(control).toContainText(option);
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const configured = await request.post("/test-doubles/valuation");
  expect(configured.ok()).toBeTruthy();
});

test("资产与持仓把来源总额与明细观察分层，不用持仓差额改写总额", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/assets");

  const workspace = page.getByTestId("assets-holdings-workspace");
  await expect(page.getByRole("heading", { name: "资产与持仓" })).toBeVisible();
  await expect(workspace).toContainText("来源总额是组合汇总真相");
  await expect(workspace).toContainText("持仓明细不会取代这一列");

  const sourceTotals = workspace.getByTestId("assets-source-totals");
  await expect(sourceTotals).toContainText("Alpha Securities");
  await expect(sourceTotals).toContainText("Beta Crypto");
  await expect(
    workspace.getByTestId("assets-source-total-source-alpha"),
  ).toContainText("当前来源总额");

  const holdings = workspace.getByTestId("assets-holdings-table");
  await expect(holdings).toContainText("Apple Cross-source");
  await expect(holdings).toContainText("Tether");
  await expect(holdings).toContainText("Mystery Token");
  await expect(holdings).toContainText("来源可用价格变化");
  await expect(holdings).toContainText("平台未提供");
  await expect(holdings).toContainText("未估值");
  await expect(workspace).toContainText("只有来源明确提供的平台盈亏才显示");
  await expect(workspace).not.toContainText("持仓合计");
});

test("来源、类别与估值筛选只收缩观察列表，不混淆上方来源总额", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/assets");

  const workspace = page.getByTestId("assets-holdings-workspace");
  await chooseOption(page, "资产来源", "Beta Crypto");
  await chooseOption(page, "资产类别", "加密资产");
  await chooseOption(page, "估值状态", "需关注");

  const holdings = workspace.getByTestId("assets-holdings-table");
  await expect(holdings).toContainText("Mystery Token");
  await expect(holdings).not.toContainText("Apple Cross-source");
  await expect(workspace.getByTestId("assets-holdings-count")).toContainText(
    "显示 1 项观察",
  );
  await expect(
    workspace.getByTestId("assets-source-total-source-alpha"),
  ).toBeVisible();
  await expect(
    workspace.getByTestId("assets-source-total-source-beta"),
  ).toBeVisible();
});

test("资产观察在 390px 可键盘筛选、切换币种且没有横向页面溢出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await page.goto("/assets");

  const workspace = page.getByTestId("assets-holdings-workspace");
  const sourceFilter = page.getByRole("button", { name: "资产来源" });
  await sourceFilter.focus();
  await expect(sourceFilter).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Beta Crypto", exact: true }).click();
  await expect(workspace.getByTestId("assets-holdings-count")).toContainText(
    "显示 3 项观察",
  );

  await chooseOption(page, "计价货币", "CNY");
  await expect(
    workspace.getByTestId("assets-source-total-source-beta"),
  ).not.toContainText("0.00 CNY");
  await expect(
    workspace.getByTestId("assets-holdings-table").locator("td").first(),
  ).toHaveAttribute("data-label", "资产与来源");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
