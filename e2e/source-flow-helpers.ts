import { expect, type Page } from "@playwright/test";

export async function openSourceFlow(page: Page, provider: string): Promise<void> {
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: "新增来源" }).click();
  await expect(page).toHaveURL("/asset-sources/new");
  await page.getByRole("radio", { name: provider, exact: true }).click();
}

export function sourceFlow(page: Page) {
  return page.getByRole("region", { name: "新增资产来源", exact: true });
}

export async function confirmSourceFlow(page: Page, provider: string): Promise<void> {
  await sourceFlow(page).getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", { name: new RegExp(`${provider}.*(?:自动账户|观察钱包)`) }).click();
  await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);
}

export async function expectSourceObservation(page: Page, sourceId: string): Promise<void> {
  const response = await page.request.get("/test-doubles/daily-snapshots");
  expect(response.ok()).toBeTruthy();
  const history = await response.json();
  expect(history.trendObservations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      day: "2026-01-01",
      sources: expect.arrayContaining([expect.objectContaining({ sourceId })]),
    }),
  ]));
}
