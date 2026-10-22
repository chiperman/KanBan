import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (source?.kind !== "longbridge") {
    return Response.json({ error: "只有长桥来源可使用 OAuth 重新授权" }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  const connectionMode = body?.mode === "both" ? "both" : "sdk";
  try {
    const callback = new URL(
      "/api/asset-sources/longbridge/oauth/callback",
      request.url,
    ).toString();
    const started = await services.longbridge.start(callback);
    services.longbridgeOAuthState.rememberStart(started.state, {
      connectionMode,
      codeVerifier: started.codeVerifier,
      redirectUri: callback,
      reauthorization: {
        sourceId: source.id,
        expectedAccountId: source.accountId,
      },
    });
    return Response.json({ authorizationUrl: started.authorizationUrl });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法开始长桥重新授权" },
      { status: 400 },
    );
  }
}
