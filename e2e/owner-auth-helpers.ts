import { expect, type CDPSession, type Page } from "@playwright/test";

/** e2e 所有者登录助手：集中虚拟 Passkey 注册与会话建立，确保各 spec 认证路径一致。 */

type CredentiallessFlow = "register" | "login";

async function virtualPasskey(page: Page): Promise<{ client: CDPSession; authenticatorId: string }> {
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

/**
 * 在已附加虚拟 Passkey 的页面上重新挂载一个不含凭据的验证器，
 * 用于验证「设备上没有已注册凭据」这条分支。
 */
export async function replaceWithCredentiallessPasskey(page: Page): Promise<void> {
  const { client, authenticatorId } = await virtualPasskey(page);
  await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
}

export async function attachPasskey(page: Page): Promise<{ client: CDPSession; authenticatorId: string }> {
  return virtualPasskey(page);
}

/**
 * 注册所有者 Passkey（幂等：`/setup` 已预置时跳过创建）。
 * @param flow `register` 走创建按钮，`login` 断言已预置。
 */
export async function setupOwnerPasskey(page: Page, flow: CredentiallessFlow = "register"): Promise<void> {
  await page.goto("/setup");
  if (flow === "login") {
    await expect(page.getByRole("status")).toContainText("预置完成");
    return;
  }
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");
}

/**
 * 用测试会话 test-double 建立所有者会话，跳过浏览器端 Passkey 交互。
 * @param path 登录后进入的路径，默认工作台首页。
 */
export async function loginAsOwnerBySession(page: Page, path = "/"): Promise<void> {
  const response = await page.request.post("/test-doubles/owner-session");
  expect(response.ok()).toBeTruthy();
  await page.goto(path);
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

/**
 * 以虚拟 Passkey 注册并登录所有者。
 * @param waitForTestId 登录后要可见的根容器，默认 `workbench-shell`；显式传 `null` 跳过等待。
 * @param captureVerification 返回登录校验响应以便断言状态码。
 */
export async function loginAsOwner(
  page: Page,
  options: {
    waitForTestId?: string | null;
    captureVerification?: boolean;
  } = {},
): Promise<{ verification?: Awaited<ReturnType<Page["waitForResponse"]>> }> {
  await attachPasskey(page);
  await setupOwnerPasskey(page);
  await page.goto("/");
  const waitForTestId = options.waitForTestId === undefined
    ? "workbench-shell"
    : options.waitForTestId;
  if (options.captureVerification) {
    const [verification] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/api/auth/login/verify"),
      ),
      page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
    ]);
    expect(verification.ok()).toBeTruthy();
    if (waitForTestId) {
      await expect(page.getByTestId(waitForTestId)).toBeVisible();
    }
    return { verification };
  }
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  if (waitForTestId) {
    await expect(page.getByTestId(waitForTestId)).toBeVisible();
  }
  return {};
}
