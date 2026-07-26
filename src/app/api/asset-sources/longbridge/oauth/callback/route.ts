import { getServices } from "@/server/composition";
import type { AssetPermission } from "@/server/ports";

export const dynamic = "force-dynamic";

const REQUIRED: AssetPermission[] = ["account", "positions"];
const FORBIDDEN: AssetPermission[] = ["trade", "transfer", "withdraw"];

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
  const started = services.longbridgeConnections.consumeStart(state);
  if (!started || !code) {
    return home(request, "longbridge_error", "长桥授权校验失败，请重新开始");
  }
  try {
    const result = await services.longbridge.finish({
      code,
      codeVerifier: started.codeVerifier,
      redirectUri: started.redirectUri,
    });
    if (result.permissions.some((permission) => FORBIDDEN.includes(permission))) {
      return home(
        request,
        "longbridge_error",
        "检测到交易权限，已拒绝连接；请仅授权账户和持仓读取权限",
      );
    }
    if (!REQUIRED.every((permission) => result.permissions.includes(permission))) {
      return home(
        request,
        "longbridge_error",
        "授权范围不足，需要账户和持仓读取权限",
      );
    }
    const previewId = services.longbridgeConnections.rememberPreview(result);
    return home(request, "longbridge_preview", previewId);
  } catch (error) {
    return home(
      request,
      "longbridge_error",
      error instanceof Error ? error.message : "长桥授权预览失败",
    );
  }
}
