import { expect, test, type CDPSession, type Page } from "@playwright/test";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

const CARDS = [
  {
    id: "wide",
    kind: "asset",
    title: "宽卡片",
    body: "桌面三格内容",
    span: 3,
  },
  {
    id: "mid",
    kind: "asset",
    title: "中卡片",
    body: "桌面两格内容",
    span: 2,
  },
  {
    id: "narrow",
    kind: "asset",
    title: "窄卡片",
    body: "桌面一格内容",
    span: 1,
  },
  {
    id: "long",
    kind: "asset",
    title: "长内容卡片",
    body:
      "第一段内容。\n\n第二段内容用于证明高度跟随内容。\n\n- 项目一\n- 项目二\n- 项目三",
    span: 1,
  },
] as const;

const ROW_BREAK_CARDS = [
  { id: "first", kind: "asset", title: "第一张卡片", body: "第一列", span: 1 },
  { id: "second", kind: "asset", title: "第二张卡片", body: "第二列", span: 1 },
  { id: "third", kind: "asset", title: "第三张卡片", body: "第三列", span: 1 },
  { id: "fourth", kind: "asset", title: "第四张卡片", body: "第二行第一列", span: 1 },
  { id: "fifth", kind: "asset", title: "第五张卡片", body: "应从第三行开始", span: 3 },
] as const;

async function attachPasskey(page: Page): Promise<VirtualPasskey> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = (await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    },
  )) as { authenticatorId: string };
  return { client, authenticatorId };
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function enterLayoutMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: "进入布局管理" }).click();
  await expect(
    page.getByRole("button", { name: "退出布局管理" }),
  ).toBeVisible();
}

async function pointerDrag(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
}

async function resizeCard(
  page: Page,
  card: ReturnType<Page["locator"]>,
  deltaColumns: number,
): Promise<void> {
  const handle = card.getByRole("button", { name: /调整.*宽度/ });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const gridBox = await page.getByTestId("card-grid").boundingBox();
  expect(handleBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  const columnStep = (gridBox!.width + 16) / 3;
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await expect(card).toHaveClass(/card-resizing/);
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + columnStep * deltaColumns,
    handleBox!.y + handleBox!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
}

async function reorderCard(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
): Promise<void> {
  const handle = source.getByRole("button", { name: /拖动.*调整排序/ });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 6,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(source).toHaveClass(/card-dragging/);
  await page.mouse.move(targetBox!.x + 4, targetBox!.y + targetBox!.height / 2, {
    steps: 8,
  });
  await expect(page.getByTestId("layout-drop-slot")).toBeVisible();
  await page.mouse.up();
}

async function touchReorderCard(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
): Promise<void> {
  const handle = source.getByRole("button", { name: /拖动.*调整排序/ });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const client = await page.context().newCDPSession(page);
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  const end = {
    x: targetBox!.x + 4,
    y: targetBox!.y + targetBox!.height / 2,
  };
  const point = (x: number, y: number) => ({
    x,
    y,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  });

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(start.x, start.y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(start.x + 6, start.y)],
  });
  await expect(source).toHaveClass(/card-dragging/);
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point(
          start.x + (end.x - start.x) * progress,
          start.y + (end.y - start.y) * progress,
        ),
      ],
    });
  }
  await expect(page.getByTestId("layout-drop-slot")).toBeVisible();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function reorderCardToNewRow(
  page: Page,
  source: ReturnType<Page["locator"]>,
): Promise<void> {
  const handle = source.getByRole("button", { name: /拖动.*调整排序/ });
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const sourceBox = await source.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 6,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(source).toHaveClass(/card-dragging/);
  const endTarget = page.locator('[data-candidate-kind="new-row"]').last();
  await expect(endTarget).toBeVisible();
  const endTargetBox = await endTarget.boundingBox();
  expect(endTargetBox).not.toBeNull();
  await page.mouse.move(
    endTargetBox!.x + endTargetBox!.width / 2,
    endTargetBox!.y + endTargetBox!.height / 2,
    { steps: 8 },
  );
  await expect(page.getByTestId("layout-drop-slot")).toBeVisible();
  await page.mouse.up();
}

test("三格资产卡片可缩小并放入两格卡片右侧空位", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "mid", kind: "asset", title: "两格卡片", body: "左侧内容", span: 2 },
        { id: "wide", kind: "asset", title: "三格卡片", body: "待放入空位", span: 3 },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const source = page.getByTestId("card").filter({ hasText: "三格卡片" });
  const target = page.getByTestId("card").filter({ hasText: "两格卡片" });
  const handle = source.getByRole("button", { name: /拖动三格卡片调整排序/ });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 6,
    handleBox!.y + handleBox!.height / 2,
  );

  const candidate = page.locator(
    '[data-candidate-kind="fill-gap"][data-candidate-span="1"][data-candidate-column="2"]',
  );
  await expect(candidate).toBeVisible();
  const candidateBox = await candidate.boundingBox();
  expect(candidateBox).not.toBeNull();
  await page.mouse.move(
    candidateBox!.x + candidateBox!.width / 2,
    candidateBox!.y + candidateBox!.height / 2,
    { steps: 6 },
  );
  const active = page.getByTestId("layout-drop-slot");
  await expect(active).toContainText("SPAN 3 → 1 · COL 3");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await page.mouse.up();
  await saved;

  await expect(source).toHaveClass(/span-1/);
  expect(Math.abs((await source.boundingBox())!.y - (await target.boundingBox())!.y)).toBeLessThanOrEqual(2);
  await page.reload();
  await expect(source).toHaveClass(/span-1/);
});

