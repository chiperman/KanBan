import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json()) as { now?: unknown };
  if (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now))) {
    return Response.json({ error: "时间格式无效" }, { status: 400 });
  }

  const services = getTestServices();
  services.clock.set(body.now);
  return Response.json({ now: services.clock.now().toISOString() });
}
