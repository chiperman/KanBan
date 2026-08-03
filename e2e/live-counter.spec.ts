import { expect, test, type Page } from "@playwright/test";

async function loginAsOwner(page: Page): Promise<void> {
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
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

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
    .getByTestId("total-asset-amount")
    .locator('[data-vibe-component="live-counter"]');
  await expect(total).toHaveAttribute("data-vibe-component", "live-counter");
  await expect(total).toHaveAttribute("data-counter-target", "142,548.00");
  await expect(total).toHaveAttribute("data-counter-state", "complete");
  await expect(total).toHaveText("142,548.00");
  await expect(total).toHaveAccessibleName("142,548.00");

  const sourceTotal = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-source-total")
    .locator('[data-vibe-component="live-counter"]');
  await expect(sourceTotal).toHaveAttribute(
    "data-counter-target",
    "100,000.00",
  );
  await expect(sourceTotal).toHaveAttribute("data-counter-state", "waiting");
  await expect(sourceTotal).toHaveText("100,000.00");
  await sourceTotal.scrollIntoViewIfNeeded();
  await expect(sourceTotal).toHaveAttribute("data-counter-state", "running");
  await expect(sourceTotal).toHaveAttribute("data-counter-state", "complete");
  await expect(sourceTotal).toHaveText("100,000.00");
});

test("减少动态效果时直接显示最终数字", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginAsOwner(page);

  const total = page
    .getByTestId("total-asset-amount")
    .locator('[data-vibe-component="live-counter"]');
  await expect(total).toHaveAttribute("data-counter-state", "complete");
  await expect(total).toHaveText("142,548.00");
});

test("拖拽预览中的资产金额保持静态", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await loginAsOwner(page);

  const sourceCard = page.getByTestId("longbridge-card");
  const initialLayoutCard = sourceCard.locator("..");
  const layoutCardId = await initialLayoutCard.getAttribute("data-layout-card-id");
  expect(layoutCardId).not.toBeNull();
  const layoutCard = page.locator(`[data-layout-card-id="${layoutCardId}"]`);
  const originalCounter = sourceCard
    .getByTestId("asset-source-total")
    .locator('[data-vibe-component="live-counter"]');
  const expectedAmount = await originalCounter.getAttribute(
    "data-counter-target",
  );
  expect(expectedAmount).not.toBeNull();
  const handle = layoutCard.getByRole("button", {
    name: "拖动长桥资产调整排序",
  });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 8,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(layoutCard).toHaveClass(/card-dragging/);

  const dragOverlay = page.getByTestId("card-drag-overlay");
  await expect(dragOverlay).toBeVisible();
  const previewCounter = dragOverlay
    .getByTestId("asset-source-total")
    .locator('[data-vibe-component="live-counter"]');
  expect(await previewCounter.getAttribute("data-counter-state")).toBe(
    "complete",
  );
  await expect(previewCounter).toHaveText(expectedAmount!);

  await page.mouse.up();
});
