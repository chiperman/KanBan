import { consumeChallenge, withOwnerCredentialLock } from "@/server/auth/challenges";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

import { getServices } from "@/server/composition";
import {
  clearChallengeCookieHeader,
  readCookie,
  relyingParty,
  sessionCookieHeader,
} from "@/server/auth/cookies";
import { CHALLENGE_COOKIE, createSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

function reject(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Set-Cookie": clearChallengeCookieHeader() } });
}

export async function POST(request: Request) {
  return withOwnerCredentialLock(async () => {
    const services = getServices();
    const credential = await services.ownerCredentials.get();
    if (credential === null) {
      return reject("所有者尚未预置凭证", 404);
    }

    const { rpID, origin } = relyingParty(request);
    const expectedChallenge = consumeChallenge(readCookie(request, CHALLENGE_COOKIE), { purpose: "login", rpID, origin, credentialId: credential.id }, services.clock.now());
    if (!expectedChallenge) {
      return reject("质询已过期，请重试", 400);
    }

    let verification;
    try {
      const body = (await request.json()) as AuthenticationResponseJSON;
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(
            Buffer.from(credential.publicKey, "base64url"),
          ),
          counter: credential.counter,
          transports: credential.transports as
            | AuthenticatorTransportFuture[]
            | undefined,
        },
      });
    } catch {
      return reject("身份验证失败", 401);
    }

    const { verified, authenticationInfo } = verification;
    if (!verified) {
      return reject("身份验证失败", 401);
    }

    await services.ownerCredentials.save({
      ...credential,
      counter: authenticationInfo.newCounter,
    });

    const token = createSession("owner", services.clock.now());
    const headers = new Headers();
    headers.append("Set-Cookie", sessionCookieHeader(token));
    headers.append("Set-Cookie", clearChallengeCookieHeader());
    return Response.json({ ok: true }, { headers });
  });
}
