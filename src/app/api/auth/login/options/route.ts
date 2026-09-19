import { issueChallenge } from "@/server/auth/challenges";
import { CHALLENGE_COOKIE } from "@/server/auth/session";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

import { getServices } from "@/server/composition";
import { challengeCookieHeader, readCookie, relyingParty } from "@/server/auth/cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  const credential = await services.ownerCredentials.get();
  if (credential === null) {
    return Response.json({ error: "所有者尚未预置凭证" }, { status: 404 });
  }

  const { rpID, origin } = relyingParty(request);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [
      {
        id: credential.id,
        transports: credential.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    ],
    userVerification: "preferred",
  });

  const token = issueChallenge({ purpose: "login", rpID, origin, credentialId: credential.id }, options.challenge, readCookie(request, CHALLENGE_COOKIE), services.clock.now());
  return Response.json(options, {
    headers: { "Set-Cookie": challengeCookieHeader(token) },
  });
}
