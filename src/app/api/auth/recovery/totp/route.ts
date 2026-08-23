import {
  sessionCookieHeader,
} from "@/server/auth/cookies";
import {
  decryptRecoverySecret,
  matchingTotpCounter,
} from "@/server/auth/recovery";
import {
  canAttemptRecoveryTotp,
  completeRecoveryTotpAttempt,
  createSession,
} from "@/server/auth/session";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function rateLimitedResponse(): Response {
  return Response.json(
    { error: "TOTP 尝试过多，请 5 分钟后重试" },
    { status: 429, headers: { "Retry-After": "300" } },
  );
}

export async function POST(request: Request) {
  const services = getServices();
  const now = services.clock.now();
  const credential = await services.ownerRecoveryCredentials.get();
  const secret = credential ? decryptRecoverySecret(credential) : null;
  if (!secret) {
    return Response.json(
      { error: "TOTP 登录不可用，请使用 Passkey" },
      { status: 401 },
    );
  }
  if (!canAttemptRecoveryTotp(now)) return rateLimitedResponse();

  const body = (await request.json().catch(() => null)) as
    | { code?: unknown }
    | null;
  const counter = matchingTotpCounter(secret, body?.code, now);
  const claimed = counter !== null
    ? await services.ownerRecoveryCredentials.claimTotpCounter(counter)
    : false;
  const accepted = completeRecoveryTotpAttempt(claimed, now);
  if (!accepted) {
    if (!canAttemptRecoveryTotp(now)) return rateLimitedResponse();
    if (counter !== null) {
      return Response.json(
        { error: "该验证码已用于配置或登录，请等待下一组验证码" },
        { status: 409 },
      );
    }
    return Response.json({ error: "TOTP 验证失败" }, { status: 401 });
  }

  const sessionToken = createSession("owner", now);
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookieHeader(sessionToken));
  return Response.json({ ok: true }, { headers });
}
