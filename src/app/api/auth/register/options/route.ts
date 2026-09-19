import { issueChallenge } from "@/server/auth/challenges";
import { CHALLENGE_COOKIE } from "@/server/auth/session";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { getServices } from "@/server/composition";
import { challengeCookieHeader, readCookie, relyingParty } from "@/server/auth/cookies";

export const dynamic = "force-dynamic";

/** 所有者预置：仅当系统尚无凭证时开放一次，不提供公开注册。 */
export async function POST(request: Request) {
  const services = getServices();
  if ((await services.ownerCredentials.get()) !== null) {
    return Response.json({ error: "注册已关闭" }, { status: 404 });
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
