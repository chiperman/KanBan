import { test, expect, type Page, type CDPSession } from "@playwright/test";

const SENSITIVE_TITLE = "SENSITIVE-TITLE-总资产";
const SENSITIVE_BODY = "SENSITIVE-BODY-1234567.89";

const CARDS = [
  {
    id: "identity",
    kind: "identity",
    avatarUrl: "",
    nickname: "所有者",
    introduction: "所有者的一句话介绍",
    span: 2,
    access: "public",
  },
  {
    id: "assets",
    kind: "asset",
    title: SENSITIVE_TITLE,
    body: SENSITIVE_BODY,
    span: 2,
    access: "private",
  },
];

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/cards", { data: { cards: CARDS } });
});

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

/** 通过 CDP 挂上虚拟平台认证器，让浏览器走真实 WebAuthn 流程。 */
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

/** 移除当前认证器并换上一台不持有任何凭证的新认证器。 */
async function replaceWithCredentiallessPasskey(
  passkey: VirtualPasskey,
): Promise<void> {
  await passkey.client.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: passkey.authenticatorId,
  });
  await passkey.client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
}

/** 通过 /setup 完成唯一所有者预置（仅此一次，之后注册关闭）。 */
async function provisionOwner(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
}

async function unlockViaRestrictedCard(page: Page) {
  const restricted = page.getByTestId("restricted-card");
  await restricted.getByRole("button", { name: "验证身份后查看" }).click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
}

test("访客看到受限卡片遮罩，页面与网络流量均不含真实敏感数据", async ({
  page,
}) => {
  const bodies: string[] = [];
  page.on("response", (response) => {
    void (async () => {
      try {
        bodies.push(await response.text());
      } catch {
        // 忽略无法读取正文的响应
      }
    })();
  });

  await page.goto("/");

  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByTestId("card")).toHaveCount(1);
  const restricted = page.getByTestId("restricted-card");
  await expect(restricted).toHaveCount(1);
  await expect(restricted).toContainText("受限内容");
  await expect(restricted).not.toContainText(SENSITIVE_TITLE);

  // 未登录 HTML 与序列化页面状态不含敏感信息。
  const html = await page.content();
  expect(html).not.toContain(SENSITIVE_TITLE);
  expect(html).not.toContain(SENSITIVE_BODY);

  // 浏览器网络流量不含敏感信息。
  await page.waitForTimeout(300);
  expect(bodies.join("\n")).not.toContain("SENSITIVE-");
});

test("伪造会话与直接请求私密接口都无法取得敏感信息", async ({
  page,
  request,
}) => {
  // 伪造会话 Cookie：服务端不认可，仍按访客渲染。
  await page.context().addCookies([
    {
      name: "pad_session",
      value: "forged-session-token",
      url: "http://localhost:3101",
    },
  ]);
  await page.goto("/?admin=1");
  await expect(page.getByTestId("restricted-card")).toHaveCount(1);
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);

  // 直接调用登录校验接口：无效断言被拒绝，不下发会话。
  const verifyResponse = await request.post("/api/auth/login/verify", {
    data: { id: "forged", response: {} },
  });
  expect(verifyResponse.status()).toBeGreaterThanOrEqual(400);

  // 登出接口对访客无副作用。
  expect((await request.post("/api/auth/logout")).ok()).toBeTruthy();
});

test("所有者完成预置后可通过受限卡片登录，注册入口随即关闭", async ({
  page,
  request,
}) => {
  await attachPasskey(page);
  await provisionOwner(page);

  // 预置完成后注册永久关闭。
  await page.goto("/setup");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("404");
  expect((await request.post("/api/auth/register/options")).status()).toBe(404);

  // 回到公开主页：仍是访客，点击受限卡片进入登录流程。
  await page.goto("/");
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await unlockViaRestrictedCard(page);

  // 登录成功后在原页面位置看到敏感内容。
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  const unlocked = page.getByTestId("card").filter({
    hasText: SENSITIVE_TITLE,
  });
  await expect(unlocked).toHaveCount(1);
  await expect(unlocked).toContainText(SENSITIVE_BODY);
  await expect(page.getByTestId("restricted-card")).toHaveCount(0);
});

test("登录失败或取消后仍停留在安全的访客状态", async ({ page }) => {
  const passkey = await attachPasskey(page);
  await provisionOwner(page);

  // 移除持有凭证的认证器，换上一台没有该凭证的认证器：断言必然失败。
  await replaceWithCredentiallessPasskey(passkey);

  await page.goto("/");
  await unlockViaRestrictedCard(page);

  await expect(
    page.getByText("验证失败或已取消，仍处于访客状态"),
  ).toBeVisible();
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByTestId("restricted-card")).toHaveCount(1);
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "pad_session")).toBeUndefined();
});

test("所有者退出登录后敏感内容立即恢复为受限卡片", async ({ page }) => {
  await attachPasskey(page);
  await provisionOwner(page);

  await page.goto("/");
  await unlockViaRestrictedCard(page);
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await expect(page.getByTestId("card")).toHaveCount(2);

  await page.getByRole("button", { name: "退出登录" }).click();

  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  await expect(page.getByTestId("restricted-card")).toHaveCount(1);
  expect(await page.content()).not.toContain(SENSITIVE_TITLE);

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "pad_session");
  expect(session === undefined || session.value === "").toBeTruthy();

  // 回退导航不得恢复已验证视图（主页 no-store）。
  await page.goBack();
  expect(await page.content()).not.toContain(SENSITIVE_BODY);

  // 旧会话已销毁：即便 Cookie 残留也无法通过服务端校验。
  await page.goto("/");
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
});
