import { isTestEnv } from "@/server/composition";
import { resetTestServices } from "@/server/testing/composition";

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
