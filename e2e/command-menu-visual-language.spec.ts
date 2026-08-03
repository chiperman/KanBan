import { expect, test, type CDPSession, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const CARDS = [
  {
    id: "overview-entry",
    kind: "asset",
    title: "XiaoX 资产概览",
    body: "个人资产终端",
    span: 2,
  },
  {
    id: "research",
    kind: "asset",
    title: "研究日志",
    body: "记录长期观察与决策。",
    span: 1,
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

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function connectEthereum(page: Page): Promise<void> {
  await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "EVM 观察钱包" }).check();
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: "确认 EVM 观察钱包" })
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
  const response = await request.post("/test-doubles/asset-cards", {
    data: { assetCards: CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("已登录看板遵守 Nothing 字体层级、操作语义和点击区域", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  const overviewBox = await page.getByTestId("total-overview-card").boundingBox();
  const controlsBox = await page.locator(".dashboard-control-deck").boundingBox();
  expect(overviewBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(overviewBox!.y).toBeLessThan(controlsBox!.y);

  const label = page.getByTestId("total-asset-overview").locator(".card-label").first();
  await expect(label).toHaveCSS("font-family", /Geist Mono/);
  expect(
    await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(11);

  const standardButton = page.getByTestId("sensitive-info-toggle");
  await expect(standardButton).toHaveCSS("font-family", /Geist Mono/);
  await expect(standardButton).toHaveCSS("font-size", "11px");
  await expect(standardButton).toHaveCSS("border-radius", "6px");
  await expect(standardButton).toHaveAttribute("data-vibe-variant", "outline");

  const sourceCard = page.getByTestId("ethereum-watch-card");
  await expect(sourceCard.locator(".source-live-state")).toHaveCSS(
    "font-size",
    "10px",
  );
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-component",
    "status-tag",
  );
  await expect(sourceCard.locator(".source-meter-caption")).toHaveCSS(
    "font-family",
    /Geist Mono/,
  );
  await expect(sourceCard.locator(".source-meter-caption")).toHaveCSS(
    "font-size",
    "12px",
  );

  const card = sourceCard.locator("..");
  const cardBorders = await card.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      top: computed.borderTopWidth,
      right: computed.borderRightWidth,
    };
  });
  expect(cardBorders).toEqual({ top: "0px", right: "0px" });
  await expect(card).toHaveAttribute("data-vibe-surface", "data-card");
  await expect(
    sourceCard.getByRole("img", { name: /项已估值/ }),
  ).toHaveAttribute("data-vibe-component", "segmented-bar");
  for (const control of [
    card.getByRole("button", { name: /调整.*宽度/ }),
    card.getByRole("button", { name: /拖动.*调整排序/ }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }

  await card.getByRole("button", { name: "管理 Ethereum 观察钱包" }).click();
  const management = page.getByRole("dialog", {
    name: "管理 Ethereum 观察钱包",
  });
  await management.getByRole("button", { name: "更多来源操作" }).click();
  const danger = management.getByRole("menuitem", { name: "永久删除数据" });
  await expect(danger).toHaveCSS("color", "rgb(194, 20, 28)");
  await expect(danger).toHaveCSS("min-height", "40px");
});

test("未认证状态无命令菜单，所有者可用 Command-K 与 Ctrl-K 搜索并跳转资产卡片", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog", { name: "快捷命令" })).toHaveCount(0);

  await loginAsOwner(page);
  await page.keyboard.press("Meta+K");
  const menu = page.getByRole("dialog", { name: "快捷命令" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-vibe-component", "command-menu");
  await expect(menu.locator(".command-menu-panel")).toHaveAttribute(
    "data-vibe-surface",
    "command-panel",
  );
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
  await page.getByRole("button", { name: "跳转到 XiaoX 资产概览" }).click();
  await expect(page.locator('[data-command-label="XiaoX 资产概览"]')).toBeFocused();
});

test("卡片索引可直接跳转并标记当前卡片", async ({ page }) => {
  await loginAsOwner(page);

  const index = page.getByTestId("card-index");
  await expect(index).toBeVisible();
  await expect(index).toContainText("CARD INDEX");
  await expect(index).not.toContainText("⌘K 搜索");

  const researchTarget = index.getByRole("button", {
    name: "定位 研究日志",
  });
  await researchTarget.click();
  await expect(page.locator('[data-command-label="研究日志"]')).toBeFocused();
  await expect(researchTarget).toHaveAttribute("aria-current", "location");
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
  await expect(
    page.getByRole("heading", { name: "个人资产看板已锁定" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "快捷命令" })).toHaveCount(0);
});
