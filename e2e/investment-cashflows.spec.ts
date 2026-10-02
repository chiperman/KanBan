import { expect, test, type CDPSession, type Page } from "@playwright/test";

async function loginAsOwner(page: Page): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/clock", {
    data: { now: "2026-08-09T12:00:00.000Z" },
  });
});

test("USD 历史账本在总览和收益分析按当前汇率切换 CNY、HKD", async ({ page }) => {
  // This regression compares a fixed valuation; live quote updates have separate coverage.
  await page.route("**/api/asset-sources/stream", route => route.fulfill({
    contentType: "text/event-stream",
    body: ": fixed valuation\n\n",
  }));
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-04-01T08:00:00.000Z" },
  });
  await page.request.post("/test-doubles/owner-session");
  const created = await page.request.post("/api/investment-cashflows", {
    data: { kind: "initial-investment", amount: "100", currency: "USD",
      occurredAt: "2026-03-01T00:00:00.000Z", note: null },
  });
  expect(created.status()).toBe(201);
  const before = await (await page.request.get("/api/investment-cashflows")).json();
  expect(before.cashflows[0].amounts).toEqual({ USD: "100", CNY: null, HKD: null });
  await page.request.post("/test-doubles/valuation?scenario=longbridge-cash");
  await page.request.post("/test-doubles/refresh", {
    data: { action: "anchor-full-refresh" },
  });

  for (const [url, netId, profitId] of [
    ["/", "overview-net-investment", "overview-investment-profit"],
    ["/performance", "performance-net-investment", "performance-current-profit"],
  ]) {
    await page.goto(url);
    for (const [currency, net, profit] of [
      ["CNY", "712.34 CNY", "+4,864.00 CNY"],
      ["HKD", "781.25 HKD", "+5,334.53 HKD"],
      ["USD", "100.00 USD", "+682.82 USD"],
    ]) {
      await page.getByRole("button", { name: /^计价货币 / }).click();
      await page.getByRole("option", { name: currency, exact: true }).click();
      await expect(page.getByTestId(netId)).toContainText(net);
      await expect(page.getByTestId(profitId)).toContainText(profit);
      if (currency !== "USD") {
        await expect(page.getByTestId(netId)).toContainText("按当前汇率折算");
        await expect(page.getByTestId(profitId)).toContainText("按当前汇率折算");
      }
    }
  }
  expect(await (await page.request.get("/api/investment-cashflows")).json()).toEqual(before);
});

test("资金账本 API 仅限所有者，并校验、编辑和明确删除资金记录", async ({
  page,
  request,
}) => {
  expect(
    (await request.get("/api/investment-cashflows")).status(),
  ).toBe(401);

  await loginAsOwner(page);

  const invalid = await page.request.post("/api/investment-cashflows", {
    data: {
      kind: "external-deposit",
      occurredAt: "2026-08-03T00:00:00.000Z",
      amount: "-1",
      currency: "USD",
      note: null,
    },
  });
  expect(invalid.status()).toBe(400);

  const created = await page.request.post("/api/investment-cashflows", {
    data: {
      kind: "initial-investment",
      occurredAt: "2026-08-01T00:00:00.000Z",
      amount: "10000",
      currency: "USD",
      note: "起始本金",
    },
  });
  expect(created.status()).toBe(201);
  const createdBody = await created.json() as {
    cashflow: { id: string; amounts: Record<string, string | null> };
  };
  expect(createdBody.cashflow.amounts).toEqual({
    USD: "10000",
    CNY: null,
    HKD: null,
  });

  const id = createdBody.cashflow.id;
  const listed = await page.request.get("/api/investment-cashflows");
  expect(listed.status()).toBe(200);
  const patched = await page.request.patch(
    `/api/investment-cashflows/${id}`,
    { data: { note: "补录后的起始本金" } },
  );
  expect(patched.status()).toBe(200);
  const updated = await page.request.get("/api/investment-cashflows");
  await expect(updated.json()).resolves.toEqual({
    cashflows: [expect.objectContaining({
      id,
      note: "补录后的起始本金",
      amounts: { USD: "10000", CNY: null, HKD: null },
    })],
  });

  const unconfirmedDelete = await page.request.delete(
    `/api/investment-cashflows/${id}`,
    { data: {} },
  );
  expect(unconfirmedDelete.status()).toBe(400);
  const deleted = await page.request.delete(
    `/api/investment-cashflows/${id}`,
    { data: { confirmation: "DELETE_CASHFLOW" } },
  );
  expect(deleted.status()).toBe(200);
  await expect((await page.request.get("/api/investment-cashflows")).json())
    .resolves.toEqual({ cashflows: [] });
});
