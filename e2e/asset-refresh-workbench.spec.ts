import { expect, test, type Page } from "@playwright/test";
import type { AssetRefreshReport } from "@/server/ports";

interface DeferredRefreshRequest {
  body: {
    intent?: { reason?: string; sourceId?: string };
  };
  resolve(report: AssetRefreshReport): void;
}

async function deferRefreshRequests(
  page: Page,
): Promise<DeferredRefreshRequest[]> {
  const pending: DeferredRefreshRequest[] = [];
  await page.route("**/api/asset-sources/refresh", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const report = await new Promise<AssetRefreshReport>((resolve) => {
      pending.push({
        body: route.request().postDataJSON() as DeferredRefreshRequest["body"],
        resolve,
      });
    });
    await route.fulfill({
      body: JSON.stringify(report),
      contentType: "application/json",
      status: 200,
    });
  });
  return pending;
}

async function attachPasskey(page: Page): Promise<void> {
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
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule" },
  });
  await request.post("/test-doubles/refresh", {
    data: { action: "anchor-full-refresh" },
  });
});

test("三个核心页面按钮和命令菜单统一提交 manual-global", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);

  for (const pathname of ["/", "/assets", "/performance"]) {
    await request.post("/test-doubles/refresh", {
      data: { action: "anchor-full-refresh" },
    });
    await page.goto(pathname);
    const requests: unknown[] = [];
    const observe = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/asset-sources/refresh")
      ) {
        requests.push(request.postDataJSON());
      }
    };
    page.on("request", observe);

    await page.getByRole("button", { name: "立即刷新资产" }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      mode: "all",
      intent: { reason: "manual-global" },
    });

    await page.getByRole("button", { name: "打开快捷命令" }).click();
    await page.getByRole("button", { name: "立即刷新资产" }).last().click();
    await page.waitForTimeout(500);
    expect(requests, JSON.stringify(requests)).toHaveLength(2);
    expect(requests[1]).toEqual({
      mode: "all",
      intent: { reason: "manual-global" },
    });
    page.off("request", observe);
  }
});

test("全量刷新跨路由保持共享状态且完成后只重读当前路由一次", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  await expect(page.getByTestId("overview-current-total")).toContainText(
    "300.00",
  );

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toContainText(
    "刷新中…",
  );
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);

  await page.getByRole("link", { name: "资产与持仓" }).first().click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toContainText(
    "刷新中…",
  );
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);
  await expect(
    page.getByTestId("assets-source-total-source-alpha"),
  ).toContainText("100.00 USD");
  await expect.poll(async () => {
    const response = await request.get("/test-doubles/refresh");
    return ((await response.json()) as { modes: string[] }).modes.length;
  }).toBe(1);

  const routeReads: string[] = [];
  const observeRead = (observed: import("@playwright/test").Request) => {
    const url = new URL(observed.url());
    if (
      observed.method() === "GET" &&
      url.pathname === "/assets" &&
      observed.headers()["rsc"] === "1"
    ) routeReads.push(observed.url());
  };
  page.on("request", observeRead);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });

  await expect(page.getByTestId("asset-refresh-status")).toHaveText("刷新完成");
  await expect(
    page.getByTestId("assets-source-total-source-alpha"),
  ).toContainText("101.00 USD");
  await expect.poll(() => routeReads.length).toBe(1);
  await page.waitForTimeout(300);
  expect(routeReads).toHaveLength(1);
  page.off("request", observeRead);
});

test("来源详情只刷新当前来源，离开页面不取消且完成后只重读当前路由一次", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources/source-alpha");
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "100.00 USD",
  );

  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "立即刷新资产" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  const sourceRefresh = page.getByRole("button", {
    name: "刷新 Alpha Securities",
  });
  await sourceRefresh.click();
  await expect(sourceRefresh).toContainText("刷新中…");
  await expect(
    page.getByTestId("asset-source-refresh-status-source-alpha"),
  ).toHaveText("正在刷新…");
  await expect.poll(async () => {
    const response = await request.get("/test-doubles/refresh");
    return (await response.json()) as { sourceIds: Array<string | null> };
  }).toMatchObject({ sourceIds: ["source-alpha"] });

  await page.getByRole("link", { name: "返回资产来源" }).click();
  await expect(page).toHaveURL(/\/asset-sources$/);
  const routeReads: string[] = [];
  const observeRead = (observed: import("@playwright/test").Request) => {
    const url = new URL(observed.url());
    if (
      observed.method() === "GET" &&
      url.pathname === "/asset-sources" &&
      observed.headers()["rsc"] === "1"
    ) routeReads.push(observed.url());
  };
  page.on("request", observeRead);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });

  await expect.poll(() => routeReads.length).toBe(1);
  await page.waitForTimeout(300);
  expect(routeReads).toHaveLength(1);
  page.off("request", observeRead);

  await page.goto("/asset-sources/source-alpha");
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "101.00 USD",
  );
  await page.goto("/asset-sources/source-beta");
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "200.00 USD",
  );
});

