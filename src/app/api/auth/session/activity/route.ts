import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { readCookie } from "@/server/auth/cookies";
import { SESSION_COOKIE, touchSession } from "@/server/auth/session";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !touchSession(token, services.clock.now())) {
    return Response.json({ error: "会话已锁定" }, { status: 401 });
  }
  return Response.json({ ok: true });
}
