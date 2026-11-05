import { rejectCrossOrigin } from "@/server/auth/request-origin";
import {
  clearSessionCookieHeader,
  readCookie,
} from "@/server/auth/cookies";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    destroySession(token);
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader() } },
  );
}
