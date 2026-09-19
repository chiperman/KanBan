import assert from "node:assert/strict";
import test from "node:test";
import { clearChallenges, consumeChallenge, issueChallenge, withOwnerCredentialLock } from "./challenges";
const context = { purpose: "login" as const, origin: "http://localhost", rpID: "localhost", credentialId: "owner" };
const now = new Date("2026-09-19T00:00:00Z");
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
