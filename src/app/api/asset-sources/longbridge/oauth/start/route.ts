import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  try {
    const callback = new URL(
      "/api/asset-sources/longbridge/oauth/callback",
      request.url,
    ).toString();
    const started = await services.longbridge.start(callback);
    services.longbridgeConnections.rememberStart(started.state, {
      codeVerifier: started.codeVerifier,
      redirectUri: callback,
    });
    return Response.json({
      authorizationUrl: started.authorizationUrl,
      state: started.state,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法开始长桥授权" },
      { status: 400 },
    );
  }
}
