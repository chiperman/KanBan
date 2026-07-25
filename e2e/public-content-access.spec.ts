import { expect, test, type CDPSession, type Page } from "@playwright/test";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

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
  await unlockViaRestrictedCard(page);
}

async function unlockViaRestrictedCard(page: Page): Promise<void> {
  await page
    .getByTestId("restricted-card")
    .first()
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

const FIXED_CARDS = [
  {
    id: "identity",
    kind: "identity",
    avatarUrl: "https://example.com/old-avatar.png",
    nickname: "旧昵称",
    introduction: "旧介绍",
    span: 2,
    access: "private",
  },
  {
    id: "now",
    kind: "now",
    content: "旧动态",
    span: 1,
    access: "private",
  },
  {
    id: "links",
    kind: "links",
    links: [{ label: "旧链接", url: "https://example.com/old" }],
    span: 1,
    access: "private",
  },
] as const;

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const response = await request.post("/test-doubles/cards", {
    data: { cards: FIXED_CARDS },
  });
  expect(response.ok()).toBeTruthy();
});

test("所有者可编辑身份、Now 与链接卡片，访客只看到已发布内容且没有编辑入口", async ({
  page,
}) => {
  await loginAsOwner(page);

  const identity = page.getByTestId("card").filter({ hasText: "旧昵称" });
  await identity.getByRole("button", { name: "编辑身份卡片" }).click();
  await page.getByLabel("头像 URL").fill("https://example.com/new-avatar.png");
  await page.getByLabel("昵称").fill("新昵称");
  await page.getByLabel("一句话介绍").fill("新的公开介绍");
  await page.getByRole("button", { name: "保存身份卡片" }).click();
  await expect(page.getByTestId("card").filter({ hasText: "新昵称" })).toBeVisible();

  const now = page.getByTestId("card").filter({ hasText: "旧动态" });
  await now.getByRole("button", { name: "编辑 Now 卡片" }).click();
  await page.getByLabel("Now 内容").fill("正在制作个人终端");
  await page.getByRole("button", { name: "保存 Now 卡片" }).click();

  const links = page.getByTestId("card").filter({ hasText: "旧链接" });
  await links.getByRole("button", { name: "编辑链接卡片" }).click();
  await page.getByLabel("链接名称 1").fill("作品集");
  await page.getByLabel("链接地址 1").fill("https://example.com/portfolio");
  await page.getByRole("button", { name: "保存链接卡片" }).click();

  for (const name of ["发布身份卡片", "发布 Now 卡片", "发布链接卡片"]) {
    await page.getByRole("button", { name }).click();
  }

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByText("新昵称")).toBeVisible();
  await expect(page.getByText("新的公开介绍")).toBeVisible();
  await expect(page.getByRole("img", { name: "新昵称的头像" })).toHaveAttribute(
    "src",
    "https://example.com/new-avatar.png",
  );
  await expect(page.getByText("正在制作个人终端")).toBeVisible();
  await expect(page.getByRole("link", { name: "作品集" })).toHaveAttribute(
    "href",
    "https://example.com/portfolio",
  );
  await expect(page.getByRole("button", { name: /编辑|发布|删除|转为私密/ })).toHaveCount(0);
});

