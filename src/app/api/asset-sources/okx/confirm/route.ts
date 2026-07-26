import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string") {
    return Response.json({ error: "OKX 预览无效" }, { status: 400 });
  }
  const preview = services.okxConnections.claimPreview(body.id);
  if (!preview) {
    return Response.json(
      { error: "OKX 预览已失效或正在确认，请重新验证" },
      { status: 409 },
    );
  }
  try {
    const revalidated = await services.okx.revalidate({
      credentials: preview.credentials,
      observedAt: services.clock.now().toISOString(),
    });
    if (
      revalidated.account.id !== preview.account.id ||
      revalidated.scopeFingerprint !== preview.scopeFingerprint
    ) {
      throw new Error("OKX 账户范围已变化，请重新预览");
    }
    await services.assetSourceConnections.connectOkx(revalidated);
    services.okxConnections.completePreview(body.id);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    services.okxConnections.releasePreview(body.id);
    return Response.json(
      { error: error instanceof Error ? error.message : "保存 OKX 来源失败" },
      { status: 500 },
    );
  }
}
