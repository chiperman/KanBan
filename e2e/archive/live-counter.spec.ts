import { expect, test, type Page } from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
});

test("资产数字复用 44 Live Counter 并保留财务格式", async ({ page }) => {
  await loginAsOwner(page);

  const total = page
    .getByTestId("overview-current-total")
    .locator('[data-vibe-component="live-counter"]');
  await expect(total).toHaveAttribute("data-vibe-component", "live-counter");
  await expect(total).toHaveAttribute("data-counter-target", "142,548.00");
  await expect(total).toHaveAttribute("data-counter-state", "complete");
  await expect(total).toHaveText("142,548.00");
  await expect(total).toHaveAccessibleName("142,548.00");

  await page.getByRole("link", { name: "查看 长桥账户 的资产明细" }).click();
  const sourceTotal = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-source-total")
    .locator('[data-vibe-component="live-counter"]');
  await expect(sourceTotal).toHaveAttribute(
    "data-counter-target",
    "100,000.00",
  );
  await expect(sourceTotal).toHaveText("100,000.00");
  await sourceTotal.scrollIntoViewIfNeeded();
  await expect(sourceTotal).toHaveAttribute("data-counter-state", "complete");
  await expect(sourceTotal).toHaveText("100,000.00");
  await expect(sourceTotal).toHaveAccessibleName("100,000.00");
});

test("减少动态效果时直接显示最终数字", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginAsOwner(page);

  const total = page
    .getByTestId("overview-current-total")
    .locator('[data-vibe-component="live-counter"]');
  await expect(total).toHaveAttribute("data-counter-state", "complete");
  await expect(total).toHaveText("142,548.00");

  await page.getByRole("link", { name: "查看 长桥账户 的资产明细" }).click();
  const sourceTotal = page.getByTestId("asset-source-total")
    .locator('[data-vibe-component="live-counter"]');
  await sourceTotal.scrollIntoViewIfNeeded();
  await expect(sourceTotal).toHaveAttribute("data-counter-state", "complete", { timeout: 100 });
  await expect(sourceTotal).toHaveText("100,000.00");
});
