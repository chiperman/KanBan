import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const preview = services.longbridgeConnections.getPublicPreview(id);
  if (!preview) {
    return Response.json({ error: "授权预览已失效，请重新开始" }, { status: 404 });
  }
  return Response.json({
    id: preview.id,
    account: preview.account,
    permissions: preview.permissions,
    total: preview.snapshot.total,
  });
}

export async function DELETE(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  services.longbridgeConnections.discardPreview(id);
  return Response.json({ ok: true });
}
