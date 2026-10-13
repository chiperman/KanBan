import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { getTestServices, isTestEnv, resetTestServices } from "@/server/composition";

export function testGuard(): Response | null {
  return isTestEnv()
    ? null
    : Response.json({ error: "not found" }, { status: 404 });
}

export function resetTestStateResponse(): Response {
  const denied = testGuard();
  if (denied) return denied;
  resetTestServices();
  return Response.json({ ok: true });
}

export function createTestOwnerSessionResponse(): Response {
  const denied = testGuard();
  if (denied) return denied;
  const token = createSession("test-owner", getTestServices().clock.now());
  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
  );
  return response;
}
