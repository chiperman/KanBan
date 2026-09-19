import { test, expect, type Page } from "@playwright/test";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { createHash, createPrivateKey, sign } from "node:crypto";

async function provision(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
  } });
  // None attestation has no attestation signature; register the real public key
  // as a legitimate zero-counter authenticator through the real HTTP endpoint.
  await page.route("**/api/auth/register/verify", async route => {
    const body = route.request().postDataJSON();
    const attestation = isoCBOR.decodeFirst<Parameters<typeof isoCBOR.encode>[0]>(Buffer.from(body.response.attestationObject, "base64url"));
    if (!(attestation instanceof Map)) throw new Error("Invalid test attestation");
    const authData = attestation.get("authData") as Uint8Array;
    authData.fill(0, 33, 37);
    body.response.attestationObject = Buffer.from(isoCBOR.encode(attestation)).toString("base64url");
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  const credential = credentials[0];
  const assertion = (challenge: string, origin = new URL(page.url()).origin) => {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
    const authData = Buffer.concat([createHash("sha256").update("localhost").digest(), Buffer.from([5]), Buffer.alloc(4)]);
    const key = createPrivateKey({ key: Buffer.from(credential.privateKey, "base64"), format: "der", type: "pkcs8" });
    const signature = sign(key.asymmetricKeyType === "ed25519" ? null : "sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), key);
    return { id: Buffer.from(credential.credentialId, "base64").toString("base64url"), rawId: Buffer.from(credential.credentialId, "base64").toString("base64url"), type: "public-key", clientExtensionResults: {}, response: { authenticatorData: authData.toString("base64url"), clientDataJSON: clientData.toString("base64url"), signature: signature.toString("base64url") } };
  };
  return assertion;
}
test.beforeEach(async ({ request }) => { await request.post("/test-doubles/reset"); });
test("零计数器真实签名并发最多成功一次，新挑战仍可登录", async ({ page }) => {
  const assertion = await provision(page);
  const options = await (await page.request.post("/api/auth/login/options")).json();
  const cookie = (await page.context().cookies()).find(c => c.name === "pad_webauthn_challenge")!;
  const send = () => page.request.post("/api/auth/login/verify", { headers: { cookie: cookie.name + "=" + cookie.value }, data: assertion(options.challenge) });
  const responses = await Promise.all([send(), send()]);
  expect(responses.map(r => r.status()).sort()).toEqual([200, 400]);
  expect((await send()).status()).toBe(400);
  const next = await (await page.request.post("/api/auth/login/options")).json();
  expect((await page.request.post("/api/auth/login/verify", { data: assertion(next.challenge) })).status()).toBe(200);
});
test("重签发、过期、错误 origin 和未签发挑战由 HTTP 校验入口拒绝", async ({ page }) => {
  const assertion = await provision(page);
  const options = async () => (await page.request.post("/api/auth/login/options")).json();
  const old = await options();
  const cookie = (await page.context().cookies()).find(c => c.name === "pad_webauthn_challenge")!;
  await options();
  expect((await page.request.post("/api/auth/login/verify", { headers: { cookie: cookie.name + "=" + cookie.value }, data: assertion(old.challenge) })).status()).toBe(400);
  const wrongOrigin = await options();
  expect((await page.request.post("/api/auth/login/verify", { data: assertion(wrongOrigin.challenge, "https://evil.example") })).status()).toBe(401);
  await page.request.post("/test-doubles/clock", { data: { now: "2026-09-19T00:00:00Z" } });
  const expired = await options();
  await page.request.post("/test-doubles/clock", { data: { now: "2026-09-19T00:05:00Z" } });
  expect((await page.request.post("/api/auth/login/verify", { data: assertion(expired.challenge) })).status()).toBe(400);
  expect((await page.request.post("/api/auth/login/verify", { headers: { cookie: "pad_webauthn_challenge=forged" }, data: assertion(expired.challenge) })).status()).toBe(400);
});
