import { test, expect } from "@playwright/test";
import { PROD_BASE_URL } from "../../playwright.config";

const REPLACEABLE_DOUBLES = [
  "clock",
  "assetSources",
  "assetSynchronization",
  "dailyAssetSnapshots",
  "prices",
  "auth",
  "secrets",
] as const;

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("测试环境可以替换时间、资产来源、价格、身份认证和安全存储", async ({
  request,
}) => {
  const response = await request.get("/test-doubles/context");
  expect(response.ok()).toBeTruthy();

  const context = await response.json();
  expect(context.env).toBe("test");
  for (const name of REPLACEABLE_DOUBLES) {
    expect(context.doubles[name], `缺少可替换的 ${name}`).toBeTruthy();
  }
});

test("热更新后会替换缺少新增生命周期方法的缓存服务", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/context");

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    supportsEvmTokenPreferences: true,
    supportsFiveDayTrend: true,
  });
});

test("热更新后会替换缺少五日走势读取方法的缓存服务", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/context", {
    data: { staleContract: "longbridge-holding-candlesticks" },
  });

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    supportsEvmTokenPreferences: true,
    supportsFiveDayTrend: true,
  });
});

test("重置测试状态撤销旧会话且允许重新创建所有者会话", async ({ request }) => {
  const activity = "/api/auth/session/activity";
  expect((await request.post(activity)).status()).toBe(401);
  const session = await request.post("/test-doubles/owner-session");
  expect(session.ok()).toBeTruthy();
  expect(session.headers()["set-cookie"]).toMatch(/^pad_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
  expect((await request.post(activity)).ok()).toBeTruthy();
  expect((await request.post("/test-doubles/reset")).ok()).toBeTruthy();
  expect((await request.post(activity)).status()).toBe(401);
  expect((await request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
  expect((await request.post(activity)).ok()).toBeTruthy();
});

test.describe("本地时区时钟", () => {
  test.use({ timezoneId: "America/New_York" });

  test("资产看板登录页显示浏览器当前的当地时间", async ({ page, request }) => {
    await request.post("/test-doubles/clock", {
      data: { now: "2030-01-02T03:04:00.000Z" },
    });
    await page.clock.install({ time: new Date("2026-07-27T18:53:00.000Z") });

    await page.goto("/");

    const localTime = page.getByTestId("local-time");
    const headerTime = localTime.locator("strong");
    await expect(localTime).toContainText("NEW YORK /");
    await expect(localTime).toHaveAttribute("data-time-zone", "America/New_York");
    await expect(headerTime).toContainText("14:53");
    await expect(headerTime).toHaveCSS("font-size", "12px");
    await expect(headerTime).toHaveCSS("font-weight", "400");
  });
});

test("生产运行不暴露测试替身", async ({ playwright }) => {
  const prodRequest = await playwright.request.newContext({
    baseURL: PROD_BASE_URL,
  });

  expect((await prodRequest.get("/test-doubles/context")).status()).toBe(404);
  expect((await prodRequest.get("/test-doubles/asset-cards")).status()).toBe(404);
  expect((await prodRequest.post("/test-doubles/reset")).status()).toBe(404);
  const ownerSession = await prodRequest.post("/test-doubles/owner-session");
  expect(ownerSession.status()).toBe(404);
  expect(ownerSession.headers()["set-cookie"]).toBeUndefined();
  expect(
    (
      await prodRequest.post("/test-doubles/asset-cards", {
        data: { assetCards: [] },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await prodRequest.post("/test-doubles/clock", {
        data: { now: "2030-01-02T03:04:00.000Z" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await prodRequest.post("/test-doubles/longbridge", {
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect((await prodRequest.get("/test-doubles/longbridge")).status()).toBe(404);
  expect(
    (await prodRequest.get("/test-doubles/longbridge/authorize")).status(),
  ).toBe(404);
  expect(
    (await prodRequest.post("/test-doubles/longbridge/production-start")).status(),
  ).toBe(404);
  expect(
    (await prodRequest.post("/test-doubles/longbridge/persistence")).status(),
  ).toBe(404);
  expect(
    (
      await prodRequest.post(
        "/test-doubles/local-data-file-permissions?action=first-create",
      )
    ).status(),
  ).toBe(404);
  expect(
    (await prodRequest.post("/test-doubles/valuation")).status(),
  ).toBe(404);
  expect(
    (await prodRequest.post("/test-doubles/refresh")).status(),
  ).toBe(404);
  expect((await prodRequest.get("/test-doubles/refresh")).status()).toBe(404);
  expect(
    (await prodRequest.post("/test-doubles/daily-snapshots")).status(),
  ).toBe(404);
  expect(
    (await prodRequest.get("/test-doubles/daily-snapshots")).status(),
  ).toBe(404);
  expect(
    (
      await prodRequest.post("/test-doubles/release-acceptance", {
        data: { action: "seed" },
      })
    ).status(),
  ).toBe(404);

  await prodRequest.dispose();
});
