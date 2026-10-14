import { expect, test } from "@playwright/test";

const CARDS = [
  { id: "first", kind: "asset", title: "保留布局一", body: "旧布局事实", span: 1 },
  { id: "second", kind: "asset", title: "保留布局二", body: "旧布局事实", span: 2 },
  { id: "third", kind: "asset", title: "保留布局三", body: "旧布局事实", span: 3 },
];

test.beforeEach(async ({ request }) => {
  expect((await request.post("/test-doubles/reset")).ok()).toBeTruthy();
  expect((await request.post("/test-doubles/asset-cards", {
    data: { assetCards: CARDS },
  })).ok()).toBeTruthy();
});

test("保留的布局接口要求所有者身份，排序、宽度、换行和隐藏仍可往返", async ({ page }) => {
  const cards = [
    { id: "third", span: 2, hidden: true, startsNewRow: true },
    { id: "first", span: 3 },
    { id: "second", span: 1 },
  ];
  const denied = await page.request.put("/api/asset-cards/layout", { data: { cards } });
  expect(denied.status()).toBe(401);
  expect((await page.request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
  const saved = await page.request.put("/api/asset-cards/layout", { data: { cards } });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/");
  await page.reload();
  await expect(page.getByRole("button", { name: /布局管理|拖动.*调整排序/ })).toHaveCount(0);
  const state = await page.request.get("/test-doubles/asset-cards");
  expect(state.ok()).toBeTruthy();
  await expect(state.json()).resolves.toEqual({ assetCards: [
    { ...CARDS[2], span: 2, hidden: true, startsNewRow: true },
    { ...CARDS[0], span: 3 },
    { ...CARDS[1], span: 1 },
  ] });
});

test("非法布局写入不改变已有元数据", async ({ request }) => {
  expect((await request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
  for (const cards of [
    [{ id: "first", span: 1 }],
    [{ id: "first", span: 1 }, { id: "first", span: 2 }, { id: "third", span: 3 }],
    [{ id: "unknown", span: 1 }, { id: "second", span: 2 }, { id: "third", span: 3 }],
    [{ id: "first", span: 4 }, { id: "second", span: 2 }, { id: "third", span: 3 }],
  ]) {
    expect((await request.put("/api/asset-cards/layout", { data: { cards } })).status()).toBe(400);
    const state = await request.get("/test-doubles/asset-cards");
    expect(state.ok()).toBeTruthy();
    await expect(state.json()).resolves.toEqual({ assetCards: CARDS });
  }
});
