import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { issueChallenge } from "@/server/auth/challenges";
import { CHALLENGE_COOKIE } from "@/server/auth/session";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { getServices } from "@/server/composition";
import { challengeCookieHeader, readCookie, relyingParty } from "@/server/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * 所有者 Passkey 绑定：首次预置（既无 Passkey 也无 TOTP）允许匿名初始化，
 * 其余状态仅对已登录所有者开放，用于重新绑定或恢复，不提供公开注册。
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  const ownerCredential = await services.ownerCredentials.get();
  const recoveryCredential = await services.ownerRecoveryCredentials.get();
  if (
    (ownerCredential !== null || recoveryCredential !== null) &&
    (await services.auth.currentSession()) === null
  ) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const { rpID, origin } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: "个人终端",
    rpID,
    userName: "owner",
    userDisplayName: "所有者",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const token = issueChallenge({ purpose: "register", rpID, origin, credentialId: null }, options.challenge, readCookie(request, CHALLENGE_COOKIE), services.clock.now());
  return Response.json(options, {
    headers: { "Set-Cookie": challengeCookieHeader(token) },
  });
}
