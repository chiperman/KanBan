import { getServices } from "@/server/composition";
export const dynamic = "force-dynamic";
export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  return Response.json({ providers: services.assetSourcePlugins?.descriptions() ?? [] });
}
