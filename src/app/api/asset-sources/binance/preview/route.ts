import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

function publicPreview(id: string) {
  const preview = getServices().binanceConnections.getPublicPreview(id);
  return preview
    ? {
        id: preview.id,
        provider: "binance",
        account: preview.account,
        permissions: preview.permissions,
        total: preview.snapshot.total,
      }
    : null;
}

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    apiKey?: unknown;
    apiSecret?: unknown;
  } | null;
  if (
    typeof body?.apiKey !== "string" ||
    typeof body.apiSecret !== "string"
  ) {
    return Response.json({ error: "Binance API 凭证格式无效" }, { status: 400 });
  }
  try {
    const result = await services.binance.preview({
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      observedAt: services.clock.now().toISOString(),
    });
    const id = services.binanceConnections.rememberPreview(result);
    return Response.json(publicPreview(id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Binance 凭证验证失败" },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const preview = publicPreview(id);
  return preview
    ? Response.json(preview)
    : Response.json({ error: "Binance 预览已失效，请重新验证" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  services.binanceConnections.discardPreview(id);
  return Response.json({ ok: true });
}
