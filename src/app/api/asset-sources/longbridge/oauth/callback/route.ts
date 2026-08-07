import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function destination(
  request: Request,
  key: string,
  value: string,
  sourceId?: string,
): Response {
  const target = new URL(
    sourceId === undefined
      ? "/asset-sources/new"
      : `/asset-sources/${encodeURIComponent(sourceId)}/reauthorize`,
    request.url,
  );
  target.searchParams.set(key, value);
  return Response.redirect(target);
}

export async function GET(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return destination(request, "longbridge_error", "授权会话已失效，请重新登录");
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const started = services.longbridgeOAuthState.consumeStart(state);
  if (!started || !code) {
    return destination(request, "longbridge_error", "长桥授权校验失败，请重新开始");
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
      started.reauthorization,
    );
    return destination(
      request,
      "longbridge_preview",
      preview.id,
      started.reauthorization?.sourceId,
    );
  } catch (error) {
    return destination(
      request,
      "longbridge_error",
      error instanceof Error ? error.message : "长桥授权预览失败",
      started.reauthorization?.sourceId,
    );
  }
}
