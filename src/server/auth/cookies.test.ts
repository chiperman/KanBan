import assert from "node:assert/strict";
import test from "node:test";
import { challengeCookieHeader, clearChallengeCookieHeader, sessionCookieHeader, clearSessionCookieHeader, relyingParty } from "./cookies";
test("可信 HTTPS origin 控制全部认证 Cookie，清除时范围一致", () => {
  const old = process.env.PAD_PUBLIC_ORIGIN;
  try {
    for (const origin of [undefined, "http://localhost:3101", "https://assets.example"]) {
      if (origin) process.env.PAD_PUBLIC_ORIGIN = origin;
      else delete process.env.PAD_PUBLIC_ORIGIN;
      for (const header of [challengeCookieHeader("challenge"), clearChallengeCookieHeader(), sessionCookieHeader("session"), clearSessionCookieHeader()]) {
        assert.equal(header.includes("; Secure"), origin?.startsWith("https:") ?? false);
        assert.ok(header.includes("Path=/; HttpOnly; SameSite="));
      }
    }
    const request = new Request("http://localhost:3101", { headers: { "x-forwarded-proto": "http", "x-forwarded-host": "evil.example" } });
    assert.deepEqual(relyingParty(request), { rpID: "assets.example", origin: "https://assets.example" });
    delete process.env.PAD_PUBLIC_ORIGIN;
    assert.equal(sessionCookieHeader("session").includes("Secure"), false);
    process.env.PAD_PUBLIC_ORIGIN = "http://assets.example";
    assert.throws(() => sessionCookieHeader("session"), /HTTPS/);
  } finally {
    if (old === undefined) delete process.env.PAD_PUBLIC_ORIGIN;
    else process.env.PAD_PUBLIC_ORIGIN = old;
  }
});
