import { expect, test, type Page, type Request } from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("详情区间通过服务器导航切换并支持刷新和后退", async ({ page, request }) => {
  await request.post("/test-doubles/release-acceptance", { data: { action: "seed" } });
  await loginAsOwner(page);
  await page.getByRole("link", { name: "查看 Binance 只读账户 的资产明细" }).click();
  await page.getByRole("button", { name: "近 1 年", exact: true }).click();
  await expect(page).toHaveURL(/interval=1y/);
  await expect(page.getByRole("button", { name: "近 1 年", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page).toHaveURL(/interval=all/);
  await page.reload();
  await expect(page.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page.getByRole("button", { name: "近 1 年", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("资产来源统一列出自动账户、观察钱包和手工资产，并从总览摘要进入真实详情", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  await loginAsOwner(page);

  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "私募基金" },
  });
  expect(created.ok()).toBeTruthy();

  await page
    .getByRole("link", { name: "查看 Binance 只读账户 的资产明细" })
    .click();
  await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);

  await page.goto("/asset-sources");
  await expect(page.getByRole("heading", { name: "来源管理" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /长桥账户.*自动账户.*已连接/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包.*已连接/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /私募基金.*手工资产记录.*无凭证/ }),
  ).toBeVisible();
});

test("自动来源详情展示持仓、趋势、单来源刷新与脱敏授权摘要；手工来源只展示记录操作", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  await loginAsOwner(page);

  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "私募基金" },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Binance 只读账户.*自动账户/ }).click();
  await expect(page.getByRole("heading", { name: "Binance 只读账户" })).toBeVisible();
  await expect(page.getByText("来源身份", { exact: true })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toBeVisible();
  await expect(page.getByTestId("holding-top-list")).toContainText("USDT");
  await expect(page.getByText("资产金额趋势", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新 Binance 只读账户" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("release-binance-secret");
  await expect(page.locator("body")).not.toContainText("OAuth Token");
  await expect(page.locator("body")).not.toContainText("TOTP");

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /长桥账户.*自动账户/ }).click();
  const holdingsDetail = page.getByTestId("asset-holdings-detail");
  await expect(page.getByTestId("holding-top-list")).toBeHidden();
  await expect(holdingsDetail).toBeVisible();
  await expect(holdingsDetail.getByRole("columnheader")).toHaveText([
    "名称",
    /市值\s*\/\s*数量/,
    /现价\s*\/\s*成本/,
    "当日盈亏",
    "持仓盈亏",
  ]);

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /私募基金.*手工资产记录/ }).click();
  await expect(page.getByRole("heading", { name: "私募基金" })).toBeVisible();
  await expect(page.getByText("历史记录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加数据" })).toBeVisible();
  await expect(page.getByTestId("holding-top-list")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /刷新 私募基金/ })).toHaveCount(0);
  await expect(page.getByText("只读授权摘要", { exact: true })).toHaveCount(0);
});

test("来源详情可以切换 USD、CNY 与 HKD 计价货币", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  await loginAsOwner(page);

  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "A 股" },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /A 股.*手工资产记录/ }).click();
  await page.getByRole("button", { name: "添加数据" }).click();
  const record = page.getByRole("dialog", { name: "记录 A 股 数据" });
  await record.getByLabel("资产总额").fill("72000");
  await record.getByRole("button", { name: "币种" }).click();
  await page.getByRole("option", { name: "CNY", exact: true }).click();
  await record.getByRole("button", { name: "保存数据" }).click();

  await expect(page.getByTestId("asset-source-total")).toContainText("10,000.00 USD");
  await expect(page.getByTestId("asset-source-total")).not.toContainText("无法折算");

  const history = page.getByLabel("A 股历史记录");
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history).toContainText("72,000.00 CNY");
  const originalHistory = await history.getByRole("listitem").allTextContents();
  const mutationRequests: string[] = [];
  const recordMutation = (request: Request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/asset-sources/")
    ) {
      mutationRequests.push(request.method() + " " + request.url());
    }
  };
  page.on("request", recordMutation);
  const currency = page.getByRole("button", { name: "计价货币" });
  await currency.click();
  await page.getByRole("option", { name: "CNY", exact: true }).click();
  await expect(page.getByTestId("asset-source-total")).toContainText("72,000.00 CNY");

  await currency.click();
  await page.getByRole("option", { name: "HKD", exact: true }).click();
  await expect(page.getByTestId("asset-source-total")).toContainText("78,000.00 HKD");

  await currency.click();
  await page.getByRole("option", { name: "USD", exact: true }).click();
  await expect(page.getByTestId("asset-source-total")).toContainText("10,000.00 USD");
  expect(mutationRequests).toEqual([]);
  // 切换期间不应写入资产；页面重载会独立触发自动刷新，另用历史回读验证。
  page.off("request", recordMutation);
  await page.reload();
  await expect(history.getByRole("listitem")).toHaveText(originalHistory);
  await history.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(record.getByLabel("资产总额")).toHaveValue("72000");
  await expect(record.getByRole("button", { name: /^币种 / })).toHaveText("CNY");
  await record.getByRole("button", { name: "取消", exact: true }).click();
});

