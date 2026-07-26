import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string") {
    return Response.json({ error: "EVM 观察钱包预览无效" }, { status: 400 });
  }
  const preview = services.evmConnections.claimPreview(body.id);
  if (!preview) {
    return Response.json({ error: "EVM 观察钱包预览已失效或正在确认，请重新验证" }, { status: 409 });
  }
  try {
    const revalidated = await services.evm.revalidate({
      credentials: preview.credentials,
      observedAt: services.clock.now().toISOString(),
    });
    await services.assetSourceConnections.connectEvm(revalidated);
    services.evmConnections.completePreview(body.id);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    services.evmConnections.releasePreview(body.id);
    return Response.json(
      { error: error instanceof Error ? error.message : "保存 EVM 观察钱包失败" },
      { status: 500 },
    );
  }
}
