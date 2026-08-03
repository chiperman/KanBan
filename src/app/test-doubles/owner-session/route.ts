import {
  createSession,
  SESSION_COOKIE,
} from "@/server/auth/session";
import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const token = createSession(
    "test-owner",
    getTestServices().clock.now(),
  );
  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
  );
  return response;
}
