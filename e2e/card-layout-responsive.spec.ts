import { expect, test, type CDPSession, type Page } from "@playwright/test";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

const CARDS = [
  {
    id: "wide",
    kind: "markdown",
    title: "宽卡片",
    markdown: "桌面三格内容",
    span: 3,
    access: "public",
  },
  {
    id: "mid",
    kind: "markdown",
    title: "中卡片",
    markdown: "桌面两格内容",
    span: 2,
    access: "private",
  },
  {
    id: "narrow",
    kind: "markdown",
    title: "窄卡片",
    markdown: "桌面一格内容",
    span: 1,
    access: "public",
  },
  {
    id: "long",
    kind: "markdown",
    title: "长内容卡片",
    markdown:
      "第一段内容。\n\n第二段内容用于证明高度跟随内容。\n\n- 项目一\n- 项目二\n- 项目三",
    span: 1,
    access: "public",
  },
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
  await page
    .getByTestId("restricted-card")
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
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

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const response = await request.post("/test-doubles/cards", {
    data: { cards: CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("访客不能进入布局编辑模式，所有者正常浏览时也不会误拖动或改宽度", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "编辑布局" })).toHaveCount(0);
  await expect(page.getByLabel(/卡片宽度/)).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await pointerDrag(
    page,
    page.getByTestId("card").filter({ hasText: "窄卡片" }),
    page.getByTestId("card").filter({ hasText: "宽卡片" }),
  );
  await expect(page.locator('[data-testid="card"], [data-testid="restricted-card"]').first()).toContainText("宽卡片");
  await page.reload();
  await expect(page.locator('[data-testid="card"], [data-testid="restricted-card"]').first()).toContainText("宽卡片");

  const visitorAttempt = await page.evaluate(
    async (cards) =>
      fetch("/api/cards/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards }),
      }).then((response) => response.status),
    CARDS.map(({ id, span }) => ({ id, span })),
  );
  expect(visitorAttempt).toBe(401);

  await loginAsOwner(page);
  await expect(page.getByRole("button", { name: "编辑布局" })).toBeVisible();
  await expect(page.getByLabel(/卡片宽度/)).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
  await pointerDrag(
    page,
    page.getByTestId("card").filter({ hasText: "窄卡片" }),
    page.getByTestId("card").filter({ hasText: "宽卡片" }),
  );
  await expect(page.getByTestId("card").first()).toContainText("宽卡片");
  await page.reload();
  await expect(page.getByTestId("card").first()).toContainText("宽卡片");

  await page.getByRole("button", { name: "编辑布局" }).click();
  await expect(page.getByRole("status")).toContainText("布局编辑模式");
  await expect(page.getByLabel(/卡片宽度/)).toHaveCount(CARDS.length);
  await expect(page.locator('[draggable="true"]')).toHaveCount(CARDS.length);

  await page.getByRole("button", { name: "取消布局编辑" }).click();
  await expect(page.getByLabel(/卡片宽度/)).toHaveCount(0);
  await expect(page.locator('[draggable="true"]')).toHaveCount(0);
});

test("所有者拖拽并设置一二三格宽度后，刷新与访客视图保留同一布局", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  await page.getByRole("button", { name: "编辑布局" }).click();

  const wide = page.getByTestId("card").filter({ hasText: "宽卡片" });
  const narrow = page.getByTestId("card").filter({ hasText: "窄卡片" });
  await narrow.dragTo(wide);

  await page.getByLabel("窄卡片宽度").selectOption("2");
  await page.getByLabel("宽卡片宽度").selectOption("1");
  await page.getByLabel("中卡片宽度").selectOption("3");
  await page.getByRole("button", { name: "保存布局" }).click();

  await expect(page.getByRole("button", { name: "编辑布局" })).toBeVisible();
  await expect(page.getByTestId("card").first()).toContainText("窄卡片");
  await page.reload();
  await expect(page.getByTestId("card").nth(0)).toContainText("窄卡片");
  await expect(page.getByTestId("card").nth(1)).toContainText("宽卡片");
  await expect(page.getByTestId("card").nth(2)).toContainText("中卡片");

  const ownerBoxes = await page.getByTestId("card").evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      const grid = card.parentElement!.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y - grid.y,
        width: box.width,
        height: box.height,
      };
    }),
  );

  await page.getByRole("button", { name: "退出登录" }).click();
  const visitorCards = page.locator(
    '[data-testid="card"], [data-testid="restricted-card"]',
  );
  await expect(visitorCards).toHaveCount(CARDS.length);
  await expect(visitorCards.nth(0)).toContainText("窄卡片");
  await expect(visitorCards.nth(1)).toContainText("宽卡片");
  await expect(visitorCards.nth(2)).toHaveAttribute(
    "data-testid",
    "restricted-card",
  );

  const restrictedVisitorBoxes = await visitorCards.evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      const grid = card.parentElement!.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y - grid.y,
        width: box.width,
        height: box.height,
      };
    }),
  );
  for (const [index, visitorBox] of restrictedVisitorBoxes.entries()) {
    expect(visitorBox.x).toBe(ownerBoxes[index].x);
    expect(visitorBox.width).toBe(ownerBoxes[index].width);
  }

  const publishFixture = await request.post("/test-doubles/cards", {
    data: {
      cards: [
        { ...CARDS[2], span: 2 },
        { ...CARDS[0], span: 1 },
        { ...CARDS[1], span: 3, access: "public" },
        CARDS[3],
      ],
    },
  });
  expect(publishFixture.ok()).toBeTruthy();
  await page.reload();
  const publicVisitorBoxes = await page.getByTestId("card").evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      const grid = card.parentElement!.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y - grid.y,
        width: box.width,
        height: box.height,
      };
    }),
  );
  for (const [index, restrictedBox] of restrictedVisitorBoxes.entries()) {
    expect(restrictedBox.x).toBe(publicVisitorBoxes[index].x);
    expect(restrictedBox.width).toBe(publicVisitorBoxes[index].width);
    expect(
      Math.abs(restrictedBox.y - publicVisitorBoxes[index].y),
    ).toBeLessThanOrEqual(48);
  }
  expect(
    Math.abs(
      restrictedVisitorBoxes[2].height - publicVisitorBoxes[2].height,
    ),
  ).toBeLessThanOrEqual(48);
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
    await page.goto("/");

    const cards = page.locator(
      '[data-testid="card"], [data-testid="restricted-card"]',
    );
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

    expect(boxes[3].height).toBeGreaterThan(boxes[2].height);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