test("同一行候选使用互不重叠的固定命中区域", async ({ page, request }) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "anchor", kind: "asset", title: "锚点卡片", body: "一格", span: 1 },
        { id: "dragged", kind: "asset", title: "待移动卡片", body: "两格", span: 2 },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const source = page.locator('[data-layout-card-id="dragged"]');
  const handle = source.getByRole("button", { name: "拖动待移动卡片调整排序" });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 18, handleBox!.y + 10);
  await expect(source).toHaveClass(/card-dragging/);

  const rowTargets = page.locator(
    '[data-candidate-id][data-candidate-row="0"]',
  );
  await expect(rowTargets).toHaveCount(2);
  const boxes = await rowTargets.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    }),
  );
  const horizontalOverlap = Math.min(boxes[0].right, boxes[1].right) -
    Math.max(boxes[0].left, boxes[1].left);
  const verticalOverlap = Math.min(boxes[0].bottom, boxes[1].bottom) -
    Math.max(boxes[0].top, boxes[1].top);
  expect(Math.min(horizontalOverlap, verticalOverlap)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
});

test("拖动经过插入位置时兄弟资产卡片会在松手前实时让位", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "first", kind: "asset", title: "第一张卡片", body: "一格", span: 1 },
        { id: "second", kind: "asset", title: "第二张卡片", body: "两格", span: 2 },
        { id: "third", kind: "asset", title: "第三张卡片", body: "一格", span: 1 },
        { id: "fourth", kind: "asset", title: "第四张卡片", body: "一格", span: 1 },
        { id: "fifth", kind: "asset", title: "第五张卡片", body: "一格", span: 1 },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const source = page.locator('[data-layout-card-id="first"]');
  const second = page.locator('[data-layout-card-id="second"]');
  const fourth = page.locator('[data-layout-card-id="fourth"]');
  const handle = source.getByRole("button", {
    name: "拖动第一张卡片调整排序",
  });
  const handleBox = await handle.boundingBox();
  const secondBefore = await second.boundingBox();
  const fourthBox = await fourth.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(secondBefore).not.toBeNull();
  expect(fourthBox).not.toBeNull();

  let saveCount = 0;
  page.on("request", (layoutRequest) => {
    if (
      layoutRequest.url().endsWith("/api/asset-cards/layout") &&
      layoutRequest.method() === "PUT"
    ) {
      saveCount += 1;
    }
  });

  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 8,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(source).toHaveClass(/card-dragging/);
  await page.mouse.move(
    fourthBox!.x + fourthBox!.width / 2,
    fourthBox!.y + fourthBox!.height / 2,
    { steps: 8 },
  );
  const dropSlot = page.getByTestId("layout-drop-slot");
  const activeCandidate = page.locator(".card-drop-candidate.is-active");
  const dragOverlay = page.getByTestId("card-drag-overlay");
  await expect(dropSlot).toBeVisible();
  await expect(activeCandidate).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(activeCandidate).toHaveCSS(
    "border-top-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(dropSlot).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(dragOverlay).toHaveCSS("opacity", "1");

  await expect.poll(async () => (await second.boundingBox())!.x).toBeLessThan(
    secondBefore!.x - 100,
  );
  expect(saveCount).toBe(0);

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
  );
  await page.mouse.up();
  await saved;
  expect(saveCount).toBe(1);
});

test("向左拖动首次进入左侧插入位置时兄弟卡片平滑向右让位", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "first", kind: "asset", title: "第一张卡片", body: "一格", span: 1 },
        { id: "second", kind: "asset", title: "第二张卡片", body: "一格", span: 1 },
        { id: "third", kind: "asset", title: "第三张卡片", body: "一格", span: 1 },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);
  await page.reload();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await enterLayoutMode(page);

  const first = page.locator('[data-layout-card-id="first"]');
  const source = page.locator('[data-layout-card-id="third"]');
  const handle = source.getByRole("button", {
    name: "拖动第三张卡片调整排序",
  });
  await handle.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const handleBox = await handle.boundingBox();
  const firstBox = await first.boundingBox();
  const secondBox = await page
    .locator('[data-layout-card-id="second"]')
    .boundingBox();
  expect(handleBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();

  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 8,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(source).toHaveClass(/card-dragging/);
  await page.mouse.move(
    firstBox!.x + 4,
    firstBox!.y + firstBox!.height / 2,
    { steps: 1 },
  );
  await expect(page.getByTestId("layout-drop-slot")).toBeVisible();
  await page.waitForTimeout(40);
  const firstYieldFrame = await first.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      offsetLeft: (element as HTMLElement).offsetLeft,
      transform: window.getComputedStyle(element).transform,
      animations: element.getAnimations().map((animation) => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
      })),
    };
  });
  expect(firstYieldFrame.offsetLeft).toBeGreaterThan(firstBox!.x);
  expect(firstYieldFrame.left).toBeGreaterThan(firstBox!.x + 8);
  expect(firstYieldFrame.left).toBeLessThan(secondBox!.x - 8);
  expect(firstYieldFrame.transform).not.toBe("none");
  expect(firstYieldFrame.animations).toEqual([
    expect.objectContaining({
      playState: "running",
      currentTime: expect.any(Number),
    }),
  ]);

  await page.keyboard.press("Escape");
});

