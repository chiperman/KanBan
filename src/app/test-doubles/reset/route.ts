import { isTestEnv, resetTestServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  resetTestServices();
  return Response.json({ ok: true });
}
