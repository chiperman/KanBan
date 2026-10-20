import assert from "node:assert/strict";
import test from "node:test";
import {
  challengeCookieHeader,
  clearChallengeCookieHeader,
  clearSessionCookieHeader,
  relyingParty,
  sessionCookieHeader,
} from "./cookies";
import {
  clearChallenges,
  consumeChallenge,
  issueChallenge,
  withOwnerCredentialLock,
} from "./challenges";

const context = { purpose: "login" as const, origin: "http://localhost", rpID: "localhost", credentialId: "owner" };
const now = new Date("2026-09-19T00:00:00Z");

// 挑战票据：一次性消费、上下文绑定、期限与并发锁
test("挑战只消费一次，绑定上下文、期限并拒绝伪造", () => {
  clearChallenges();
  const token = issueChallenge(context, "signed-challenge", null, now);
  assert.equal(consumeChallenge(token, context, now), "signed-challenge");
  assert.equal(consumeChallenge(token, context, now), null);
  assert.equal(consumeChallenge("forged", context, now), null);
  for (const mismatch of [{ ...context, purpose: "register" as const }, { ...context, origin: "https://evil.example" }, { ...context, rpID: "evil.example" }, { ...context, credentialId: "other" }]) {
    assert.equal(consumeChallenge(issueChallenge(context, "x", null, now), mismatch, now), null);
  }
  assert.equal(consumeChallenge(issueChallenge(context, "x", null, now), context, new Date(now.getTime() + 300_000)), null);
});

test("重签发及重置使旧挑战失效", () => {
  const old = issueChallenge(context, "old", null, now);
  const next = issueChallenge(context, "new", old, now);
  assert.equal(consumeChallenge(old, context, now), null);
  assert.equal(consumeChallenge(next, context, now), "new");
  const beforeRestart = issueChallenge(context, "restart", null, now);
  clearChallenges();
  assert.equal(consumeChallenge(beforeRestart, context, now), null);
});

test("凭证更新互斥且失败后释放，不覆盖并发注册", async () => {
  let owner: string | null = null;
  const register = (id: string) => withOwnerCredentialLock(async () => {
    if (owner) return false;
    await Promise.resolve();
    owner = id;
    return true;
  });
  assert.deepEqual(await Promise.all([register("a"), register("b")]), [true, false]);
  await assert.rejects(withOwnerCredentialLock(async () => { throw new Error("failure"); }));
  assert.equal(await withOwnerCredentialLock(async () => "released"), "released");
});

// 认证 Cookie：HTTPS 强制 Secure、SameSite/HttpOnly 范围、origin 解析
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
