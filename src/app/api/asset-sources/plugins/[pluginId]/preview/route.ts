import { createPreviewRoute } from "@/server/asset-source-onboarding-http";
import { externalPluginProvider } from "@/server/asset-source-plugins/provider-id";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ pluginId: string }> };
async function handle(method: "POST" | "GET" | "DELETE", request: Request, { params }: Context) {
  const provider = externalPluginProvider((await params).pluginId);
  if (!provider) return Response.json({ error: "插件来源无效" }, { status: 400 });
  const route = createPreviewRoute({
    provider,
    parse: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null,
    invalidInput: "只读授权材料格式无效", previewFailed: "插件授权校验失败", previewExpired: "授权预览已失效", readable: true,
  });
  return route[method]!(request);
}
export const POST = (request: Request, context: Context) => handle("POST", request, context);
export const GET = (request: Request, context: Context) => handle("GET", request, context);
export const DELETE = (request: Request, context: Context) => handle("DELETE", request, context);