test("Markdown 卡片默认私密，只有主动发布才向访客显示，转回私密后立即收回", async ({
  page,
}) => {
  await loginAsOwner(page);

  await page.getByRole("button", { name: "新建 Markdown 卡片" }).click();
  await page.getByLabel("标题").fill("私密创作笔记");
  await page
    .getByLabel("Markdown 正文")
    .fill("## 今日进度\n完成 **访问隔离**。\n\n- 安全占位\n- 主动发布");
  await page.getByRole("button", { name: "保存 Markdown 卡片" }).click();

  const privateCard = page
    .getByTestId("card")
    .filter({ hasText: "私密创作笔记" });
  await expect(privateCard).toContainText("私密");

  const visitorResponses: string[] = [];
  page.on("response", (response) => {
    void response
      .text()
      .then((body) => visitorResponses.push(body))
      .catch(() => undefined);
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  expect(await page.content()).not.toContain("私密创作笔记");
  expect(await page.content()).not.toContain("访问隔离");
  await page.waitForTimeout(100);
  expect(visitorResponses.join("\n")).not.toContain("私密创作笔记");
  expect(visitorResponses.join("\n")).not.toContain("访问隔离");

  await unlockViaRestrictedCard(page);
  await page
    .getByTestId("card")
    .filter({ hasText: "私密创作笔记" })
    .getByRole("button", { name: "发布 Markdown 卡片" })
    .click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByRole("heading", { name: "今日进度" })).toBeVisible();
  await expect(page.getByText("访问隔离")).toBeVisible();
  await expect(page.getByText("主动发布")).toBeVisible();

  await unlockViaRestrictedCard(page);
  await page
    .getByTestId("card")
    .filter({ hasText: "私密创作笔记" })
    .getByRole("button", { name: "转为私密 Markdown 卡片" })
    .click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  expect(await page.content()).not.toContain("私密创作笔记");
  expect(await page.content()).not.toContain("访问隔离");
});

test("所有者可编辑并删除 Markdown 自定义卡片", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("button", { name: "新建 Markdown 卡片" }).click();
  await page.getByLabel("标题").fill("待修改");
  await page.getByLabel("Markdown 正文").fill("旧正文");
  await page.getByRole("button", { name: "保存 Markdown 卡片" }).click();

  const card = page.getByTestId("card").filter({ hasText: "待修改" });
  await card.getByRole("button", { name: "编辑 Markdown 卡片" }).click();
  await page.getByLabel("标题").fill("已修改");
  await page.getByLabel("Markdown 正文").fill("新正文");
  await page.getByRole("button", { name: "保存 Markdown 卡片" }).click();
  const edited = page.getByTestId("card").filter({ hasText: "已修改" });
  await expect(edited).toContainText("新正文");

  page.once("dialog", (dialog) => dialog.accept());
  await edited.getByRole("button", { name: "删除 Markdown 卡片" }).click();
  await expect(page.getByText("已修改")).toHaveCount(0);
});

test("资产卡片在界面与服务端都不能被发布", async ({ page, request }) => {
  const response = await request.post("/test-doubles/cards", {
    data: {
      cards: [
        ...FIXED_CARDS,
        {
          id: "assets",
          kind: "asset",
          title: "SENSITIVE-ASSET-TITLE",
          body: "SENSITIVE-ASSET-BODY-9988",
          span: 2,
          access: "private",
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  await loginAsOwner(page);

  const asset = page
    .getByTestId("card")
    .filter({ hasText: "SENSITIVE-ASSET-TITLE" });
  await expect(asset).toContainText("资产卡片不可发布");
  await expect(asset.getByRole("button", { name: /发布|访问级别/ })).toHaveCount(0);

  const ownerAttempt = await page.evaluate(async () => {
    const result = await fetch("/api/cards/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: "public" }),
    });
    return { status: result.status, body: await result.text() };
  });
  expect(ownerAttempt.status).toBe(400);
  expect(ownerAttempt.body).toContain("资产卡片始终为私密");

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  expect(await page.content()).not.toContain("SENSITIVE-ASSET-TITLE");
  expect(await page.content()).not.toContain("SENSITIVE-ASSET-BODY-9988");

  const visitorAttempt = await page.evaluate(async () =>
    fetch("/api/cards/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: "public" }),
    }).then((result) => result.status),
  );
  expect(visitorAttempt).toBe(401);
});

test("Ticket 02 的旧持久化卡片可安全升级且受限内容保持私密", async ({
  page,
  request,
}) => {
  const response = await request.post("/test-doubles/cards", {
    data: {
      cards: [
        {
          id: "identity",
          title: "身份",
          body: "旧数据中的公开介绍",
          span: 1,
          access: "public",
        },
        {
          id: "demo-assets",
          title: "LEGACY-SENSITIVE-TITLE",
          body: "LEGACY-SENSITIVE-BODY-1234",
          span: 2,
          access: "restricted",
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByText("旧数据中的公开介绍")).toBeVisible();
  await expect(page.getByTestId("restricted-card")).toHaveCount(1);
  expect(await page.content()).not.toContain("LEGACY-SENSITIVE-TITLE");
  expect(await page.content()).not.toContain("LEGACY-SENSITIVE-BODY-1234");
});
