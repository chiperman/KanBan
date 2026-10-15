import { expect, test, type Page } from "@playwright/test";

import { loginAsOwner } from "../owner-auth-helpers";

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
  await page.setViewportSize({ width: 1920, height: 1080 });
  // 本例检查已有快照布局；模拟自动刷新尚未到期，避免演示凭证刷新失败改写状态。
  await page.route("**/api/asset-sources/refresh", (route) => route.fulfill({
    json: { successCount: 0, failureCount: 0, skipped: "not-due", attemptedAt: new Date().toISOString() },
  }));
  await loginAsOwner(page);
  await page.goto("/assets");

  const workspace = page.getByTestId("assets-holdings-workspace");
  await expect(page.getByRole("heading", { name: "资产与持仓" })).toBeVisible();
  await expect(workspace).not.toContainText("来源总额是组合汇总真相");
  await expect(workspace).not.toContainText("持仓明细不会取代这一列");

  const sourceTotals = workspace.getByTestId("assets-source-totals");
  await expect(sourceTotals.getByText("来源总额", { exact: true })).toBeVisible();
  await expect(sourceTotals).toContainText("Alpha Securities");
  await expect(sourceTotals).toContainText("Beta Crypto");
  await expect(workspace.getByTestId("assets-source-total-source-alpha"))
    .not.toContainText("总额有效");
  await expect(
    sourceTotals.getByRole("link", {
      name: "查看 Alpha Securities 来源详情",
    }),
  ).toBeVisible();
  const holdings = workspace.getByTestId("assets-holdings-table");
  for (const heading of [
    "资产与来源",
    "市值",
    "现价 / 数量",
    "价格变化",
    "平台盈亏",
    "数据状态",
  ]) {
    await expect(holdings.getByRole("columnheader", { name: heading, exact: true }))
      .toBeVisible();
  }
  await expect(holdings).toContainText("Apple Cross-source");
  await expect(holdings).toContainText("Tether");
  await expect(holdings).toContainText("Mystery Token");
  await expect(workspace.getByText(/价格变化采用来源可用行情/)).toHaveCount(1);
  await expect(holdings.locator("tbody")).not.toContainText("平台原生口径");
  await expect(holdings).toContainText("平台未提供");
  await expect(holdings).toContainText("未估值");
  await expect(workspace).not.toContainText("持仓合计");

  const apple = holdings.getByRole("row").filter({ hasText: "Apple Cross-source" });
  const evidence = apple.getByRole("button", { name: "查看 Apple Cross-source 行情依据" });
  await expect(evidence).toHaveAttribute("aria-expanded", "false");
  await expect(apple.getByText(/Beta 原生行情/)).toHaveCount(0);
  await evidence.focus();
  await page.keyboard.press("Enter");
  await expect(evidence).toHaveAttribute("aria-expanded", "true");
  await expect(apple.getByText(/Beta 原生行情/)).toContainText("2026-04-01 16:00");
  await evidence.click();
  await expect(apple.getByText(/Beta 原生行情/)).toHaveCount(0);
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

test("长桥实时 SSE 行情只在页面内更新价格、市值与来源总额", async ({
  page,
  request,
}) => {
  const configured = await request.post("/test-doubles/valuation?scenario=longbridge-cash");
  expect(configured.ok()).toBeTruthy();

  await page.route("**/api/asset-sources/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
      },
      body: [
        "event: ready",
        "data: {\"provider\":\"longbridge\",\"symbols\":[\"AAPL.US\"],\"mode\":\"serve\"}",
        "",
        "event: quote",
        "data: {\"symbol\":\"AAPL.US\",\"last_done\":\"123\",\"prev_close\":\"120\",\"timestamp\":1790038800}",
        "",
        "",
      ].join("\n"),
    });
  });

  await loginAsOwner(page);
  await page.goto("/assets");

  const workspace = page.getByTestId("assets-holdings-workspace");
  const row = workspace.getByRole("row").filter({ hasText: "AAPL.US" });
  await expect(row).toContainText("123.00");
  await expect(row).toContainText("123.00 USD");
  await expect(
    workspace.getByTestId("assets-source-total-source-longbridge-cash"),
  ).toContainText("805.82 USD");
});

