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

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.ownerCredentials.get()) !== null) {
    return Response.json({ error: "注册已关闭" }, { status: 404 });
  }

  const expectedChallenge = readCookie(request, CHALLENGE_COOKIE);
  if (!expectedChallenge) {
    return Response.json({ error: "质询已过期，请重试" }, { status: 400 });
  }

  const body = (await request.json()) as RegistrationResponseJSON;
  const { rpID, origin } = relyingParty(request);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return Response.json({ error: "凭证校验失败" }, { status: 400 });
  }

  const { verified, registrationInfo } = verification;
  if (!verified || !registrationInfo) {
    return Response.json({ error: "凭证校验失败" }, { status: 400 });
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
}
