import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function providerFor(source: {
  kind: string;
}) {
  switch (source.kind) {
    case "longbridge":
    case "binance":
    case "okx":
    case "bitget":
    case "bit":
      return source.kind;
    case "evm-watch-ethereum":
      return "ethereum";
    case "evm-watch-bsc":
      return "bsc";
    default:
      return null;
  }
}

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
  if (source === undefined) {
    return Response.json({ error: "资产来源不存在或不支持重新授权" }, { status: 404 });
  }
  const provider = providerFor(source);
  if (provider === null) {
    return Response.json({ error: "资产来源不存在或不支持重新授权" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string") {
    return Response.json({ error: "授权预览无效" }, { status: 400 });
  }
  try {
    await services.assetSourceOnboarding.confirm(
      provider,
      body.id,
      services.clock.now().toISOString(),
      source.id,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新授权失败" },
      { status: 400 },
    );
  }
}