test("单来源 A 完成不会提前结束 B，B 失败固定显示刷新失败", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources/source-alpha");
  const pending = await deferRefreshRequests(page);

  await page.getByRole("button", { name: "刷新 Alpha Securities" }).click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole("link", { name: "返回资产来源" }).click();
  await page.getByRole("link", { name: /Beta Crypto.*自动账户/ }).click();
  const betaRefresh = page.getByRole("button", { name: "刷新 Beta Crypto" });
  await betaRefresh.click();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending.map(({ body }) => body.intent)).toEqual([
    { reason: "manual-source", sourceId: "source-alpha" },
    { reason: "manual-source", sourceId: "source-beta" },
  ]);

  pending[0]!.resolve({ successCount: 1, failureCount: 0 });
  await expect(betaRefresh).toBeDisabled();
  await expect(betaRefresh).toContainText("刷新中…");
  await expect(
    page.getByTestId("asset-source-refresh-status-source-beta"),
  ).toHaveText("正在刷新…");

  pending[1]!.resolve({ successCount: 0, failureCount: 1 });
  await expect(betaRefresh).toBeEnabled();
  await expect(
    page.getByTestId("asset-source-refresh-status-source-beta"),
  ).toHaveText("刷新失败");
});

test("单来源 A 完成不会提前结束其后提交的全量刷新", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources/source-alpha");
  const pending = await deferRefreshRequests(page);

  await page.getByRole("button", { name: "刷新 Alpha Securities" }).click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole("link", { name: "总览" }).first().click();
  const globalRefresh = page.getByRole("button", { name: "立即刷新资产" });
  await globalRefresh.click();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending.map(({ body }) => body.intent)).toEqual([
    { reason: "manual-source", sourceId: "source-alpha" },
    { reason: "manual-global" },
  ]);

  pending[0]!.resolve({ successCount: 1, failureCount: 0 });
  await expect(globalRefresh).toBeDisabled();
  await expect(globalRefresh).toContainText("刷新中…");
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);

  pending[1]!.resolve({
    attemptedAt: "2026-04-02T08:00:00.000Z",
    successCount: 2,
    failureCount: 0,
  });
  await expect(globalRefresh).toBeEnabled();
  await expect(page.getByTestId("asset-refresh-status")).toHaveText(
    "刷新完成",
  );
});

test("在途全量覆盖当前来源且来源按钮不产生额外请求", async ({
  page,
}) => {
  await loginAsOwner(page);
  const pending = await deferRefreshRequests(page);
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect.poll(() => pending.length).toBe(1);

  await page.getByRole("link", { name: "资产来源" }).first().click();
  await page.getByRole("link", { name: /Alpha Securities.*自动账户/ }).click();
  const sourceRefresh = page.getByRole("button", {
    name: "刷新 Alpha Securities",
  });
  await expect(sourceRefresh).toBeDisabled();
  await expect(sourceRefresh).toContainText("刷新中…");
  await expect(
    page.getByTestId("asset-source-refresh-status-source-alpha"),
  ).toHaveText("正在刷新…");
  await page.waitForTimeout(200);
  expect(pending).toHaveLength(1);

  pending[0]!.resolve({
    attemptedAt: "2026-04-02T08:00:00.000Z",
    successCount: 2,
    failureCount: 0,
  });
  await expect(sourceRefresh).toBeEnabled();
  await expect(
    page.getByTestId("asset-source-refresh-status-source-alpha"),
  ).toHaveText("刷新完成");
});

test("旧全量终态不会遮住随后提交的单来源刷新", async ({ page }) => {
  await loginAsOwner(page);
  const pending = await deferRefreshRequests(page);
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect.poll(() => pending.length).toBe(1);
  pending[0]!.resolve({
    attemptedAt: "2026-04-02T08:00:00.000Z",
    successCount: 2,
    failureCount: 0,
  });
  await expect(page.getByTestId("asset-refresh-status")).toHaveText(
    "刷新完成",
  );

  await page.getByRole("link", { name: "资产来源" }).first().click();
  await page.getByRole("link", { name: /Alpha Securities.*自动账户/ }).click();
  const sourceRefresh = page.getByRole("button", {
    name: "刷新 Alpha Securities",
  });
  const sourceStatus = page.getByTestId(
    "asset-source-refresh-status-source-alpha",
  );
  await expect(sourceStatus).toHaveText("刷新完成");

  await sourceRefresh.click();
  await expect.poll(() => pending.length).toBe(2);
  await expect(sourceRefresh).toBeDisabled();
  await expect(sourceRefresh).toContainText("刷新中…");
  await expect(sourceStatus).toHaveText("正在刷新…");

  pending[1]!.resolve({ successCount: 1, failureCount: 0 });
  await expect(sourceRefresh).toBeEnabled();
  await expect(sourceStatus).toHaveText("刷新完成");
});

