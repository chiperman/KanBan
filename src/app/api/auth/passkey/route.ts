import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

/** 仅返回所有者可见的配置状态，供响应丢失后核对；不返回凭证内容。 */
export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const [credential, recovery] = await Promise.all([
    services.ownerCredentials.get(),
    services.ownerRecoveryCredentials.get(),
  ]);
  return Response.json({
    configured: credential !== null,
    boundAt: credential?.createdAt ?? null,
    recoveryConfigured: recovery !== null,
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * 移除当前 Passkey：仅限已登录所有者，且必须保留可用的 TOTP 登录，
 * 避免删到既无 Passkey 又无 TOTP 而无法登录。
 */
export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  if ((await services.ownerCredentials.get()) === null) {
    return Response.json({ ok: true });
  }

  if ((await services.ownerRecoveryCredentials.get()) === null) {
    return Response.json(
      { error: "请先配置 TOTP 登录，再移除 Passkey" },
      { status: 409 },
    );
  }

  await services.ownerCredentials.remove();
  return Response.json({ ok: true });
}