test("Escape 取消网格放置且不保存布局", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await loginAsOwner(page);
  await enterLayoutMode(page);
  const source = page.getByTestId("card").filter({ hasText: "宽卡片" });
  const handle = source.getByRole("button", { name: /拖动宽卡片调整排序/ });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  let saveCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/asset-cards/layout") && request.method() === "PUT") {
      saveCount += 1;
    }
  });
  await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 18, handleBox!.y + 10);
  await expect(source).toHaveClass(/card-dragging/);
  await expect(page.locator("[data-candidate-id]")).not.toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(source).not.toHaveClass(/card-dragging/);
  await expect(page.locator("[data-candidate-id]")).toHaveCount(0);
  expect(saveCount).toBe(0);
});

test("键盘可以选择与指针相同的自适应缩小候选", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "mid", kind: "asset", title: "两格卡片", body: "左侧内容", span: 2 },
        { id: "wide", kind: "asset", title: "三格卡片", body: "待放入空位", span: 3 },
      ],
    },
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await loginAsOwner(page);
  await enterLayoutMode(page);
  const source = page.getByTestId("card").filter({ hasText: "三格卡片" });
  const handle = source.getByRole("button", { name: /拖动三格卡片调整排序/ });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(source).toHaveClass(/card-dragging/);
  const candidates = page.locator("[data-candidate-id]");
  await expect(candidates).not.toHaveCount(0);
  await candidates.first().evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("layout-drop-slot")).toContainText("SPAN 3 → 1 · COL 3");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await page.keyboard.press("Enter");
  await saved;
  await expect(source).toHaveClass(/span-1/);
});

test("布局保存失败时恢复拖动前布局", async ({ page, request }) => {
  await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "mid", kind: "asset", title: "两格卡片", body: "左侧内容", span: 2 },
        { id: "wide", kind: "asset", title: "三格卡片", body: "待放入空位", span: 3 },
      ],
    },
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await loginAsOwner(page);
  await enterLayoutMode(page);
  await page.route("**/api/asset-cards/layout", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"测试失败"}' });
  });
  const source = page.getByTestId("card").filter({ hasText: "三格卡片" });
  const handle = source.getByRole("button", { name: /拖动三格卡片调整排序/ });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 18, handleBox!.y + 10);
  const candidate = page.locator(
    '[data-candidate-kind="fill-gap"][data-candidate-span="1"][data-candidate-column="2"]',
  );
  await expect(candidate).toBeVisible();
  const candidateBox = await candidate.boundingBox();
  await page.mouse.move(candidateBox!.x + candidateBox!.width / 2, candidateBox!.y + candidateBox!.height / 2);
  await page.mouse.up();

  await expect(page.locator(".content-error")).toContainText("布局保存失败，已恢复原布局");
  await expect(source).toHaveClass(/span-3/);
});

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const response = await request.post("/test-doubles/asset-cards", {
    data: { assetCards: CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("拖拽说明 ID 在首次渲染和刷新后保持稳定", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("hydrated but some attributes")
    ) {
      hydrationErrors.push(message.text());
    }
  });

  await loginAsOwner(page);
  await enterLayoutMode(page);

  const dragHandles = page.getByRole("button", { name: /拖动.*调整排序/ });
  await expect(dragHandles.first()).toHaveAttribute(
    "aria-describedby",
    "asset-card-layout-dnd",
  );
  await expect(page.locator("#asset-card-layout-dnd")).toHaveCount(1);

  await page.reload();
  await enterLayoutMode(page);

  await expect(dragHandles.first()).toHaveAttribute(
    "aria-describedby",
    "asset-card-layout-dnd",
  );
  await expect(page.locator("#asset-card-layout-dnd")).toHaveCount(1);
  expect(hydrationErrors).toEqual([]);
});