test("三个核心页面一致呈现手动成功、部分失败与全部失败并保留金额", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  const cases = [
    {
      pathname: "/",
      scenario: "schedule",
      status: "刷新完成",
      retainedTestId: "overview-current-total",
      retainedAmount: "302.00",
    },
    {
      pathname: "/assets",
      scenario: "partial-failure",
      status: "部分来源刷新失败",
      retainedTestId: "assets-source-total-source-beta",
      retainedAmount: "200.00 USD",
    },
    {
      pathname: "/performance",
      scenario: "all-failure",
      status: "刷新失败",
      retainedTestId: "performance-current-total",
      retainedAmount: "300.00",
    },
  ] as const;

  for (const current of cases) {
    const configured = await request.post("/test-doubles/refresh", {
      data: { action: "configure", scenario: current.scenario },
    });
    expect(configured.ok()).toBeTruthy();
    await page.goto(current.pathname);

    await page.getByRole("button", { name: "立即刷新资产" }).click();
    await expect(page.getByTestId("asset-refresh-status")).toHaveText(current.status);
    await expect(page.getByTestId(current.retainedTestId)).toContainText(
      current.retainedAmount,
    );
  }
});

test("无可刷新来源时隐藏页面与命令入口，恢复首个来源后同步出现", async ({
  page,
}) => {
  await loginAsOwner(page);
  for (const sourceId of ["source-alpha", "source-beta"]) {
    const response = await page.request.patch(`/api/asset-sources/${sourceId}`, {
      data: { action: "disconnect" },
    });
    expect(response.ok()).toBeTruthy();
  }

  for (const pathname of ["/", "/assets", "/performance"]) {
    await page.goto(pathname);
    await expect(
      page.getByRole("button", { name: "立即刷新资产" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "资产来源" }).first()).toBeVisible();
    await page.getByRole("button", { name: "打开快捷命令" }).click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "立即刷新资产" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  const restored = await page.request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule", sourceCount: 1 },
  });
  expect(restored.ok()).toBeTruthy();
  for (const pathname of ["/", "/assets", "/performance"]) {
    await page.goto(pathname);
    await expect(
      page.getByRole("button", { name: "立即刷新资产" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "打开快捷命令" }).click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "立即刷新资产" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("锁定与演示模式清除真实刷新状态，旧请求完成不重读页面", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);

  const routeReads: string[] = [];
  const observeRead = (observed: import("@playwright/test").Request) => {
    if (observed.method() === "GET" && observed.headers()["rsc"] === "1") {
      routeReads.push(observed.url());
    }
  };
  page.on("request", observeRead);
  await page.getByRole("button", { name: "立即锁定（退出登录）" }).click();
  await expect(page.getByText("敏感内容已锁定")).toBeVisible();
  routeReads.length = 0;
  await request.post("/test-doubles/refresh", { data: { action: "release" } });
  await page.waitForTimeout(500);
  expect(routeReads).toHaveLength(0);
  page.off("request", observeRead);

  await expect(page.getByRole("link", { name: "进入演示模式" })).toBeVisible();
  await page.getByRole("link", { name: "进入演示模式" }).click();
  await expect(page.getByTestId("demo-mode-dashboard")).toBeVisible();
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toHaveCount(0);
});

test("手机宽度下刷新入口可键盘操作且满足 outline、状态与点击区合同", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  const refresh = page.getByRole("button", { name: "立即刷新资产" });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  const appearance = await refresh.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      height: rect.height,
    };
  });
  expect(appearance.height).toBeGreaterThanOrEqual(40);
  expect(appearance.borderTopWidth).not.toBe("0px");
  expect(appearance.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

  await page.keyboard.press("Enter");
  await expect(refresh).toContainText("刷新中…");
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });
});