// 保留真实页面订阅与投影，只替换外部行情传输。
async function installQuoteStream(page: Page) {
  await page.addInitScript(() => {
    const counterStarts = new WeakMap<Element, string[]>();
    new MutationObserver((records) => {
      for (const record of records) {
        const counter = record.target as HTMLElement;
        if (counter.dataset.counterState !== "running") continue;
        const starts = counterStarts.get(counter) ?? [];
        starts.push(counter.textContent ?? "");
        counterStarts.set(counter, starts);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-counter-state"] });
    class QuoteStream extends EventTarget {
      static active = new Set<QuoteStream>();
      constructor(_url: string) {
        super();
        QuoteStream.active.add(this);
      }
      close() { QuoteStream.active.delete(this); }
    }
    Object.assign(window, {
      counterStarts,
      EventSource: QuoteStream,
      activeQuoteStreams: () => QuoteStream.active.size,
      emitQuote: (price: string, timestamp: string | number = 1790038800, trade_session = "Intraday") => {
        for (const stream of QuoteStream.active) {
          stream.dispatchEvent(new MessageEvent("stream-status", {
            data: JSON.stringify({ state: "ready" }),
          }));
          stream.dispatchEvent(new MessageEvent("quote", {
            data: JSON.stringify({ symbol: "AAPL.US", last_done: price, timestamp, trade_session }),
          }));
        }
      },
    });
  });
}

async function emitQuote(page: Page, price: string, timestamp: string | number = 1790038800, trade_session = "Intraday") {
  await page.evaluate(({ price, timestamp, trade_session }) => {
    (window as unknown as { emitQuote(price: string, timestamp: string | number, trade_session: string): void })
      .emitQuote(price, timestamp, trade_session);
  }, { price, timestamp, trade_session });
}

for (const path of ["/assets", "/asset-sources/source-longbridge-cash"]) {
  test("长桥首次从零计数、完整刷新和后续行情平滑过渡：" + path, async ({ page, request }) => {
    await request.post("/test-doubles/valuation?scenario=longbridge-cash&refreshable=true");
    await installQuoteStream(page);
    await loginAsOwner(page);
    await page.goto(path);
    const counter = page.getByTestId(path === "/assets"
      ? "assets-source-total-source-longbridge-cash" : "asset-source-total")
      .locator('[data-vibe-component="live-counter"]');
    await counter.scrollIntoViewIfNeeded();
    await expect(counter).toHaveAttribute("data-counter-state", "running");
    const starts = () => counter.evaluate((element) =>
      (window as unknown as { counterStarts: WeakMap<Element, string[]> }).counterStarts.get(element) ?? [],
    );
    expect(await starts()).toEqual(["0.00"]);
    // 首次计数中收到行情，合并窗口到期后从已显示的金额继续动画。
    await emitQuote(page, "123");
    await expect(counter).toHaveAttribute("data-counter-target", "805.82");
    await expect(counter).toHaveAttribute("data-counter-state", "running", { timeout: 100 });
    await expect(counter).toHaveAttribute("data-counter-state", "complete");
    await expect(counter).toHaveText("805.82");
    expect(await starts()).toEqual(["0.00", "782.82"]);

    // 使用测试来源刷新器，走真实按钮、刷新协调器和路由重新取数。
    await request.post("/test-doubles/refresh", { data: { action: "reset-schedule" } });
    await page.getByRole("button", { name: path === "/assets"
      ? "立即刷新资产" : "刷新 长桥账户", exact: true }).click();
    await counter.scrollIntoViewIfNeeded();
    await expect(counter).toHaveAttribute("data-counter-state", "running");
    expect(await starts()).toEqual(["0.00", "782.82", "805.82"]);
    await expect(counter).toHaveAttribute("data-counter-state", "complete");
    await expect(counter).toHaveText("123.00");
    await emitQuote(page, "124", 1790038802);
    await expect(counter).toHaveAttribute("data-counter-target", "124.00");
    await expect(counter).toHaveAttribute("data-counter-state", "running", { timeout: 100 });
    await expect.poll(async () => Number(await counter.textContent())).toBeGreaterThan(123);
    expect(Number(await counter.textContent())).toBeLessThan(124);
    await expect(counter).toHaveAttribute("data-counter-state", "complete");
    await expect(counter).toHaveText("124.00");
    expect(await starts()).toEqual(["0.00", "782.82", "805.82", "123.00"]);
    await emitQuote(page, "120", 1790038803);
    await expect(counter).toHaveAttribute("data-counter-target", "120.00");
    await expect(counter).toHaveAttribute("data-counter-state", "running", { timeout: 100 });
    await expect(counter).toHaveAttribute("data-counter-state", "complete");
    await expect(counter).toHaveText("120.00");
    expect(await starts()).toEqual(["0.00", "782.82", "805.82", "123.00", "124.00"]);
  });
}

test("完整刷新动画期间收到行情，完成当前目标后平滑追上最新值", async ({ page, request }) => {
  await request.post("/test-doubles/valuation?scenario=longbridge-cash&refreshable=true");
  await installQuoteStream(page);
  await loginAsOwner(page);
  await page.goto("/assets");
  const counter = page.getByTestId("assets-source-total-source-longbridge-cash")
    .locator('[data-vibe-component="live-counter"]');
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  await request.post("/test-doubles/refresh", { data: { action: "reset-schedule" } });
  await emitQuote(page, "123");
  await page.waitForTimeout(1_300);
  await page.getByRole("button", { name: "立即刷新资产", exact: true }).click();
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toHaveAttribute("data-counter-target", "201.00");
  await expect(counter).toHaveAttribute("data-counter-state", "running");
  await expect(counter).toHaveAttribute("data-counter-target", "123.00");
  const starts = () => counter.evaluate((element) =>
    (window as unknown as { counterStarts: WeakMap<Element, string[]> }).counterStarts.get(element) ?? [],
  );
  // 行情到达时原动画仍在播放，不能重启或直接跳到 123。
  expect(await starts()).toEqual(["0.00", "782.82"]);
  expect(Number(await counter.textContent())).toBeGreaterThan(201);
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  await expect(counter).toHaveText("123.00");
  expect(await starts()).toEqual(["0.00", "782.82", "201.00"]);
});

test("高频行情每两秒合并，动画完成后从旧值过渡且相同金额不重播", async ({ page, request }, testInfo) => {
  await request.post("/test-doubles/valuation?scenario=longbridge-cash");
  await installQuoteStream(page);
  await loginAsOwner(page);
  await page.goto("/assets");
  const counter = page.getByTestId("assets-source-total-source-longbridge-cash")
    .locator('[data-vibe-component="live-counter"]');
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  const updates = await counter.evaluate(async (element) => {
    const times: number[] = [];
    const statesBeforeUpdate: string[] = [];
    const observer = new MutationObserver(() => { times.push(performance.now()); });
    observer.observe(element, { attributes: true, attributeFilter: ["data-counter-target"] });
    const emit = (window as unknown as { emitQuote(price: string, timestamp?: number): void }).emitQuote;
    for (let i = 0; i < 50; i++) {
      if (i === 18 || i === 38) statesBeforeUpdate.push((element as HTMLElement).dataset.counterState ?? "");
      emit(String(123 + i), 1790038800 + i);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    observer.disconnect();
    return { times, statesBeforeUpdate };
  });
  expect(updates.times).toHaveLength(2);
  expect(updates.times[1] - updates.times[0]).toBeGreaterThanOrEqual(1_900);
  expect(updates.statesBeforeUpdate).toEqual(["complete", "complete"]);
  await expect(counter).toHaveAttribute("data-counter-target", "854.82");
  await expect(counter).toHaveAttribute("data-counter-state", "running", { timeout: 100 });
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  await expect(counter).toHaveText("854.82");
  const starts = () => counter.evaluate((element) =>
    (window as unknown as { counterStarts: WeakMap<Element, string[]> }).counterStarts.get(element) ?? [],
  );
  const before = await starts();
  expect(before).toHaveLength(4);
  expect(before[0]).toBe("0.00");
  expect(before.slice(1)).not.toContain("0.00");
  await emitQuote(page, "172", 1790038900);
  await page.waitForTimeout(2_200);
  expect(await starts()).toEqual(before);
  await page.getByTestId("assets-source-totals").screenshot({ path: testInfo.outputPath("realtime-totals.png") });
});

test("来源详情持续接收行情且乱序消息不回退价格", async ({ page, request }, testInfo) => {
  await request.post("/test-doubles/valuation?scenario=longbridge-cash");
  await installQuoteStream(page);
  await loginAsOwner(page);
  await page.goto("/asset-sources/source-longbridge-cash");
  const total = page.getByTestId("asset-source-total");
  await expect(total).toBeVisible();
  await total.scrollIntoViewIfNeeded();
  await emitQuote(page, "123");
  await expect(total).toContainText("805.82", { timeout: 5_000 });
  await emitQuote(page, "124", 1790038802);
  await emitQuote(page, "100", 1790038801);
  await expect(total).toContainText("806.82", { timeout: 5_000 });
  await page.waitForTimeout(600);
  await expect(total).toContainText("806.82");
  await expect(total.locator('[data-vibe-component="live-counter"]')).toHaveAttribute("data-counter-state", "complete");
  await page.getByTestId("longbridge-card").screenshot({ path: testInfo.outputPath("realtime-detail.png") });
  await page.getByRole("link", { name: "资产与持仓", exact: true }).click();
  await expect(page.getByTestId("assets-holdings-workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { activeQuoteStreams(): number }).activeQuoteStreams(),
  )).toBe(1);
  await emitQuote(page, "125", 1790038803);
  await expect(page.getByTestId("assets-source-total-source-longbridge-cash")).toContainText("807.82", { timeout: 5_000 });
});

for (const path of ["/", "/performance", "/assets", "/asset-sources/source-longbridge-cash"]) {
  test("长桥 CLI 未登录时明确提示登录并提供重新检测：" + path, async ({
    page,
    request,
  }) => {
    const configured = await request.post("/test-doubles/valuation?scenario=longbridge-cash");
    expect(configured.ok()).toBeTruthy();

    let streamRequests = 0;
    await page.route("**/api/asset-sources/stream", async (route) => {
      streamRequests++;
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream; charset=utf-8",
        },
        body: [
          "event: ready",
          'data: {"provider":"longbridge","symbols":["AAPL.US"],"mode":"serve"}',
          "",
          "event: stream-status",
          'data: {"state":"error","code":"authentication-required"}',
          "",
          "",
        ].join("\n"),
      });
    });

    await loginAsOwner(page);
    await page.goto(path);

    const notice = page.locator(".assets-holdings__realtime-notice");
    await expect(notice).toContainText("未检测到当前电脑的 Longbridge CLI 登录状态");
    await expect(notice).toContainText("longbridge auth login");
    const retry = notice.getByRole("button", { name: "重新检测" });
    await expect(retry).toBeVisible();
    const beforeRetry = streamRequests;
    await retry.click();
    await expect.poll(() => streamRequests).toBeGreaterThan(beforeRetry);
    await expect(notice).toContainText("未检测到当前电脑的 Longbridge CLI 登录状态");
  });
}

test("资产摘要保留来源总额，产品覆盖可从来源详情按需查看", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=binance-coverage-partial",
  );
  expect(configured.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsOwner(page);
  await page.goto("/assets");

  const source = page.getByTestId("assets-source-total-source-binance-partial");
  await expect(source).toContainText("17,165.10 USD");
  await expect(source.getByText("产品覆盖", { exact: true })).toHaveCount(0);
  await source.getByRole("link").click();
  await expect(page).toHaveURL(/\/asset-sources\/source-binance-partial$/);

  const coverage = page.getByTestId("binance-product-coverage");
  await expect(coverage).toBeVisible();
  const panel = coverage.locator(".vibe-coverage-panel");
  await expect(panel).toBeHidden();
  await coverage.locator("summary").click();
  await expect(panel).toContainText("Smart Arbitrage");
  await expect(page.getByTestId("binance-coverage-status")).toContainText("Trading Bots");
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

for (const [path, totalId] of [["/", "overview-current-total"], ["/performance", "performance-current-total"], ["/asset-sources/source-longbridge-cash", "asset-source-total"]]) {
  test("各页当前资产按真实 serve 时间更新且拒绝旧行情：" + path, async ({ page, request }, testInfo) => {
    await request.post("/test-doubles/valuation?scenario=longbridge-cash");
    await page.route("**/api/asset-sources/refresh", route => route.fulfill({
      json: { successCount: 0, failureCount: 0, skipped: "not-due", attemptedAt: new Date().toISOString() },
    }));
    await installQuoteStream(page);
    await loginAsOwner(page);
    if (path !== "/") await page.goto(path);
    const total = page.getByTestId(totalId);
    const counter = total.locator('[data-vibe-component="live-counter"]');
    await total.scrollIntoViewIfNeeded();
    await expect(counter).toHaveAttribute("data-counter-state", "complete");
    await expect(counter).toHaveAttribute("data-counter-target", "782.82");
    for (const [session, price, time, expected] of [
      ["Pre", "123", "2026-09-22T13:00:00Z", "805.82"],
      ["Intraday", "124", "2026-09-22T20:00:00Z", "806.82"],
      ["Post", "125", "2026-09-22T21:00:00Z", "807.82"],
      ["Overnight", "126", "2026-09-23T01:00:00Z", "808.82"],
    ]) {
      await emitQuote(page, price, time, session);
      await emitQuote(page, "1", "2026-09-22T01:00:00Z", "Intraday");
      await expect(counter).toHaveAttribute("data-counter-target", expected, { timeout: 5_000 });
      await expect(counter).toHaveAttribute("data-counter-state", "complete");
      await expect(counter).toHaveText(expected);
    }
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { activeQuoteStreams(): number }).activeQuoteStreams(),
    )).toBe(1);
    await total.screenshot({ path: testInfo.outputPath("realtime-current-total.png") });
    // Reload with no new push: live projection must not have overwritten the stored snapshot.
    await page.reload();
    await expect(page.getByTestId(totalId).locator('[data-vibe-component="live-counter"]'))
      .toHaveAttribute("data-counter-target", "782.82");
  });
}