test("未认证状态不能调整布局，所有者进入布局管理后可排序并调整资产卡片宽度", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "编辑布局" })).toHaveCount(0);
  await expect(page.locator(".layout-span-control select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /调整.*宽度/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /拖动.*调整排序/ })).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await expect(page.getByTestId("card")).toHaveCount(0);

  const visitorAttempt = await page.evaluate(
    async (cards) =>
      fetch("/api/asset-cards/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards }),
      }).then((response) => response.status),
    CARDS.map(({ id, span }) => ({ id, span })),
  );
  expect(visitorAttempt).toBe(401);

  await loginAsOwner(page);
  await expect(page.getByRole("button", { name: "进入布局管理" })).toBeVisible();
  await expect(page.locator(".layout-span-control select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /调整.*宽度/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /拖动.*调整排序/ })).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await enterLayoutMode(page);
  await expect(page.getByRole("button", { name: /调整.*宽度/ })).toHaveCount(CARDS.length);
  await expect(page.getByRole("button", { name: /拖动.*调整排序/ })).toHaveCount(CARDS.length);
  const savedResize = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeCard(page, page.getByTestId("card").filter({ hasText: "窄卡片" }), 1);
  await savedResize;
  await expect(page.getByTestId("card").filter({ hasText: "窄卡片" })).toHaveClass(/span-2/);
  await page.reload();
  await expect(page.getByTestId("card").filter({ hasText: "窄卡片" })).toHaveClass(/span-2/);
  expect(
    await page.getByTestId("card").first().evaluate(
      (card) => window.getComputedStyle(card, "::before").content,
    ),
  ).toBe("none");
});

test("旧高度数据不会撑大资产卡片，卡片高度始终跟随内容", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        {
          ...CARDS[2],
          minHeight: 960,
        },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const card = page.getByTestId("card").filter({ hasText: "窄卡片" });
  expect(await card.evaluate((element) => element.style.minHeight)).toBe("");
  const autoHeight = (await card.boundingBox())!.height;
  expect(autoHeight).toBeLessThan(400);
  const resizeHandle = card.getByRole("button", {
    name: "调整窄卡片宽度，当前宽度 1 格；可拖动或使用左右方向键",
  });
  await resizeHandle.press("ArrowDown");
  expect((await card.boundingBox())!.height).toBe(autoHeight);
});

test("所有者通过卡片手柄排序并调整宽度后刷新仍保留布局", async ({
  page,
}) => {
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const wide = page.getByTestId("card").filter({ hasText: "宽卡片" });
  const narrow = page.getByTestId("card").filter({ hasText: "窄卡片" });
  const mid = page.getByTestId("card").filter({ hasText: "中卡片" });
  const savedReorder = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await reorderCard(page, narrow, wide);
  await savedReorder;
  await page.waitForTimeout(200);

  const savedNarrow = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeCard(page, narrow, 1);
  await savedNarrow;
  const savedWide = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeCard(page, wide, -2);
  await savedWide;
  const savedMid = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeCard(page, mid, 1);
  await savedMid;
  await expect(page.getByTestId("card").first()).toContainText("窄卡片");
  await page.reload();
  await expect(page.getByTestId("card").nth(0)).toContainText("窄卡片");
  await expect(page.getByTestId("card").nth(1)).toContainText("宽卡片");
  await expect(page.getByTestId("card").nth(2)).toContainText("中卡片");

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);
});