test("首页刷新反馈不改变计价货币与刷新按钮的同级对齐", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginAsOwner(page);
  const currency = page.getByRole("button", { name: "计价货币" });
  const refresh = page.getByRole("button", { name: "立即刷新资产" });

  const idleLayout = await page.evaluate(() => {
    const currencyControl = document.querySelector(
      "#overview-reporting-currency",
    )?.getBoundingClientRect();
    const refreshControl = document.querySelector(
      ".workbench-page-header__actions .asset-refresh-controls",
    )?.getBoundingClientRect();
    const refreshButton = document.querySelector(
      ".workbench-page-header__actions .asset-refresh-controls .vibe-button",
    )?.getBoundingClientRect();
    return { currencyControl, refreshControl, refreshButton };
  });
  expect(idleLayout.currencyControl).not.toBeNull();
  expect(idleLayout.refreshControl).not.toBeNull();
  expect(idleLayout.refreshButton).not.toBeNull();
  expect(idleLayout.refreshButton!.width).toBe(112);
  expect(idleLayout.refreshButton!.height).toBe(44);
  expect(idleLayout.refreshButton!.left - idleLayout.currencyControl!.right).toBeGreaterThanOrEqual(8);

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  await refresh.click();
  await expect(refresh).toContainText("刷新中…");
  await request.post("/test-doubles/refresh", { data: { action: "release" } });
  await expect(page.getByTestId("asset-refresh-status")).toHaveText("刷新完成");

  const completedLayout = await page.evaluate(() => {
    const currencyControl = document.querySelector(
      "#overview-reporting-currency",
    )?.getBoundingClientRect();
    const refreshControl = document.querySelector(
      ".workbench-page-header__actions .asset-refresh-controls",
    )?.getBoundingClientRect();
    const refreshButton = document.querySelector(
      ".workbench-page-header__actions .asset-refresh-controls .vibe-button",
    )?.getBoundingClientRect();
    const status = document.querySelector(
      "[data-testid=asset-refresh-status]",
    )?.getBoundingClientRect();
    return { currencyControl, refreshControl, refreshButton, status };
  });
  expect(completedLayout.currencyControl).not.toBeNull();
  expect(completedLayout.refreshControl).not.toBeNull();
  expect(completedLayout.refreshButton).not.toBeNull();
  expect(completedLayout.status).not.toBeNull();
  expect(completedLayout.refreshControl!.height).toBe(completedLayout.refreshButton!.height);
  expect(Math.abs(completedLayout.currencyControl!.bottom - completedLayout.refreshButton!.bottom)).toBeLessThanOrEqual(1);
  expect(completedLayout.status!.top).toBeGreaterThanOrEqual(completedLayout.refreshButton!.bottom + 8);
  expect(completedLayout.status!.left).toBeGreaterThanOrEqual(completedLayout.refreshButton!.left);
  expect(completedLayout.status!.right).toBeLessThanOrEqual(completedLayout.refreshButton!.right);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await expect(currency).toBeVisible();
  await expect(refresh).toBeVisible();
});

test("全局与来源刷新统一图标、outline 与终态样式", async ({
  page,
}) => {
  await loginAsOwner(page);
  const pending = await deferRefreshRequests(page);

  const globalRefresh = page.getByRole("button", { name: "立即刷新资产" });
  await expect(globalRefresh).toHaveAttribute("data-vibe-variant", "outline");
  await expect(globalRefresh.locator(".asset-global-refresh-icon")).toBeVisible();
  await globalRefresh.click();
  await expect(globalRefresh).toBeDisabled();
  await expect(globalRefresh).toContainText("刷新中…");
  await expect(globalRefresh.locator(".asset-refresh-icon > path")).toHaveCSS(
    "animation-name",
    "asset-source-refresh-spin",
  );

  pending[0]!.resolve({ successCount: 2, failureCount: 0 });
  await expect(globalRefresh).toBeEnabled();

  await page.mouse.move(0, 0);
  await page.goto("/asset-sources/source-alpha");
  const sourceRefresh = page.getByRole("button", {
    name: "刷新 Alpha Securities",
  });
  await expect(sourceRefresh).toHaveAttribute("data-vibe-variant", "outline");
  await expect(sourceRefresh.locator(".asset-source-refresh-icon")).toBeVisible();
  const idleAppearance = await sourceRefresh.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, color: style.color };
  });

  await sourceRefresh.click();
  await expect.poll(() => pending.length).toBe(2);
  await expect(sourceRefresh).toBeDisabled();
  await expect(sourceRefresh).toContainText("刷新中…");
  await expect(sourceRefresh.locator(".asset-refresh-icon > path")).toHaveCSS(
    "animation-name",
    "asset-source-refresh-spin",
  );

  pending[1]!.resolve({ successCount: 0, failureCount: 1 });
  await expect(sourceRefresh).toBeEnabled();
  await expect(
    page.getByTestId("asset-source-refresh-status-source-alpha"),
  ).toHaveText("刷新失败");
  await page.mouse.move(0, 0);
  await expect(sourceRefresh).toHaveCSS("border-color", idleAppearance.borderColor);
  await expect(sourceRefresh).toHaveCSS("color", idleAppearance.color);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
