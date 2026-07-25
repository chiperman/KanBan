import {
  clearRecoveryPendingCookieHeader,
  readCookie,
  sessionCookieHeader,
} from "@/server/auth/cookies";
import { verifyTotp } from "@/server/auth/recovery";
import {
  RECOVERY_PENDING_COOKIE,
  canAttemptRecoveryTotp,
  completeRecoveryTotpAttempt,
  createSession,
  lookupPendingRecovery,
} from "@/server/auth/session";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  const now = services.clock.now();
  const pendingToken = readCookie(request, RECOVERY_PENDING_COOKIE);
  const pending = pendingToken
    ? lookupPendingRecovery(pendingToken, now)
    : null;
  if (!pending || !canAttemptRecoveryTotp(now)) {
    return Response.json(
      { error: "恢复验证已过期，请重新开始" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { code?: unknown }
    | null;
  const accepted = completeRecoveryTotpAttempt(
    pendingToken!,
    verifyTotp(pending.totpSecret, body?.code, now),
    now,
  );
  if (!accepted) {
    return Response.json({ error: "TOTP 验证失败" }, { status: 401 });
  }

  const sessionToken = createSession(accepted.ownerId, now);
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookieHeader(sessionToken));
  headers.append("Set-Cookie", clearRecoveryPendingCookieHeader());
  return Response.json({ ok: true }, { headers });
}