test("来源详情保留隐藏、断开、缺少凭证的恢复保护与永久删除确认", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  await loginAsOwner(page);

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Binance 只读账户.*自动账户/ }).click();

  await page.getByRole("button", { name: "隐藏来源卡片" }).click();
  await expect(
    page.getByRole("button", { name: "恢复显示来源卡片" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "断开来源" }).click();
  const disconnect = page.getByRole("dialog", {
    name: "确认断开 Binance 只读账户",
  });
  await expect(disconnect).toContainText("停止同步；历史数据保留");
  await page.keyboard.press("Escape");
  await expect(disconnect).toHaveCount(0);

  await page.getByRole("button", { name: "断开来源" }).click();
  await page
    .getByRole("dialog", { name: "确认断开 Binance 只读账户" })
    .getByRole("button", { name: "确认断开" })
    .click();
  await expect(page.getByText("已断开", { exact: true })).toBeVisible();
  const beforeRemoval = await (await request.get("/test-doubles/binance")).json();
  const credentialRemoval = await request.post("/test-doubles/binance", {
    data: { scenario: "forget-credential" },
  });
  expect(credentialRemoval.ok()).toBeTruthy();
  expect(await (await request.get("/test-doubles/binance")).json()).toMatchObject({
    savedSources: 1,
    savedSecrets: beforeRemoval.savedSecrets - 1,
  });
  await page.getByRole("button", { name: "恢复连接" }).click();
  await expect(page.getByRole("region", { name: "危险操作" }).getByRole("alert")).toContainText(
    "原连接凭证已不存在，无法直接恢复",
  );
  await expect(page.getByText("已断开", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "更换授权 / 重新授权" })).toBeVisible();

  await page.getByRole("button", { name: "永久删除数据" }).click();
  const firstDelete = page.getByRole("dialog", { name: "永久删除来源数据" });
  await expect(firstDelete).toContainText("永久删除来源及全部历史数据，无法恢复");
  await firstDelete.getByRole("button", { name: "继续删除" }).click();
  const secondDelete = page.getByRole("dialog", { name: "第二次确认永久删除" });
  await secondDelete.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "Binance 只读账户" })).toBeVisible();
});

test("来源详情内的单来源刷新和手工记录编辑保持各自边界", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule" },
  });
  await loginAsOwner(page);
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /Alpha Securities.*自动账户/ }).click();
  await page.getByRole("button", { name: "刷新 Alpha Securities" }).click();
  await expect(
    page.getByTestId("asset-source-refresh-status-source-alpha"),
  ).toContainText("刷新完成");

  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "私募基金" },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: /私募基金.*手工资产记录/ }).click();
  await page.getByRole("button", { name: "添加数据" }).click();
  const record = page.getByRole("dialog", { name: "记录 私募基金 数据" });
  await expect(record.getByRole("button", { name: /^币种 / })).toHaveText("CNY");
  await record.getByLabel("资产总额").fill("120000");
  await record.getByRole("button", { name: "保存数据" }).click();
  await expect(page.getByLabel("私募基金历史记录")).toContainText("120,000.00 CNY");
  await expect(page.getByRole("button", { name: /刷新 私募基金/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "断开来源" })).toHaveCount(0);
});

test("锁定状态不暴露来源，手机可通过键盘打开详情且无横向溢出", async ({
  page,
  request,
}) => {
  await page.goto("/asset-sources");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);

  await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await page.goto("/asset-sources");
  const source = page.getByRole("link", { name: /Binance 只读账户.*自动账户/ });
  await source.focus();
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Binance 只读账户" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