test("资产卡片调整为三格并移动时激活预览框覆盖完整占用范围", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await loginAsOwner(page);

  const grid = page.getByTestId("card-grid");
  const card = page.getByTestId("longbridge-card").locator("..");
  const gridBox = await grid.boundingBox();
  expect(gridBox).not.toBeNull();
  const columnGap = await grid.evaluate((element) =>
    Number.parseFloat(window.getComputedStyle(element).columnGap),
  );
  const columnStep = (gridBox!.width + columnGap) / 3;
  const columnWidth = (gridBox!.width - columnGap * 2) / 3;

  async function resizeToNextSpan(expectedSpan: 2 | 3, expectedWidth: number) {
    const resizeHandle = card.getByRole("button", { name: /调整.*宽度/ });
    await resizeHandle.scrollIntoViewIfNeeded();
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    const hitClass = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class"),
      {
        x: handleBox!.x + handleBox!.width / 2,
        y: handleBox!.y + handleBox!.height / 2,
      },
    );
    expect(hitClass).toContain("layout-resize-handle");
    const savedResize = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/asset-cards/layout") &&
        response.request().method() === "PUT",
    );
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await expect(card).toHaveClass(/card-resizing/);
    await expect(page.getByTestId("layout-resize-preview")).toBeVisible();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2 + columnStep,
      handleBox!.y + handleBox!.height / 2,
      { steps: 5 },
    );

    const resizePreview = page.getByTestId("layout-resize-preview");
    const resizePreviewBox = await resizePreview.boundingBox();
    expect(resizePreviewBox).not.toBeNull();
    expect(Math.abs(resizePreviewBox!.width - expectedWidth)).toBeLessThanOrEqual(2);
    await expect(resizePreview).toHaveCSS("outline-color", "rgb(0, 0, 0)");
    await expect(resizePreview).toHaveAttribute("data-vibe-state", "resize-preview");
    await page.mouse.up();
    await savedResize;

    await expect(card).toHaveClass(new RegExp(`span-${expectedSpan}`));
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(Math.abs(cardBox!.width - expectedWidth)).toBeLessThanOrEqual(2);
    await card.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
  }

  await resizeToNextSpan(2, columnWidth * 2 + columnGap);
  await resizeToNextSpan(3, gridBox!.width);
  const resizedCardBox = await card.boundingBox();
  expect(resizedCardBox).not.toBeNull();
  expect(Math.abs(resizedCardBox!.width - gridBox!.width)).toBeLessThanOrEqual(2);

  const dragHandle = card.getByRole("button", { name: /拖动.*调整排序/ });
  await dragHandle.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await expect(dragHandle).toBeEnabled();
  const dragHandleBox = await dragHandle.boundingBox();
  const target = page.getByTestId("binance-card").locator("..");
  const targetBox = await target.boundingBox();
  expect(dragHandleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    dragHandleBox!.x + dragHandleBox!.width / 2,
    dragHandleBox!.y + dragHandleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragHandleBox!.x + dragHandleBox!.width / 2 + 6,
    dragHandleBox!.y + dragHandleBox!.height / 2,
  );
  await expect(
    page.locator("[data-layout-card-id].card-dragging"),
  ).toHaveCount(1);
  await page.mouse.move(targetBox!.x + 4, targetBox!.y + targetBox!.height / 2, {
    steps: 8,
  });
  const dropSlot = page.getByTestId("layout-drop-slot");
  await expect(dropSlot).toBeVisible();
  await expect(dropSlot).toHaveClass(/span-3/);
  const dropSlotBox = await dropSlot.boundingBox();
  expect(dropSlotBox).not.toBeNull();
  expect(Math.abs(dropSlotBox!.width - gridBox!.width)).toBeLessThanOrEqual(2);
  await expect.poll(async () => {
    const currentBox = await dropSlot.boundingBox();
    return Math.abs(currentBox!.height - resizedCardBox!.height);
  }).toBeLessThanOrEqual(2);
  await expect(dropSlot).toHaveCSS("outline-color", "rgb(0, 0, 0)");
  await expect(dropSlot).toHaveAttribute("data-vibe-state", "drop-preview");
  await page.mouse.up();
});

test("所有者拖至末尾会强制从新行开始并在刷新后保留", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: { assetCards: ROW_BREAK_CARDS },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await loginAsOwner(page);
  await enterLayoutMode(page);
  const fifth = page.getByTestId("card").filter({ hasText: "第五张卡片" });
  const savedReorder = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await reorderCardToNewRow(page, fifth);
  await savedReorder;
  const fourth = page.getByTestId("card").filter({ hasText: "第四张卡片" });
  const gridBox = await page.getByTestId("card-grid").boundingBox();
  expect(gridBox).not.toBeNull();
  await expect(fifth).toHaveClass(/starts-new-row/);
  await expect(fifth).toHaveClass(/span-3/);
  expect(Math.abs((await fifth.boundingBox())!.width - gridBox!.width)).toBeLessThanOrEqual(2);
  expect((await fifth.boundingBox())!.y).toBeGreaterThan((await fourth.boundingBox())!.y);
  await page.reload();
  await expect(fifth).toHaveClass(/starts-new-row/);
  await expect(fifth).toHaveClass(/span-3/);
  expect(Math.abs((await fifth.boundingBox())!.width - gridBox!.width)).toBeLessThanOrEqual(2);
  expect((await fifth.boundingBox())!.y).toBeGreaterThan((await fourth.boundingBox())!.y);
});

