import { expect, test, type CDPSession, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const CARDS = [
  {
    id: "identity",
    kind: "identity",
    avatarUrl: "",
    nickname: "XiaoX",
    introduction: "个人资产终端",
    span: 2,
    access: "private",
  },
  {
    id: "research",
    kind: "markdown",
    title: "研究日志",
    markdown: "记录长期观察与决策。",
    span: 1,
    access: "private",
  },
] as const;

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
  await page
    .getByTestId("restricted-card")
    .first()
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function connectEthereum(page: Page): Promise<void> {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Ethereum 观察钱包" }).check();
  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: "确认 Ethereum 观察钱包" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
}

async function refreshCalls(page: Page): Promise<number> {
  return ((await (await page.request.get("/test-doubles/ethereum")).json()) as {
    refreshCalls: number;
  }).refreshCalls;
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const response = await request.post("/test-doubles/cards", {
    data: { cards: CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("访客无命令菜单，所有者可用 Command-K 与 Ctrl-K 搜索并跳转可见卡片", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog", { name: "快捷命令" })).toHaveCount(0);

  await loginAsOwner(page);
  await page.keyboard.press("Meta+K");
  const menu = page.getByRole("dialog", { name: "快捷命令" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("⌘K");
  await expect(menu).toContainText("Ctrl K");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.keyboard.press("Control+K");
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("研究");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-command-label="研究日志"]')).toBeFocused();

  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("XiaoX");
  await page.getByRole("button", { name: "跳转到 XiaoX" }).click();
  await expect(page.locator('[data-command-label="XiaoX"]')).toBeFocused();
});

test("鼠标可打开菜单、刷新资产并锁定，隐藏卡片不会进入导航结果", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeVisible();
  await expect(page.getByRole("button", { name: "立即锁定（退出登录）" })).toBeVisible();

  await page.getByRole("button", { name: "隐藏 Ethereum 观察钱包" }).click();
  await page.getByRole("button", { name: "打开快捷命令" }).click();
  const search = page.getByRole("searchbox", { name: "搜索命令" });
  await search.fill("Ethereum");
  await expect(page.getByText("没有匹配的命令")).toBeVisible();

  const before = await refreshCalls(page);
  await search.fill("刷新");
  await page
    .getByRole("dialog", { name: "快捷命令" })
    .getByRole("button", { name: "立即刷新资产" })
    .click();
  await expect.poll(() => refreshCalls(page)).toBeGreaterThan(before);

  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("锁定");
  await page.getByRole("button", { name: "立即锁定敏感内容" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByRole("dialog", { name: "快捷命令" })).toHaveCount(0);
});
