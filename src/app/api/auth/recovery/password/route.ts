import { recoveryPendingCookieHeader } from "@/server/auth/cookies";
import {
  decryptRecoverySecret,
  normalizeRecoveryEmail,
  verifyRecoveryPassword,
} from "@/server/auth/recovery";
import {
  claimRecoveryPasswordAttempt,
  clearRecoveryPasswordFailures,
  createPendingRecovery,
} from "@/server/auth/session";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    email = normalizeRecoveryEmail(body.email);
    if (typeof body.password === "string") password = body.password;
  } catch {
    // 与错误凭证使用同一响应，避免枚举恢复邮箱。
  }

  const credential = await services.ownerRecoveryCredentials.get();
  const now = services.clock.now();
  const attempt = claimRecoveryPasswordAttempt(now);
  if (attempt === "password-limited") {
    return Response.json({ error: "恢复认证尝试过多，请稍后重试" }, { status: 429 });
  }
  if (attempt === "totp-limited") {
    return Response.json({ error: "TOTP 尝试过多，请稍后重试" }, { status: 429 });
  }

  const passwordMatches = credential
    ? verifyRecoveryPassword(
        password,
        credential.passwordSalt,
        credential.passwordHash,
      )
    : false;
  if (!credential || email !== credential.email || !passwordMatches) {
    return Response.json({ error: "恢复邮箱或密码错误" }, { status: 401 });
  }

  const totpSecret = decryptRecoverySecret(password, credential);
  if (!totpSecret) {
    return Response.json({ error: "恢复邮箱或密码错误" }, { status: 401 });
  }
  clearRecoveryPasswordFailures();
  const token = createPendingRecovery("owner", totpSecret, now);
  return Response.json(
    { totpRequired: true },
    { headers: { "Set-Cookie": recoveryPendingCookieHeader(token) } },
  );
}
