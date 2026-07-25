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

export async function POST(request: Request) {
  const services = getServices();
  const credential = await services.ownerCredentials.get();
  if (credential === null) {
    return Response.json({ error: "所有者尚未预置凭证" }, { status: 404 });
  }

  const expectedChallenge = readCookie(request, CHALLENGE_COOKIE);
  if (!expectedChallenge) {
    return Response.json({ error: "质询已过期，请重试" }, { status: 400 });
  }

  const body = (await request.json()) as AuthenticationResponseJSON;
  const { rpID, origin } = relyingParty(request);

  let verification;
  try {
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
    return Response.json({ error: "身份验证失败" }, { status: 401 });
  }

  const { verified, authenticationInfo } = verification;
  if (!verified) {
    return Response.json({ error: "身份验证失败" }, { status: 401 });
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
}
