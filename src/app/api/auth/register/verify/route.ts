import { consumeChallenge, withOwnerCredentialLock } from "@/server/auth/challenges";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { getServices } from "@/server/composition";
import {
  clearChallengeCookieHeader,
  readCookie,
  relyingParty,
} from "@/server/auth/cookies";
import { CHALLENGE_COOKIE } from "@/server/auth/session";

export const dynamic = "force-dynamic";

function reject(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Set-Cookie": clearChallengeCookieHeader() } });
}

export async function POST(request: Request) {
  return withOwnerCredentialLock(async () => {
    const services = getServices();
    if ((await services.ownerCredentials.get()) !== null) {
      return reject("注册已关闭", 404);
    }

    const { rpID, origin } = relyingParty(request);
    const expectedChallenge = consumeChallenge(readCookie(request, CHALLENGE_COOKIE), { purpose: "register", rpID, origin, credentialId: null }, services.clock.now());
    if (!expectedChallenge) {
      return reject("质询已过期，请重试", 400);
    }

    let verification;
    try {
      const body = (await request.json()) as RegistrationResponseJSON;
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch {
      return reject("凭证校验失败", 400);
    }

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) {
      return reject("凭证校验失败", 400);
    }

    const { credential } = registrationInfo;
    await services.ownerCredentials.save({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
    });

    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": clearChallengeCookieHeader() } },
    );
  });
}
