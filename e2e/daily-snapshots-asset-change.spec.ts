import {
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Page,
} from "@playwright/test";

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
  await unlockAsOwner(page);
}

async function unlockAsOwner(page: Page): Promise<void> {

  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function configure(request: APIRequestContext) {
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  expect(response.ok()).toBeTruthy();
}

async function setServerTime(request: APIRequestContext, iso: string) {
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-time", iso },
  });
  expect(response.ok()).toBeTruthy();
}

async function history(request: APIRequestContext) {
  const response = await request.get("/test-doubles/daily-snapshots");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    days: Array<{
      day: string;
      capturedAt: string;
      complete: boolean;
      total: { USD: string | null; CNY: string | null };
      sources: Array<{
        sourceId: string;
        capturedAt: string;
        complete: boolean;
        total: { USD: string | null; CNY: string | null };
      }>;
    }>;
  };
}

async function manualRefresh(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/asset-sources/refresh") &&
      candidate.request().method() === "POST",
    ),
    page.getByRole("button", { name: "立即刷新资产" }).click(),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("北京时间日界线建立唯一基准，同日幂等且跨日不回填", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  await expect(page.getByTestId("today-asset-change")).toContainText(
    "今日资产变动",
  );
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+0.00 USD",
  );
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "04月01日",
  );
  await expect(page.getByTestId("asset-source-trend-source-alpha")).toContainText(
    "04月01日",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
  ]);
  expect((await history(request)).days[0].total.CNY).toBe("2174.4");
  await page.getByLabel("计价货币").selectOption("CNY");
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+0.00 CNY",
  );
  await page.getByLabel("计价货币").selectOption("USD");
  const persistence = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "production-persistence" },
  });
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    first: true,
    duplicate: false,
    count: 1,
    capturedAt: "2026-04-01T15:59:50.000Z",
  });

  await manualRefresh(page);
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+2.00 USD",
  );
  expect((await history(request)).days).toHaveLength(1);

  await setServerTime(request, "2026-04-01T16:00:00.000Z");
  await manualRefresh(page);
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+0.00 USD",
  );
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "04月02日",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
  ]);

  await manualRefresh(page);
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+2.00 USD",
  );
  expect((await history(request)).days).toHaveLength(2);

  await setServerTime(request, "2026-04-03T16:00:00.000Z");
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "fail-all" },
  });
  await page.reload();
  await unlockAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "2 个来源失败",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
  ]);

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "recover" },
  });
  await manualRefresh(page);
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
    "2026-04-04",
  ]);

  const content = await page.locator("body").innerText();
  expect(content).toContain("今日资产变动");
  expect(content).not.toContain("当日盈亏");
  expect(content).not.toContain("投资收益");
});

test("未估值趋势不伪造零值，平台盈亏只出现在来源提供的范围", async ({
  page,
  request,
}) => {
  await configure(request);
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "add-unvalued-source" },
  });
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  const snapshot = await history(request);
  const unvalued = snapshot.days[0].sources.find(
    ({ sourceId }) => sourceId === "source-unvalued",
  );
  expect(unvalued).toMatchObject({
    complete: false,
    total: { USD: null, CNY: null },
  });
  await expect(page.getByTestId("total-asset-trend")).toContainText("不完整");
  await expect(
    page.getByTestId("asset-source-trend-source-unvalued"),
  ).toContainText("未估值");

});

test("来源确认的首次可信快照先建基准，随后刷新全失败也不会丢失", async ({
  page,
  request,
}) => {
  const connected = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "connect-before-failed-refresh" },
  });
  expect(connected.ok()).toBeTruthy();
  expect((await history(request)).days).toMatchObject([{
    day: "2026-04-01",
    total: { USD: "88" },
  }]);

  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成 · 1 个来源失败",
  );
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "+0.00 USD",
  );
  await expect(page.getByTestId("today-asset-change")).toContainText(
    "数据不完整",
  );
  expect((await history(request)).days).toHaveLength(1);
});

test("同日新增来源从首次成功同步开始加入来源趋势但不改写总基准", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );
  const original = (await history(request)).days[0];

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "add-unvalued-source" },
  });
  await manualRefresh(page);
  const updated = (await history(request)).days;
  expect(updated).toHaveLength(1);
  expect(updated[0].total).toEqual(original.total);
  expect(updated[0].capturedAt).toBe(original.capturedAt);
  expect(updated[0].sources.find(({ sourceId }) =>
    sourceId === "source-unvalued",
  )).toMatchObject({
    capturedAt: "2026-04-01T15:59:50.000Z",
    complete: false,
    total: { USD: null, CNY: null },
  });
});

test("未认证状态收不到日快照、今日变动或来源趋势", async ({ page, request }) => {
  await configure(request);
  await page.goto("/");
  const content = await page.locator("body").innerText();
  for (const privateText of [
    "今日资产变动",
    "资产趋势",
    "04月01日",
    "Alpha Securities",
  ]) {
    expect(content).not.toContain(privateText);
  }
  expect((await page.content())).not.toContain("dailySnapshots");
});
