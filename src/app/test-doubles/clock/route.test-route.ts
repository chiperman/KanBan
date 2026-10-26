import { getTestServices } from "@/server/testing/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;

  const body = (await request.json()) as { now?: unknown };
  if (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now))) {
    return Response.json({ error: "时间格式无效" }, { status: 400 });
  }

  const services = getTestServices();
  services.clock.set(body.now);
  return Response.json({ now: services.clock.now().toISOString() });
}