test("拖动末尾 Web3 ETH 卡片时新行预览紧接最后一张可见卡片", async ({
  page,
  request,
}) => {
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [
        { id: "cash", kind: "asset", title: "现金", body: "短卡片", span: 1 },
        {
          id: "stocks",
          kind: "asset",
          title: "证券",
          body:
            "较高卡片包含更多持仓明细，用于形成真实的不等高布局。" +
            "这段内容会在一格宽度内自然换行，不依赖测试直接改写元素高度。" +
            "持仓覆盖美国市场、香港市场、现金与期权观察项，并保留同步时间、估值来源与完整性说明。" +
            "继续增加可见内容，确保第一行轨道显著高于后续仅含摘要的新行。",
          span: 1,
        },
        { id: "funds", kind: "asset", title: "基金", body: "中等卡片", span: 1 },
        {
          id: "web3-btc",
          kind: "asset",
          title: "Web3 BTC",
          body: "最后一张非拖动卡片",
          span: 3,
        },
        {
          id: "web3-eth",
          kind: "asset",
          title: "Web3 ETH",
          body: "已经独占新行",
          span: 3,
        },
      ],
    },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const grid = page.getByTestId("card-grid");
  const cards = page.locator("[data-layout-card-id]");
  await expect.poll(async () =>
    new Set(
      await cards.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      ),
    ).size
  ).toBeGreaterThan(1);

  const dragged = page.locator('[data-layout-card-id="web3-eth"]');
  const lastVisible = page.locator('[data-layout-card-id="web3-btc"]');
  const handle = dragged.getByRole("button", {
    name: /拖动Web3 ETH调整排序/,
  });
  const before = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const gridBox = element.getBoundingClientRect();
    const draggedBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-eth"]')!
      .getBoundingClientRect();
    const lastVisibleBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-btc"]')!
      .getBoundingClientRect();
    return {
      grid: {
        height: gridBox.height,
        minHeight: style.minHeight,
        gridAutoRows: style.gridAutoRows,
        gridTemplateColumns: style.gridTemplateColumns,
        gridTemplateRows: style.gridTemplateRows,
        rowGap: Number.parseFloat(style.rowGap),
      },
      dragged: {
        top: draggedBox.top,
        bottom: draggedBox.bottom,
        height: draggedBox.height,
      },
      lastVisible: {
        top: lastVisibleBox.top,
        bottom: lastVisibleBox.bottom,
        height: lastVisibleBox.height,
      },
    };
  });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 6,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(dragged).toHaveClass(/card-dragging/);

  const newRowTarget = page.locator(
    '[data-testid="card-drop-candidate"][data-candidate-kind="new-row"]',
  );
  await expect(newRowTarget).toHaveCount(1);
  const targetBox = await newRowTarget.boundingBox();
  expect(targetBox).not.toBeNull();
  const dragStart = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const gridBox = element.getBoundingClientRect();
    const draggedBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-eth"]')!
      .getBoundingClientRect();
    const lastVisibleBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-btc"]')!
      .getBoundingClientRect();
    const targetBox = element
      .querySelector<HTMLElement>(
        '[data-testid="card-drop-candidate"][data-candidate-kind="new-row"]',
      )!
      .getBoundingClientRect();
    return {
      grid: {
        height: gridBox.height,
        inlineMinHeight: (element as HTMLElement).style.minHeight,
        minHeight: style.minHeight,
        gridAutoRows: style.gridAutoRows,
        gridTemplateRows: style.gridTemplateRows,
        rowGap: Number.parseFloat(style.rowGap),
      },
      dragged: {
        top: draggedBox.top,
        bottom: draggedBox.bottom,
        height: draggedBox.height,
      },
      lastVisible: {
        top: lastVisibleBox.top,
        bottom: lastVisibleBox.bottom,
        height: lastVisibleBox.height,
      },
      target: {
        top: targetBox.top,
        bottom: targetBox.bottom,
        height: targetBox.height,
      },
    };
  });
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
  );
  const preview = page.getByTestId("layout-drop-slot");
  await expect(preview).toHaveAttribute("data-candidate-kind", "new-row");

  const after = await grid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const gridBox = element.getBoundingClientRect();
    const draggedBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-eth"]')!
      .getBoundingClientRect();
    const lastVisibleBox = element
      .querySelector<HTMLElement>('[data-layout-card-id="web3-btc"]')!
      .getBoundingClientRect();
    const targetBox = element
      .querySelector<HTMLElement>(
        '[data-testid="card-drop-candidate"][data-candidate-kind="new-row"]',
      )!
      .getBoundingClientRect();
    const previewBox = element
      .querySelector<HTMLElement>('[data-testid="layout-drop-slot"]')!
      .getBoundingClientRect();
    return {
      grid: {
        height: gridBox.height,
        inlineMinHeight: (element as HTMLElement).style.minHeight,
        minHeight: style.minHeight,
        gridAutoRows: style.gridAutoRows,
        gridTemplateRows: style.gridTemplateRows,
        rowGap: Number.parseFloat(style.rowGap),
      },
      dragged: {
        top: draggedBox.top,
        bottom: draggedBox.bottom,
        height: draggedBox.height,
      },
      lastVisible: {
        top: lastVisibleBox.top,
        bottom: lastVisibleBox.bottom,
        height: lastVisibleBox.height,
      },
      target: {
        top: targetBox.top,
        bottom: targetBox.bottom,
        height: targetBox.height,
      },
      preview: {
        top: previewBox.top,
        bottom: previewBox.bottom,
        height: previewBox.height,
      },
    };
  });
  const expectedTop = after.lastVisible.bottom + after.grid.rowGap;
  expect(before.grid.gridTemplateColumns.trim().split(/\s+/)).toHaveLength(3);
  expect(
    new Set(before.grid.gridTemplateRows.trim().split(/\s+/)).size,
  ).toBeGreaterThan(1);
  expect(before.dragged.top - before.lastVisible.bottom).toBeCloseTo(
    before.grid.rowGap,
    1,
  );
  expect(before.grid.rowGap).toBe(12);
  expect(Math.abs(dragStart.target.top - (dragStart.lastVisible.bottom + dragStart.grid.rowGap))).toBeLessThanOrEqual(2);
  expect(Math.abs(after.target.top - expectedTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.preview.top - expectedTop)).toBeLessThanOrEqual(2);

  await page.keyboard.press("Escape");
  await expect(dragged).not.toHaveClass(/card-dragging/);
});

