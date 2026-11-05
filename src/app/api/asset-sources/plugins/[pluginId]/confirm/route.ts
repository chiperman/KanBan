import { createConfirmRoute } from "@/server/asset-source-onboarding-http";
import { externalPluginProvider } from "@/server/asset-source-plugins/provider-id";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ pluginId: string }> }) {
  const provider = externalPluginProvider((await params).pluginId);
  if (!provider) return Response.json({ error: "官方集成来源无效" }, { status: 400 });
  return createConfirmRoute(provider)(request);
}
