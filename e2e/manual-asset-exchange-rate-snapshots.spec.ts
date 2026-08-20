import { expect, test } from "@playwright/test";

test("同日更新 CNY 手工资产不改写首笔日初快照，趋势保留最新折算", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/manual-assets", {
    data: { action: "sqlite-same-day-cny-observation" },
  });
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    baseline: { USD: "14000", CNY: "100000", HKD: "109200" },
    trend: { USD: "15120", CNY: "108000", HKD: "117936" },
  });
});
