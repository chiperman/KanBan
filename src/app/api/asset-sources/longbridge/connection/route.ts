import { getServices } from "@/server/composition";
import { rejectCrossOrigin } from "@/server/auth/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (!services.longbridgeConnections) return Response.json({ error: "长桥连接管理不可用" }, { status: 503 });
  try {
    const sourceId = new URL(request.url).searchParams.get("sourceId") ?? undefined;
    return Response.json(await services.longbridgeConnections.status(sourceId), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "长桥检测失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if (!(await services.auth.currentSession())) return Response.json({ error: "需要所有者身份" }, { status: 401 });
  if (!services.longbridgeConnections) return Response.json({ error: "长桥连接管理不可用" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (typeof body?.code !== "string") return Response.json({ error: "一次性授权码无效" }, { status: 400 });
  try {
    await services.longbridgeConnections.loginCli(body.code);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CLI 登录失败" }, { status: 400 });
  }
}
