import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function home(request: Request, key: string, value: string): Response {
  const target = new URL("/", request.url);
  target.searchParams.set(key, value);
  return Response.redirect(target);
}

export async function GET(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return home(request, "longbridge_error", "授权会话已失效，请重新登录");
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const started = services.longbridgeOAuthState.consumeStart(state);
  if (!started || !code) {
    return home(request, "longbridge_error", "长桥授权校验失败，请重新开始");
  }
  try {
    const preview = await services.assetSourceOnboarding.preview(
      "longbridge",
      {
        provider: "longbridge",
        code,
        codeVerifier: started.codeVerifier,
        redirectUri: started.redirectUri,
      },
      services.clock.now().toISOString(),
    );
    return home(request, "longbridge_preview", preview.id);
  } catch (error) {
    return home(
      request,
      "longbridge_error",
      error instanceof Error ? error.message : "长桥授权预览失败",
    );
  }
}
