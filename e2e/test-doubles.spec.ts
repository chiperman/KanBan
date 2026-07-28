import { test, expect } from "@playwright/test";
import { PROD_BASE_URL } from "../playwright.config";

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

test("资产看板登录页显示浏览器当前的上海时间", async ({ page, request }) => {
  await request.post("/test-doubles/clock", {
    data: { now: "2030-01-02T03:04:00.000Z" },
  });
  await page.clock.install({ time: new Date("2026-07-27T18:53:00.000Z") });

  await page.goto("/");

  await expect(page.locator(".locked-clock > strong")).toContainText("02:53");
  await expect(page.getByTestId("server-time")).not.toContainText("UTC+08");
});

test("生产运行不暴露测试替身", async ({ playwright }) => {
  const prodRequest = await playwright.request.newContext({
    baseURL: PROD_BASE_URL,
  });

  expect((await prodRequest.get("/test-doubles/context")).status()).toBe(404);
  expect((await prodRequest.post("/test-doubles/reset")).status()).toBe(404);
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