test("卡片较多时可从视口顶部拖到页面底部新行", async ({ page, request }) => {
  const manyCards = Array.from({ length: 18 }, (_, index) => ({
    id: `card-${index + 1}`,
    kind: "asset",
    title: `资产卡片 ${index + 1}`,
    body: `第 ${index + 1} 张卡片`,
    span: 1,
  }));
  const fixture = await request.post("/test-doubles/asset-cards", {
    data: { assetCards: manyCards },
  });
  expect(fixture.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);
  await enterLayoutMode(page);

  const source = page.locator('[data-layout-card-id="card-1"]');
  const handle = source.getByRole("button", { name: /拖动资产卡片 1调整排序/ });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 18, handleBox!.y + 10);
  await expect(source).toHaveClass(/card-dragging/);

  const startScrollY = await page.evaluate(() => window.scrollY);
  for (let index = 0; index < 12; index += 1) {
    await page.mouse.move(640, 892);
    await page.waitForTimeout(40);
  }
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(startScrollY);
  const newRow = page
    .locator('.card-drop-candidate[data-candidate-kind="new-row"]')
    .last();
  await expect(newRow).toHaveCount(1);
  const newRowBox = await newRow.boundingBox();
  expect(newRowBox).not.toBeNull();
  expect(newRowBox!.y).toBeLessThan(900);
  const newRowDocumentY = await newRow.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.y + window.scrollY;
  });
  await page.mouse.move(
    newRowBox!.x + newRowBox!.width / 2,
    newRowBox!.y + newRowBox!.height / 2,
  );
  await expect(page.getByTestId("layout-drop-slot")).toHaveAttribute(
    "data-candidate-kind",
    "new-row",
  );
  await page.waitForTimeout(100);
  const activeNewRowBox = await newRow.boundingBox();
  expect(activeNewRowBox).not.toBeNull();
  const activeNewRowDocumentY = await newRow.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.y + window.scrollY;
  });
  expect(
    Math.abs(activeNewRowDocumentY - newRowDocumentY),
  ).toBeLessThanOrEqual(2);
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await page.mouse.up();
  await saved;

  const cards = page.getByTestId("card");
  await expect(cards.last()).toContainText("资产卡片 1");
  await expect(cards.last()).toHaveClass(/starts-new-row/);
});

test("桌面端不展示移动排序入口且不存在全局展开控制", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);

  await expect(
    page.getByRole("button", { name: "调整卡片顺序" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全部展开" })).toHaveCount(0);
});

test("手机端默认展示卡片摘要并可按需展开完整内容", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const wide = page.locator('[data-layout-card-id="wide"]');
  await expect(wide).toHaveAttribute("data-mobile-expanded", "false");
  await expect(wide.locator(".card-body")).toBeHidden();
  await expect(wide.getByRole("button", { name: "展开宽卡片" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "调整卡片顺序" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "全部展开" })).toHaveCount(0);
  await expect(wide.locator(".layout-resize-handle")).toBeHidden();
  await expect(wide.locator(".layout-drag-handle")).toBeHidden();

  await wide.getByRole("button", { name: "展开宽卡片" }).click();
  await expect(wide).toHaveAttribute("data-mobile-expanded", "true");
  await expect(wide.locator(".card-body")).toBeVisible();
  await expect(wide.locator(".card-body")).toContainText("桌面三格内容");
});

test("手机端调整顺序时以标题行拖动并保留桌面宽度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const wide = page.locator('[data-layout-card-id="wide"]');
  const narrow = page.locator('[data-layout-card-id="narrow"]');
  await wide.getByRole("button", { name: "展开宽卡片" }).click();
  await expect(wide.locator(".card-body")).toBeVisible();

  await page.getByRole("button", { name: "调整卡片顺序" }).click();
  await expect(page.getByRole("button", { name: "完成调整" })).toBeVisible();
  await expect(page.locator('.card[data-mobile-layout-mode="true"]')).toHaveCount(
    CARDS.length,
  );
  await expect(wide.locator(".card-body")).toBeHidden();
  const narrowSortHandle = narrow.getByRole("button", {
    name: "拖动窄卡片调整排序",
  });
  await expect(narrowSortHandle).toBeVisible();
  await expect(narrowSortHandle).toHaveCSS("touch-action", "none");
  await expect(narrow.getByRole("button", { name: "上移窄卡片" })).toBeVisible();
  await expect(narrow.getByRole("button", { name: "下移窄卡片" })).toBeVisible();

  await page.getByRole("button", { name: "完成调整" }).click();
  await expect(page.getByRole("button", { name: "调整卡片顺序" })).toBeVisible();
  await expect(wide.locator(".card-body")).toBeVisible();
  await page.getByRole("button", { name: "调整卡片顺序" }).click();

  const savedReorder = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
  );
  await reorderCard(page, narrow, wide);
  await savedReorder;
  await expect(narrow).not.toHaveClass(/card-dragging/);
  await page.getByRole("button", { name: "完成调整" }).evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.getByTestId("card").first()).toContainText("窄卡片");
  await expect(narrow).toHaveClass(/span-1/);

  await page.getByRole("button", { name: "完成调整" }).click();
  await expect(wide.locator(".card-body")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("card").first()).toContainText("窄卡片");
  await expect(page.locator('[data-layout-card-id="narrow"]')).toHaveClass(/span-1/);
});

test("手机端上移按钮只保存一次并保留桌面宽度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await page.getByRole("button", { name: "调整卡片顺序" }).click();

  let saveCount = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/asset-cards/layout") &&
      request.method() === "PUT"
    ) {
      saveCount += 1;
    }
  });

  const narrow = page.locator('[data-layout-card-id="narrow"]');
  const savedMove = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
  );
  await narrow.getByRole("button", { name: "上移窄卡片" }).click();
  await savedMove;

  await expect
    .poll(async () =>
      page
        .locator("[data-layout-card-id]")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-layout-card-id")),
        ),
    )
    .toEqual(["wide", "narrow", "mid", "long"]);
  expect(saveCount).toBe(1);
  await expect(narrow).toHaveClass(/span-1/);

  await page.reload();
  await expect(page.getByTestId("card").nth(1)).toHaveAttribute(
    "data-layout-card-id",
    "narrow",
  );
  await expect(page.locator('[data-layout-card-id="narrow"]')).toHaveClass(/span-1/);
});

test("手机端可用键盘拖动标题并只保存一次", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await page.getByRole("button", { name: "调整卡片顺序" }).click();

  let saveCount = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/asset-cards/layout") &&
      request.method() === "PUT"
    ) {
      saveCount += 1;
    }
  });

  const wide = page.locator('[data-layout-card-id="wide"]');
  const handle = wide.getByRole("button", {
    name: "拖动宽卡片调整排序",
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(wide).toHaveClass(/card-dragging/);
  await page.locator("[data-candidate-id]").first().evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.keyboard.press("ArrowDown");

  const savedMove = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
  );
  await page.keyboard.press("Enter");
  await savedMove;

  await expect(page.getByTestId("card").first()).not.toHaveAttribute(
    "data-layout-card-id",
    "wide",
  );
  expect(saveCount).toBe(1);
  await expect(wide).toHaveClass(/span-3/);
});

test("手机端可用触摸拖动标题并保留桌面宽度", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await loginAsOwner(page);
    await page.getByRole("button", { name: "调整卡片顺序" }).click();

    const wide = page.locator('[data-layout-card-id="wide"]');
    const narrow = page.locator('[data-layout-card-id="narrow"]');
    const savedMove = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/asset-cards/layout") &&
        response.request().method() === "PUT",
    );
    await touchReorderCard(page, narrow, wide);
    await savedMove;

    await expect(page.getByTestId("card").first()).toHaveAttribute(
      "data-layout-card-id",
      "narrow",
    );
    await expect(narrow).toHaveClass(/span-1/);
  } finally {
    await context.close();
  }
});

test("手机端总资产默认展示分布和趋势", async ({ page, request }) => {
  await request.post("/test-doubles/reset");
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  await expect(page.getByTestId("total-asset-amount")).toBeVisible();
  await expect(page.getByTestId("total-asset-trend")).toBeVisible();
  await expect(page.getByLabel("资产分布")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /总资产详情/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全部展开" })).toHaveCount(0);

  await page.getByRole("button", { name: "进入布局管理" }).click();
  await expect(page.getByTestId("total-asset-trend")).toBeVisible();
});

const VIEWPORTS = [
  { name: "桌面", width: 1280, height: 900 },
  { name: "中等", width: 834, height: 1112 },
  { name: "手机", width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}视口按同一桌面顺序自动重排并保持内容高度`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await loginAsOwner(page);

    const cards = page.getByTestId("card");
    await expect(cards).toHaveCount(CARDS.length);
    const boxes = await cards.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );

    expect(boxes.map(({ y }) => y)).toEqual([...boxes.map(({ y }) => y)].sort((a, b) => a - b));
    if (viewport.name === "桌面") {
      expect(boxes[0].width).toBeGreaterThan(boxes[1].width);
      expect(boxes[1].width).toBeGreaterThan(boxes[2].width);
    } else if (viewport.name === "中等") {
      expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThanOrEqual(1);
      expect(boxes[1].width).toBeGreaterThan(boxes[2].width);
    } else {
      for (const box of boxes.slice(1)) {
        expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);
      }
    }

    if (viewport.name === "手机") {
      expect(boxes.map(({ height }) => height)).toEqual(
        boxes.map(() => boxes[0].height),
      );
    } else {
      expect(boxes[3].height).toBeGreaterThan(boxes[2].height);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
